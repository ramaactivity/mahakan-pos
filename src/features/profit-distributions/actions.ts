"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  capitalMovements,
  investorStatementEmails,
  investors,
  outlets,
  pengelola,
  profitDistributionLines,
  profitDistributions,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { lockInvestors, lockPengelola } from "@/lib/db/locking";
import { getAccountBalances } from "@/features/accounting/queries";
import { buildIncomeStatement } from "@/features/accounting/reports";
import { recordJournal } from "@/features/accounting/posting";
import {
  mapDividendDistribution,
  mapDividendDistributionReversal,
  mapDividendDistributionV2,
} from "@/features/accounting/mapping/dividendDistribution";
import {
  computeDistribution,
  computeDistributionV2,
  type AllocPct,
  type PoolSplit,
} from "./compute-pure";
import {
  fetchDistributionWithLines,
  fetchDistributions,
  findDistributionForPeriod,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type ComputeDistributionInput,
  type DistributionWithLines,
  type ProfitDistribution,
} from "./types";

const DEFAULT_CONFIG = {
  bagiHasilPct: 10,
  lossPct: 3,
  capexPct: 0.7,
  retainedPct: 0.2,
  investorPoolPct: 35,
  pengelolaPoolPct: 65,
};

/* Sesi AE-80 — v2 default config (loss/capex/payoutRatio). Editable
 * per outlet via Settings → Modal & Dividen v2. */
const DEFAULT_V2_CONFIG = {
  defaultPayoutRatioPct: 10,
  defaultLossPct: 3,
  defaultCapexPct: 0.7,
  investorPoolPct: 35,
};

const MONTH_LABELS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listDistributions(): Promise<
  ApiResult<ProfitDistribution[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat distribusi");
  }
  return ok(await fetchDistributions(session.user.outletId));
}

export async function getDistribution(
  id: string,
): Promise<ApiResult<DistributionWithLines>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat distribusi");
  }
  const row = await fetchDistributionWithLines(session.user.outletId, id);
  if (!row) return fail("NOT_FOUND", "Distribusi tidak ditemukan");
  return ok(row);
}

// ---------- Compute ----------

/**
 * Compute draft distribution untuk period bulan. Fetch Net Profit dari
 * Income Statement existing, plus daftar holder aktif. Save sebagai
 * status='draft' supaya owner bisa review preview sebelum approve.
 *
 * Idempotent: kalau sudah ada draft untuk period yang sama, replace
 * (delete + reinsert lines). Approved/posted draft TIDAK boleh
 * di-replace (cek partial unique).
 */
export async function computeDistributionForPeriod(
  input: ComputeDistributionInput,
): Promise<ApiResult<DistributionWithLines>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.compute")) {
    return fail("FORBIDDEN", "Tidak punya hak hitung distribusi");
  }
  const { periodYear, periodMonth, netProfitOverride, payoutRatioOverride } =
    input;
  if (periodMonth < 1 || periodMonth > 12) {
    return fail("VALIDATION_ERROR", "Bulan harus 1-12");
  }
  if (periodYear < 2020 || periodYear > 2100) {
    return fail("VALIDATION_ERROR", "Tahun tidak valid");
  }

  /* Cek kalau sudah ada distribusi approved/posted untuk period ini. */
  const blocking = await findDistributionForPeriod(
    session.user.outletId,
    periodYear,
    periodMonth,
    ["approved", "posted"],
  );
  if (blocking) {
    return fail(
      "PERIOD_LOCKED",
      `Periode ${MONTH_LABELS_ID[periodMonth - 1]} ${periodYear} sudah ${blocking.status}. Cancel dulu kalau mau re-compute.`,
    );
  }

  /* Resolve config dari outlet settings, fallback ke default. */
  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);

  /* Sesi AE-80 — Detect v1 vs v2 model via flag. Default v1 untuk
   * backward compat. Owner toggle via Settings → Modal & Dividen v2. */
  const useV2 =
    outletRow?.settings?.dividen?.useWaterfallV2 === true;
  const calculationModel: "v1" | "v2" = useV2 ? "v2" : "v1";

  const config = outletRow?.settings?.dividendConfig ?? DEFAULT_CONFIG;
  const v2Config = {
    ...DEFAULT_V2_CONFIG,
    ...(outletRow?.settings?.dividen ?? {}),
  };

  const allocPct: AllocPct = {
    bagiHasil: config.bagiHasilPct,
    loss: config.lossPct,
    capex: config.capexPct,
    retained: config.retainedPct,
  };
  const poolSplit: PoolSplit = {
    investorPct: config.investorPoolPct,
    pengelolaPct: config.pengelolaPoolPct,
  };

  /* V2 effective rates: payout_ratio bisa di-override per distribusi
   * via input (range 0..100). Default dari outlet settings. */
  const effectivePayoutRatio = (() => {
    if (
      payoutRatioOverride != null &&
      Number.isFinite(payoutRatioOverride) &&
      payoutRatioOverride >= 0 &&
      payoutRatioOverride <= 100
    ) {
      return payoutRatioOverride;
    }
    return v2Config.defaultPayoutRatioPct ?? 10;
  })();
  const effectiveLossRate = v2Config.defaultLossPct ?? 3;
  const effectiveCapexRate = v2Config.defaultCapexPct ?? 0.7;
  const effectiveInvestorPoolPct = v2Config.investorPoolPct ?? 35;

  /* Resolve Net Profit. Override > Income Statement fetch. */
  let netProfit: number;
  if (netProfitOverride != null) {
    netProfit = Math.max(0, Math.floor(netProfitOverride));
  } else {
    const fromDate = `${periodYear}-${pad2(periodMonth)}-01`;
    const lastDay = new Date(periodYear, periodMonth, 0).getDate();
    const toDate = `${periodYear}-${pad2(periodMonth)}-${pad2(lastDay)}`;
    const balances = await getAccountBalances({
      outletId: session.user.outletId,
      fromDate,
      toDate,
    });
    const stmt = buildIncomeStatement(
      balances,
      `${MONTH_LABELS_ID[periodMonth - 1]} ${periodYear}`,
    );
    netProfit = stmt.netIncome;
  }

  /* Fetch active holders. */
  const investorsRows = await db
    .select({
      id: investors.id,
      modalDisetor: investors.modalDisetor,
      sharePct: investors.sharePct, // Sesi AE-80 — for v2
    })
    .from(investors)
    .where(
      and(
        eq(investors.outletId, session.user.outletId),
        eq(investors.status, "active"),
        isNull(investors.deletedAt),
      ),
    );
  const pengelolaRows = await db
    .select({ id: pengelola.id, modalDisetor: pengelola.modalDisetor })
    .from(pengelola)
    .where(
      and(
        eq(pengelola.outletId, session.user.outletId),
        eq(pengelola.status, "active"),
        isNull(pengelola.deletedAt),
      ),
    );

  /* Sesi AE-80 — V2 pre-compute validation: SUM(share_pct active) must
   * be valid. Treasury (sum < 100) allowed, > 100 blocked. */
  if (useV2) {
    const sumShare = investorsRows.reduce(
      (s, i) => s + Number(i.sharePct),
      0,
    );
    if (sumShare > 100.0001) {
      return fail(
        "INVALID_SHARE_TOTAL",
        `Total share % investor aktif = ${sumShare.toFixed(4)}% (> 100%). Edit share investor dulu via Tab Mutasi Saham.`,
      );
    }
  }

  /* Sesi AE-80 — dispatch sesuai model. Result ada 2 shape berbeda; di
   * normalize ke shape DB save di bawah. */
  type NormalizedResult = {
    netProfit: number;
    bagiHasilAmount: number;
    lossAmount: number;
    capexAmount: number;
    retainedAmount: number;
    investorPoolAmount: number;
    pengelolaPoolAmount: number;
    perInvestor: Array<{
      id: string;
      modalDisetor: number;
      sharePct: number;
      amount: number;
    }>;
    perPengelola: Array<{
      id: string;
      modalDisetor: number;
      sharePct: number;
      amount: number;
    }>;
    status: "normal" | "no_profit";
  };

  let result: NormalizedResult;
  if (useV2) {
    const v2 = computeDistributionV2({
      netProfit,
      lossRate: effectiveLossRate,
      capexRate: effectiveCapexRate,
      payoutRatio: effectivePayoutRatio,
      investorPoolPct: effectiveInvestorPoolPct,
      investors: investorsRows.map((i) => ({
        id: i.id,
        sharePct: Number(i.sharePct),
      })),
      pengelola: pengelolaRows,
    });
    /* Map v2 result ke shape DB (perInvestor.modalDisetor di-isi dari
     * row fetch karena v2 compute tidak butuh modal). */
    const investorModalById = new Map(
      investorsRows.map((i) => [i.id, i.modalDisetor]),
    );
    result = {
      netProfit: v2.netProfit,
      bagiHasilAmount: v2.bagiHasilAmount,
      lossAmount: v2.lossAmount,
      capexAmount: v2.capexAmount,
      retainedAmount: v2.retainedAmount,
      investorPoolAmount: v2.investorPoolAmount,
      pengelolaPoolAmount: v2.pengelolaPoolAmount,
      perInvestor: v2.perInvestor.map((l) => ({
        id: l.id,
        modalDisetor: investorModalById.get(l.id) ?? 0,
        sharePct: l.sharePct,
        amount: l.amount,
      })),
      perPengelola: v2.perPengelola,
      status: v2.status,
    };
  } else {
    const v1 = computeDistribution({
      netProfit,
      allocPct,
      poolSplit,
      investors: investorsRows.map((i) => ({
        id: i.id,
        modalDisetor: i.modalDisetor,
      })),
      pengelola: pengelolaRows,
    });
    result = v1;
  }

  /* Save dalam transaction — replace existing draft kalau ada.
   * Sesi AE-63 phase2 P2.5 — track wasRecompute supaya audit event
   * differentiate compute vs recompute (replace draft). */
  try {
    const txResult = await db.transaction(async (tx) => {
      const existingDraft = await tx
        .select({ id: profitDistributions.id })
        .from(profitDistributions)
        .where(
          and(
            eq(profitDistributions.outletId, session.user.outletId),
            eq(profitDistributions.periodYear, periodYear),
            eq(profitDistributions.periodMonth, periodMonth),
            eq(profitDistributions.status, "draft"),
          ),
        )
        .limit(1);

      const wasRecompute = existingDraft.length > 0;

      if (wasRecompute) {
        /* Replace draft: delete lines + delete header, then re-insert. */
        await tx
          .delete(profitDistributionLines)
          .where(
            eq(profitDistributionLines.distributionId, existingDraft[0].id),
          );
        await tx
          .delete(profitDistributions)
          .where(eq(profitDistributions.id, existingDraft[0].id));
      }

      const [inserted] = await tx
        .insert(profitDistributions)
        .values({
          outletId: session.user.outletId,
          periodYear,
          periodMonth,
          netProfitSnapshot: result.netProfit,
          bagiHasilPct: String(config.bagiHasilPct),
          lossPct: String(config.lossPct),
          capexPct: String(config.capexPct),
          retainedPct: String(config.retainedPct),
          investorPoolPct: String(config.investorPoolPct),
          pengelolaPoolPct: String(config.pengelolaPoolPct),
          bagiHasilAmount: result.bagiHasilAmount,
          lossAmount: result.lossAmount,
          capexAmount: result.capexAmount,
          retainedAmount: result.retainedAmount,
          investorPoolAmount: result.investorPoolAmount,
          pengelolaPoolAmount: result.pengelolaPoolAmount,
          status: "draft",
          /* Sesi AE-80 — v2 fields. V1 set to null. */
          calculationModel,
          payoutRatioPct: useV2 ? String(effectivePayoutRatio) : null,
          lossRateSnapshot: useV2 ? String(effectiveLossRate) : null,
          capexRateSnapshot: useV2 ? String(effectiveCapexRate) : null,
          notes:
            result.status === "no_profit"
              ? `Net Profit ≤ 0 (loss month) — tidak ada distribusi`
              : null,
          createdBy: session.user.id,
        })
        .returning({ id: profitDistributions.id });

      const lineRows = [
        ...result.perInvestor.map((l) => ({
          distributionId: inserted.id,
          holderType: "investor" as const,
          holderId: l.id,
          modalDisetorSnapshot: l.modalDisetor,
          sharePct: l.sharePct.toFixed(4),
          amountRupiah: l.amount,
        })),
        ...result.perPengelola.map((l) => ({
          distributionId: inserted.id,
          holderType: "pengelola" as const,
          holderId: l.id,
          modalDisetorSnapshot: l.modalDisetor,
          sharePct: l.sharePct.toFixed(4),
          amountRupiah: l.amount,
        })),
      ];
      if (lineRows.length > 0) {
        await tx.insert(profitDistributionLines).values(lineRows);
      }

      return { distId: inserted.id, wasRecompute };
    });

    const { distId, wasRecompute } = txResult;

    logAudit({
      eventType: wasRecompute
        ? "distribution.recompute"
        : "distribution.compute",
      userId: session.user.id,
      entityType: "profit_distribution",
      entityId: distId,
      payload: {
        summary: `${wasRecompute ? "Re-compute" : "Hitung"} distribusi ${MONTH_LABELS_ID[periodMonth - 1]} ${periodYear} — Net Profit Rp ${result.netProfit.toLocaleString("id-ID")}, BagiHasil Rp ${result.bagiHasilAmount.toLocaleString("id-ID")}`,
        context: {
          periodYear,
          periodMonth,
          netProfit: result.netProfit,
          bagiHasil: result.bagiHasilAmount,
          investorPool: result.investorPoolAmount,
          pengelolaPool: result.pengelolaPoolAmount,
          investorCount: result.perInvestor.length,
          pengelolaCount: result.perPengelola.length,
          status: result.status,
          wasRecompute,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) =>
      console.error(
        wasRecompute
          ? "[audit distribution.recompute]"
          : "[audit distribution.compute]",
        e,
      ),
    );

    const full = await fetchDistributionWithLines(
      session.user.outletId,
      distId,
    );
    if (!full) return fail("DB_ERROR", "Failed to load created distribution");
    return ok(full);
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "distribution.compute", "Operasi database gagal"),
    );
  }
}

// ---------- Approve + Post ----------

/**
 * Approve + post distribution. Owner-only. Bikin:
 *  - profit_distributions.status = 'posted' + actor + ts
 *  - journal_entry (Dr 3201 Cr 1101 total bagiHasil)
 *  - capital_movements per-line (kind='dividend_credit', link ke
 *    distribution + journal_entry)
 *  - audit log
 *
 * Email statement send di-defer ke Phase E (`after()` hook).
 */
export async function approveAndPostDistribution(
  id: string,
): Promise<ApiResult<DistributionWithLines>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak approve distribusi");
  }

  const distFull = await fetchDistributionWithLines(
    session.user.outletId,
    id,
  );
  if (!distFull) return fail("NOT_FOUND", "Distribusi tidak ditemukan");
  if (distFull.status !== "draft") {
    return fail(
      "INVALID_STATE",
      `Distribusi sudah ${distFull.status}, tidak bisa di-approve lagi`,
    );
  }
  if (distFull.bagiHasilAmount <= 0) {
    return fail(
      "NO_PROFIT",
      "Net Profit ≤ 0 untuk period ini. Tidak ada yang di-distribute.",
    );
  }

  const periodLabel = `${MONTH_LABELS_ID[distFull.periodMonth - 1]} ${distFull.periodYear}`;

  try {
    const result = await db.transaction(async (tx) => {
      /* Sesi AE-80 — Row locking: lock all investor + pengelola di lines
       * supaya concurrent withdrawal / reversal serialize correctly. */
      const investorIds = distFull.lines
        .filter((l) => l.holderType === "investor" && l.amountRupiah > 0)
        .map((l) => l.holderId);
      const pengelolaIds = distFull.lines
        .filter((l) => l.holderType === "pengelola" && l.amountRupiah > 0)
        .map((l) => l.holderId);
      await lockInvestors(tx, investorIds);
      await lockPengelola(tx, pengelolaIds);

      /* Sesi AE-80 — dispatch mapping v1 vs v2:
       *   V1: Dr 3201 / Cr 1101 (legacy, langsung kas keluar)
       *   V2: Dr 3201 / Cr 2160 (accrual ke liability bucket, withdrawal
       *       nanti Dr 2160 / Cr Kas). */
      const isV2 = distFull.calculationModel === "v2";
      const totalBagiHasil =
        distFull.investorPoolAmount + distFull.pengelolaPoolAmount;
      const lines = isV2
        ? mapDividendDistributionV2({
            bagiHasilAmount: totalBagiHasil,
            periodLabel,
          })
        : mapDividendDistribution({
            bagiHasilAmount: totalBagiHasil,
            periodLabel,
          });

      const lastDay = new Date(
        distFull.periodYear,
        distFull.periodMonth,
        0,
      ).getDate();
      const entryDate = `${distFull.periodYear}-${pad2(distFull.periodMonth)}-${pad2(lastDay)}`;

      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Dividen Bagi Hasil ${periodLabel}${isV2 ? " (v2 accrual)" : ""}`,
        sourceType: "dividend_distribution",
        sourceId: id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          distributionId: id,
          calculationModel: distFull.calculationModel,
          investorPool: distFull.investorPoolAmount,
          pengelolaPool: distFull.pengelolaPoolAmount,
        },
      });

      /* Step 2: bikin capital_movement per line (dividend_credit). */
      const movementValues = distFull.lines
        .filter((l) => l.amountRupiah > 0)
        .map((l) => ({
          outletId: session.user.outletId,
          holderType: l.holderType,
          holderId: l.holderId,
          kind: "dividend_credit" as const,
          amount: l.amountRupiah,
          occurredAt: new Date(`${entryDate}T17:00:00Z`), // 00:00 WIB
          description: `Dividen ${periodLabel}`,
          journalEntryId: journalResult.entryId,
          distributionId: id,
          createdBy: session.user.id,
        }));

      const insertedMovements =
        movementValues.length > 0
          ? await tx
              .insert(capitalMovements)
              .values(movementValues)
              .returning({ id: capitalMovements.id })
          : [];

      /* Step 3: update lines dengan capitalMovementId. Pair by index
       * karena order match (filter > 0 amount sama). */
      let mvIdx = 0;
      for (const line of distFull.lines) {
        if (line.amountRupiah > 0) {
          const mv = insertedMovements[mvIdx++];
          if (mv) {
            await tx
              .update(profitDistributionLines)
              .set({ capitalMovementId: mv.id })
              .where(eq(profitDistributionLines.id, line.id));
          }
        }
      }

      /* Sesi AE-80 — V2 only: increment investor.dividend_balance +
       * pengelola.dividend_balance untuk track saldo yang belum dicairkan.
       * V1 tidak ada dividend_balance flow (langsung cash out).
       *
       * Group amounts per holder (kalau ada double line dengan holderId
       * yang sama — jaga2, biasanya tidak terjadi). */
      if (isV2) {
        const investorIncrement = new Map<string, number>();
        const pengelolaIncrement = new Map<string, number>();
        for (const l of distFull.lines) {
          if (l.amountRupiah <= 0) continue;
          if (l.holderType === "investor") {
            investorIncrement.set(
              l.holderId,
              (investorIncrement.get(l.holderId) ?? 0) + l.amountRupiah,
            );
          } else if (l.holderType === "pengelola") {
            pengelolaIncrement.set(
              l.holderId,
              (pengelolaIncrement.get(l.holderId) ?? 0) + l.amountRupiah,
            );
          }
        }
        for (const [investorId, inc] of investorIncrement.entries()) {
          await tx
            .update(investors)
            .set({
              dividendBalance: sql`${investors.dividendBalance} + ${inc}`,
            })
            .where(eq(investors.id, investorId));
        }
        for (const [pengelolaId, inc] of pengelolaIncrement.entries()) {
          await tx
            .update(pengelola)
            .set({
              dividendBalance: sql`${pengelola.dividendBalance} + ${inc}`,
            })
            .where(eq(pengelola.id, pengelolaId));
        }
      }

      /* Step 4: mark distribution posted. */
      await tx
        .update(profitDistributions)
        .set({
          status: "posted",
          approvedBy: session.user.id,
          approvedAt: new Date(),
          postedAt: new Date(),
          journalEntryId: journalResult.entryId,
        })
        .where(eq(profitDistributions.id, id));

      return { journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "distribution.post",
      userId: session.user.id,
      entityType: "profit_distribution",
      entityId: id,
      payload: {
        summary: `Post distribusi ${periodLabel} — total Rp ${(distFull.investorPoolAmount + distFull.pengelolaPoolAmount).toLocaleString("id-ID")}`,
        context: {
          journalEntryId: result.journalEntryId,
          investorPool: distFull.investorPoolAmount,
          pengelolaPool: distFull.pengelolaPoolAmount,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit distribution.post]", e));

    /* Sesi AE-63e — Email statement bulk via Next.js after() hook supaya
     * Vercel guarantee task selesai setelah server action return ke client. */
    const { after } = await import("next/server");
    after(async () => {
      try {
        const { sendStatementsForDistribution } = await import(
          "./statement-send"
        );
        const sum = await sendStatementsForDistribution({
          distributionId: id,
          trigger: "auto",
          sentByUserId: session.user.id,
          actorOutletId: session.user.outletId,
          actorRole: session.user.role,
        });
        console.log(
          `[distribution.approve] statement auto-send ${periodLabel}:`,
          sum,
        );
      } catch (e) {
        console.error("[distribution.approve] statement send threw:", e);
      }
    });

    const final = await fetchDistributionWithLines(
      session.user.outletId,
      id,
    );
    if (!final) return fail("DB_ERROR", "Failed to reload distribution");
    return ok(final);
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "distribution.approve", "Operasi database gagal"),
    );
  }
}

// ---------- Cancel ----------

export async function cancelDistribution(
  id: string,
  reason: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak cancel distribusi");
  }
  if (!reason || reason.trim().length < 3) {
    return fail(
      "VALIDATION_ERROR",
      "Alasan cancel minimal 3 karakter",
      "reason",
    );
  }

  const dist = await fetchDistributionWithLines(session.user.outletId, id);
  if (!dist) return fail("NOT_FOUND", "Distribusi tidak ditemukan");
  if (dist.status === "posted") {
    return fail(
      "INVALID_STATE",
      "Distribusi sudah posted — gunakan reverse jurnal kalau perlu rollback",
    );
  }
  if (dist.status === "cancelled") {
    return fail("INVALID_STATE", "Distribusi sudah cancelled");
  }

  /* Sesi AE-63 audit P0 — outlet-scope di WHERE supaya tidak bisa
   * cancel distribusi outlet lain walaupun bypass pre-check. */
  await db
    .update(profitDistributions)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledReason: reason.trim(),
    })
    .where(
      and(
        eq(profitDistributions.id, id),
        eq(profitDistributions.outletId, session.user.outletId),
      ),
    );

  logAudit({
    eventType: "distribution.cancel",
    userId: session.user.id,
    entityType: "profit_distribution",
    entityId: id,
    payload: {
      summary: `Cancel distribusi ${MONTH_LABELS_ID[dist.periodMonth - 1]} ${dist.periodYear} — ${reason}`,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit distribution.cancel]", e));

  return ok({ id });
}

// ---------- Resend statement (manual) ----------

export async function resendStatementForLine(
  lineId: string,
): Promise<ApiResult<{ status: string; message: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor_statement.resend")) {
    return fail("FORBIDDEN", "Tidak punya hak kirim statement");
  }
  const { sendStatementForLine } = await import("./statement-send");
  const r = await sendStatementForLine({
    lineId,
    trigger: "manual",
    sentByUserId: session.user.id,
    actorOutletId: session.user.outletId,
    actorRole: session.user.role,
  });
  return ok({ status: r.status, message: r.message });
}

export async function resendStatementsForDistribution(
  distributionId: string,
): Promise<
  ApiResult<{
    total: number;
    sent: number;
    failed: number;
    logged: number;
    skippedNoEmail: number;
    skippedZeroAmount: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "investor_statement.resend")) {
    return fail("FORBIDDEN", "Tidak punya hak kirim statement");
  }
  const dist = await fetchDistributionWithLines(
    session.user.outletId,
    distributionId,
  );
  if (!dist) return fail("NOT_FOUND", "Distribusi tidak ditemukan");
  if (dist.status !== "posted") {
    return fail(
      "INVALID_STATE",
      "Distribusi belum di-post, tidak bisa kirim statement",
    );
  }
  const { sendStatementsForDistribution } = await import("./statement-send");
  const sum = await sendStatementsForDistribution({
    distributionId,
    trigger: "manual",
    sentByUserId: session.user.id,
    actorOutletId: session.user.outletId,
    actorRole: session.user.role,
  });
  return ok(sum);
}

// ============================================================================
// Sesi AE-80 — Reversal (V2 only — V1 distributions tidak reversible via flow
// ini; legacy data tetap pakai cancel atau manual journal reverse).
// ============================================================================

/**
 * Reverse distribution yang sudah posted (V2 only).
 *
 * Flow:
 *  1. Validate: status='posted', model='v2'.
 *  2. Idempotent: kalau sudah reversed, return ok no-op.
 *  3. Transaction:
 *     a. SELECT FOR UPDATE semua investor + pengelola yang ada di lines.
 *     b. Post jurnal balik via recordJournal:
 *          sourceType: 'dividend_distribution_reversal'
 *          sourceId: id (sama dengan original distribution)
 *          Mapping: Dr 2160 Hutang Dividen / Cr 3201 Prive Owner
 *     c. Insert capital_movements per line dengan kind='reversal',
 *        parent_movement_id = original.capitalMovementId.
 *     d. UPDATE investor.dividend_balance -= amount per line.
 *        CHECK constraint ck_investors_dividend_balance_nonneg akan
 *        FAIL kalau saldo sudah ditarik via withdrawal — return
 *        error BALANCE_INSUFFICIENT_FOR_REVERSAL.
 *     e. UPDATE pengelola.dividend_balance -= amount per line.
 *     f. Mark distribution status='reversed', reversed_at/by/reason.
 *     g. Mark investor_statement_emails status='void' (audit).
 *
 * Audit log + email notification (optional, owner choice).
 */
export async function reverseDistribution(
  id: string,
  reason: string,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  /* Permission: distribution.reverse (owner-only via RBAC config). Kalau
   * permission belum ada di RBAC, fallback ke distribution.approve. */
  const hasReverse =
    hasPermission(session.user.role, "distribution.reverse") ||
    hasPermission(session.user.role, "distribution.approve");
  if (!hasReverse) {
    return fail("FORBIDDEN", "Tidak punya hak reverse distribusi");
  }
  if (!reason || reason.trim().length < 5) {
    return fail(
      "VALIDATION_ERROR",
      "Alasan reverse minimal 5 karakter",
      "reason",
    );
  }

  const distFull = await fetchDistributionWithLines(
    session.user.outletId,
    id,
  );
  if (!distFull) return fail("NOT_FOUND", "Distribusi tidak ditemukan");

  /* Idempotency: kalau sudah reversed → return ok (no-op). */
  if (distFull.status === "reversed") {
    return ok({ id, journalEntryId: distFull.journalEntryId ?? "" });
  }

  if (distFull.status !== "posted") {
    return fail(
      "INVALID_STATE",
      `Hanya distribusi status='posted' yang bisa di-reverse. Status saat ini: ${distFull.status}.`,
    );
  }

  if (distFull.calculationModel !== "v2") {
    return fail(
      "INVALID_MODEL",
      "Reverse flow hanya support V2 distribution (legacy v1 — pakai manual journal reverse di Akuntansi).",
    );
  }

  const periodLabel = `${MONTH_LABELS_ID[distFull.periodMonth - 1]} ${distFull.periodYear}`;
  const totalBagiHasil =
    distFull.investorPoolAmount + distFull.pengelolaPoolAmount;

  try {
    const result = await db.transaction(async (tx) => {
      /* Lock all holders di lines. */
      const investorIds = distFull.lines
        .filter((l) => l.holderType === "investor" && l.amountRupiah > 0)
        .map((l) => l.holderId);
      const pengelolaIds = distFull.lines
        .filter((l) => l.holderType === "pengelola" && l.amountRupiah > 0)
        .map((l) => l.holderId);
      await lockInvestors(tx, investorIds);
      await lockPengelola(tx, pengelolaIds);

      /* Pre-check: pastikan saldo dividen masih cukup untuk reverse.
       * Kalau ada investor yang sudah tarik (dividend_balance < amount),
       * fail dengan info actionable. */
      if (investorIds.length > 0) {
        const investorBalances = await tx
          .select({
            id: investors.id,
            fullName: investors.fullName,
            dividendBalance: investors.dividendBalance,
          })
          .from(investors)
          .where(inArray(investors.id, investorIds));
        const balanceById = new Map(
          investorBalances.map((i) => [i.id, i]),
        );
        const investorAmounts = new Map<string, number>();
        for (const l of distFull.lines) {
          if (l.holderType !== "investor") continue;
          if (l.amountRupiah <= 0) continue;
          investorAmounts.set(
            l.holderId,
            (investorAmounts.get(l.holderId) ?? 0) + l.amountRupiah,
          );
        }
        for (const [invId, amt] of investorAmounts.entries()) {
          const inv = balanceById.get(invId);
          if (!inv) continue;
          if (inv.dividendBalance < amt) {
            throw new Error(
              `BALANCE_INSUFFICIENT_FOR_REVERSAL:${inv.fullName}:saldo ${inv.dividendBalance}, perlu ${amt}`,
            );
          }
        }
      }

      /* Post reversal journal (Dr 2160 / Cr 3201, opposite v2). */
      const lines = mapDividendDistributionReversal({
        bagiHasilAmount: totalBagiHasil,
        periodLabel,
      });
      const lastDay = new Date(
        distFull.periodYear,
        distFull.periodMonth,
        0,
      ).getDate();
      const entryDate = `${distFull.periodYear}-${pad2(distFull.periodMonth)}-${pad2(lastDay)}`;

      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Reversal Dividen ${periodLabel}: ${reason.trim().slice(0, 100)}`,
        sourceType: "dividend_distribution_reversal",
        sourceId: id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          distributionId: id,
          reversalReason: reason.trim(),
          investorPool: distFull.investorPoolAmount,
          pengelolaPool: distFull.pengelolaPoolAmount,
        },
      });

      /* Insert reversal capital_movements per line. Parent link ke
       * original capitalMovementId untuk audit trail chain. */
      const reversalMovementValues = distFull.lines
        .filter((l) => l.amountRupiah > 0)
        .map((l) => ({
          outletId: session.user.outletId,
          holderType: l.holderType,
          holderId: l.holderId,
          kind: "reversal" as const,
          amount: l.amountRupiah,
          occurredAt: new Date(),
          description: `Reversal Dividen ${periodLabel}`,
          journalEntryId: journalResult.entryId,
          distributionId: id,
          parentMovementId: l.capitalMovementId,
          createdBy: session.user.id,
        }));

      if (reversalMovementValues.length > 0) {
        await tx.insert(capitalMovements).values(reversalMovementValues);
      }

      /* Mark original capital_movements as reversed. */
      const originalMovementIds = distFull.lines
        .filter((l) => l.capitalMovementId != null)
        .map((l) => l.capitalMovementId as string);
      if (originalMovementIds.length > 0) {
        await tx
          .update(capitalMovements)
          .set({
            reversedAt: new Date(),
            reversedBy: session.user.id,
          })
          .where(inArray(capitalMovements.id, originalMovementIds));
      }

      /* Decrement investor.dividend_balance + pengelola.dividend_balance.
       * CHECK >= 0 akan fail kalau pre-check leluasa — defensive. */
      const investorDec = new Map<string, number>();
      const pengelolaDec = new Map<string, number>();
      for (const l of distFull.lines) {
        if (l.amountRupiah <= 0) continue;
        if (l.holderType === "investor") {
          investorDec.set(
            l.holderId,
            (investorDec.get(l.holderId) ?? 0) + l.amountRupiah,
          );
        } else if (l.holderType === "pengelola") {
          pengelolaDec.set(
            l.holderId,
            (pengelolaDec.get(l.holderId) ?? 0) + l.amountRupiah,
          );
        }
      }
      for (const [invId, dec] of investorDec.entries()) {
        await tx
          .update(investors)
          .set({
            dividendBalance: sql`${investors.dividendBalance} - ${dec}`,
          })
          .where(eq(investors.id, invId));
      }
      for (const [penId, dec] of pengelolaDec.entries()) {
        await tx
          .update(pengelola)
          .set({
            dividendBalance: sql`${pengelola.dividendBalance} - ${dec}`,
          })
          .where(eq(pengelola.id, penId));
      }

      /* Mark distribution reversed. */
      await tx
        .update(profitDistributions)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: reason.trim(),
        })
        .where(eq(profitDistributions.id, id));

      /* Mark related investor_statement_emails as void (audit). */
      await tx
        .update(investorStatementEmails)
        .set({ status: "void" })
        .where(eq(investorStatementEmails.distributionId, id));

      return { journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "distribution.reverse",
      userId: session.user.id,
      entityType: "profit_distribution",
      entityId: id,
      payload: {
        summary: `Reverse distribusi ${periodLabel} — Rp ${totalBagiHasil.toLocaleString("id-ID")} : ${reason}`,
        context: {
          journalEntryId: result.journalEntryId,
          reversalReason: reason.trim(),
          totalBagiHasil,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit distribution.reverse]", e));

    return ok({ id, journalEntryId: result.journalEntryId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("BALANCE_INSUFFICIENT_FOR_REVERSAL:")) {
      const parts = msg.split(":");
      return fail(
        "BALANCE_INSUFFICIENT_FOR_REVERSAL",
        `Investor ${parts[1] ?? "?"} sudah tarik saldo (${parts[2] ?? ""}). Reverse tidak bisa dilakukan tanpa investor refund dulu.`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "distribution.reverse", "Operasi database gagal"),
    );
  }
}
