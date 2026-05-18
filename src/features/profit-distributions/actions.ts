"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  capitalMovements,
  investors,
  outlets,
  pengelola,
  profitDistributionLines,
  profitDistributions,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { getAccountBalances } from "@/features/accounting/queries";
import { buildIncomeStatement } from "@/features/accounting/reports";
import { recordJournal } from "@/features/accounting/posting";
import { mapDividendDistribution } from "@/features/accounting/mapping/dividendDistribution";
import {
  computeDistribution,
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
  const { periodYear, periodMonth, netProfitOverride } = input;
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
  const config = outletRow?.settings?.dividendConfig ?? DEFAULT_CONFIG;
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
    .select({ id: investors.id, modalDisetor: investors.modalDisetor })
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

  const result = computeDistribution({
    netProfit,
    allocPct,
    poolSplit,
    investors: investorsRows,
    pengelola: pengelolaRows,
  });

  /* Save dalam transaction — replace existing draft kalau ada. */
  try {
    const distId = await db.transaction(async (tx) => {
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

      if (existingDraft.length > 0) {
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

      return inserted.id;
    });

    logAudit({
      eventType: existingDraftLogPlaceholder()
        ? "distribution.recompute"
        : "distribution.compute",
      userId: session.user.id,
      entityType: "profit_distribution",
      entityId: distId,
      payload: {
        summary: `Hitung distribusi ${MONTH_LABELS_ID[periodMonth - 1]} ${periodYear} — Net Profit Rp ${result.netProfit.toLocaleString("id-ID")}, BagiHasil Rp ${result.bagiHasilAmount.toLocaleString("id-ID")}`,
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
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit distribution.compute]", e));

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

/* Helper bool — di-stub untuk audit branching. Always returns false
 * placeholder; actual recompute path handled inline. */
function existingDraftLogPlaceholder(): boolean {
  return false;
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
      /* Step 1: post jurnal Dr 3201 Cr 1101 total Bagi Hasil. */
      const lines = mapDividendDistribution({
        bagiHasilAmount:
          distFull.investorPoolAmount + distFull.pengelolaPoolAmount,
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
        description: `Dividen Bagi Hasil ${periodLabel}`,
        sourceType: "dividend_distribution",
        sourceId: id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          distributionId: id,
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

  await db
    .update(profitDistributions)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledReason: reason.trim(),
    })
    .where(eq(profitDistributions.id, id));

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
