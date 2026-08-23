"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  chartOfAccounts,
  fixedAssets,
  fixedAssetValuations,
  journalEntries,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { todayJakarta } from "@/lib/tz";
import { recordJournal } from "./posting";
import { reverseJournalEntry } from "./actions";
import {
  accumulatedDepreciationThrough,
  addMonthsIso,
  firstDayOfMonthIso,
  monthsBetweenIso,
  pendingDepreciationMonths,
  type DepreciationSchedule,
} from "./fixed-asset-schedule";
import {
  planAssetValuation,
  VALUATION_ACCOUNT_CODES,
  type AssetValuationState,
  type ValuationKind,
  type ValuationLine,
} from "./fixed-asset-valuation-pure";
import { fail, ok, type ApiResult } from "./types";

/**
 * Sesi AE-214 — REVALUASI & PENURUNAN NILAI aset tetap (server).
 *
 * Aturan akuntansinya ada di `fixed-asset-valuation-pure.ts`. File ini yang
 * memastikan angka masukannya layak dipakai:
 *
 *   1. Penyusutan sampai tanggal efektif WAJIB sudah diposting. Kalau tidak,
 *      selisih revaluasinya menyerap penyusutan yang belum dijurnal dan
 *      mendarat di ekuitas — salah tempat, dan tak akan pernah terlihat dari
 *      layar mana pun.
 *   2. Periode tanggal efektif wajib masih 'open' (mengikuti AE-186/AE-211:
 *      menambah entry ke bulan yang sudah tutup buku bikin jurnal penutupnya
 *      basi tanpa ada yang menghitung ulang).
 *   3. Basis baru berlaku mulai BULAN BERIKUTNYA. Bulan berjalan sudah
 *      disusutkan dengan nilai lama; menyusutkannya ulang dengan nilai baru
 *      berarti satu bulan dihitung dua versi.
 *
 * Pratinjau dan posting memakai fungsi rencana yang SAMA — angka yang dilihat
 * owner sebelum menekan tombol tidak mungkin beda dengan yang diposting.
 */

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

const MONTH_NAMES = [
  "",
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

function monthLabelOf(monthFirstDay: string): string {
  const [y, m] = monthFirstDay.split("-").map(Number);
  return `${MONTH_NAMES[m]} ${y}`;
}

type AssetRow = typeof fixedAssets.$inferSelect;

function scheduleOf(a: AssetRow): DepreciationSchedule {
  return {
    acquiredDate: a.acquiredDate as string,
    cost: Number(a.cost),
    salvageValue: Number(a.salvageValue),
    usefulLifeMonths: a.usefulLifeMonths,
    basisAmount: a.basisAmount === null ? null : Number(a.basisAmount),
    basisMonth: (a.basisMonth as string | null) ?? null,
    basisAccumulated: Number(a.basisAccumulated ?? 0),
    basisRemainingMonths: a.basisRemainingMonths ?? null,
  };
}

/** Nilai bruto di buku. Aset lama (sebelum AE-214) punya 0 → pakai cost. */
function grossOf(a: AssetRow): number {
  const g = Number(a.grossAmount ?? 0);
  return g > 0 ? g : Number(a.cost);
}

function stateOf(a: AssetRow): AssetValuationState {
  const s = scheduleOf(a);
  return {
    assetName: a.name,
    assetAccountCode: a.assetAccountCode,
    accumulatedDepreciationAccountCode: a.accumulatedDepreciationAccountCode,
    grossAmount: grossOf(a),
    accumulatedDepreciation: accumulatedDepreciationThrough(
      s,
      (a.lastDepreciatedMonth as string | null) ?? null,
    ),
    accumulatedImpairment: Number(a.accumulatedImpairment ?? 0),
    revaluationSurplus: Number(a.revaluationSurplus ?? 0),
    revaluationLossRecognized: Number(a.revaluationLossRecognized ?? 0),
    salvageValue: Number(a.salvageValue),
  };
}

/**
 * Sisa umur manfaat bawaan pada `basisMonth`: umur manfaat dikurangi bulan
 * yang sudah terpakai. Minimal 1 — aset yang umurnya sudah habis tapi masih
 * dipakai boleh dinilai ulang, tinggal owner isi sisa umurnya sendiri.
 */
function defaultRemainingLife(a: AssetRow, basisMonth: string): number {
  const s = scheduleOf(a);
  if (s.basisMonth && s.basisRemainingMonths) {
    const used = monthsBetweenIso(s.basisMonth, basisMonth);
    return Math.max(1, s.basisRemainingMonths - used);
  }
  const used = monthsBetweenIso(firstDayOfMonthIso(s.acquiredDate), basisMonth);
  return Math.max(1, s.usefulLifeMonths - used);
}

export type AssetValuationHistoryRow = {
  id: string;
  kind: ValuationKind;
  effectiveDate: string;
  basisMonth: string;
  carryingBefore: number;
  carryingAfter: number;
  surplusCredit: number;
  surplusDebit: number;
  plGain: number;
  plLoss: number;
  remainingLifeMonths: number;
  reason: string;
  valuationBasis: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  reversedAt: string | null;
  createdAt: string;
  /** Boleh dibatalkan? Hanya peristiwa terakhir yang belum tersusul penyusutan. */
  cancellable: boolean;
  cancelBlockedReason: string | null;
};

export type AssetValuationContext = {
  assetId: string;
  assetName: string;
  assetAccountCode: string;
  /** Harga perolehan historis — jejak, bukan angka buku. */
  cost: number;
  grossAmount: number;
  accumulatedDepreciation: number;
  accumulatedImpairment: number;
  carrying: number;
  revaluationSurplus: number;
  revaluationLossRecognized: number;
  salvageValue: number;
  lastDepreciatedMonth: string | null;
  /** Bulan pertama basis baru kalau dinilai hari ini. */
  suggestedBasisMonth: string;
  suggestedRemainingLife: number;
  defaultEffectiveDate: string;
  history: AssetValuationHistoryRow[];
};

async function loadAsset(
  outletId: string,
  assetId: string,
): Promise<AssetRow | null> {
  const [row] = await db
    .select()
    .from(fixedAssets)
    .where(
      and(
        eq(fixedAssets.id, assetId),
        eq(fixedAssets.outletId, outletId),
        isNull(fixedAssets.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getAssetValuationContext(
  assetId: string,
): Promise<ApiResult<AssetValuationContext>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses Aset Tetap");
  }

  const asset = await loadAsset(session.user.outletId, assetId);
  if (!asset) return fail("NOT_FOUND", "Aset tidak ditemukan");

  const st = stateOf(asset);
  const today = todayJakarta();
  const basisMonth = addMonthsIso(firstDayOfMonthIso(today), 1);

  const rows = await db
    .select({
      v: fixedAssetValuations,
      entryNumber: journalEntries.entryNumber,
    })
    .from(fixedAssetValuations)
    .leftJoin(
      journalEntries,
      eq(journalEntries.id, fixedAssetValuations.journalEntryId),
    )
    .where(eq(fixedAssetValuations.assetId, assetId))
    .orderBy(desc(fixedAssetValuations.effectiveDate), desc(fixedAssetValuations.createdAt));

  const lastDep = (asset.lastDepreciatedMonth as string | null) ?? null;
  const latestActive = rows.find((r) => r.v.reversedAt === null);

  const history: AssetValuationHistoryRow[] = rows.map((r) => {
    let cancellable = false;
    let blocked: string | null = null;
    if (r.v.reversedAt !== null) {
      blocked = "Sudah dibatalkan.";
    } else if (!latestActive || latestActive.v.id !== r.v.id) {
      blocked = "Hanya penilaian TERAKHIR yang bisa dibatalkan.";
    } else if (lastDep && lastDep >= (r.v.basisMonth as string)) {
      blocked = `Penyusutan ${monthLabelOf(firstDayOfMonthIso(lastDep))} sudah diposting memakai nilai baru — batalkan jurnal penyusutannya dulu.`;
    } else {
      cancellable = true;
    }
    return {
      id: r.v.id,
      kind: r.v.kind as ValuationKind,
      effectiveDate: r.v.effectiveDate as string,
      basisMonth: r.v.basisMonth as string,
      carryingBefore: Number(r.v.carryingBefore),
      carryingAfter: Number(r.v.carryingAfter),
      surplusCredit: Number(r.v.surplusCredit),
      surplusDebit: Number(r.v.surplusDebit),
      plGain: Number(r.v.plGain),
      plLoss: Number(r.v.plLoss),
      remainingLifeMonths: r.v.remainingLifeMonths,
      reason: r.v.reason,
      valuationBasis: r.v.valuationBasis,
      journalEntryId: r.v.journalEntryId,
      journalEntryNumber: r.entryNumber ?? null,
      reversedAt: r.v.reversedAt ? r.v.reversedAt.toISOString() : null,
      createdAt: r.v.createdAt.toISOString(),
      cancellable,
      cancelBlockedReason: blocked,
    };
  });

  return ok({
    assetId: asset.id,
    assetName: asset.name,
    assetAccountCode: asset.assetAccountCode,
    cost: Number(asset.cost),
    grossAmount: st.grossAmount,
    accumulatedDepreciation: st.accumulatedDepreciation,
    accumulatedImpairment: st.accumulatedImpairment,
    carrying:
      st.grossAmount - st.accumulatedDepreciation - st.accumulatedImpairment,
    revaluationSurplus: st.revaluationSurplus,
    revaluationLossRecognized: st.revaluationLossRecognized,
    salvageValue: st.salvageValue,
    lastDepreciatedMonth: lastDep,
    suggestedBasisMonth: basisMonth,
    suggestedRemainingLife: defaultRemainingLife(asset, basisMonth),
    defaultEffectiveDate: today,
    history,
  });
}

export type ValuationPreviewInput = {
  assetId: string;
  kind: ValuationKind;
  newCarrying: number;
  effectiveDate: string;
  remainingLifeMonths: number;
};

export type ValuationPreview = {
  assetName: string;
  kind: ValuationKind;
  effectiveDate: string;
  basisMonth: string;
  basisMonthLabel: string;
  carryingBefore: number;
  carryingAfter: number;
  delta: number;
  surplusCredit: number;
  surplusDebit: number;
  plGain: number;
  plLoss: number;
  accumDepEliminated: number;
  accumImpairmentEliminated: number;
  remainingLifeMonths: number;
  /** Penyusutan per bulan SESUDAH penilaian ini berlaku. */
  monthlyDepreciationAfter: number;
  lines: Array<{ accountCode: string; debit: number; credit: number; description: string }>;
  totalDebit: number;
  /** Penghalang — selama masih ada isinya, tombol simpan mati. */
  blockers: string[];
  warnings: string[];
};

/**
 * Validasi yang dipakai BERSAMA oleh pratinjau dan posting. Dipisah supaya
 * tidak mungkin ada aturan yang cuma hidup di salah satunya.
 */
async function buildPreview(
  outletId: string,
  input: ValuationPreviewInput,
): Promise<ApiResult<{ preview: ValuationPreview; asset: AssetRow; lines: ValuationLine[]; nextState: NonNullable<ReturnType<typeof planAssetValuation>["nextState"]> }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    return fail("VALIDATION", "Tanggal berlaku belum diisi dengan benar.");
  }

  const asset = await loadAsset(outletId, input.assetId);
  if (!asset) return fail("NOT_FOUND", "Aset tidak ditemukan");

  const blockers: string[] = [];
  const today = todayJakarta();
  const effMonth = firstDayOfMonthIso(input.effectiveDate);
  const basisMonth = addMonthsIso(effMonth, 1);

  if (input.effectiveDate > today) {
    blockers.push("Tanggal berlakunya tidak boleh di masa depan.");
  }
  if (input.effectiveDate < (asset.acquiredDate as string)) {
    blockers.push(
      `Tanggal berlakunya lebih tua dari tanggal perolehan aset (${asset.acquiredDate as string}).`,
    );
  }

  /* Periode tujuan wajib masih terbuka. */
  const [yy, mm] = input.effectiveDate.split("-").map(Number);
  const [period] = await db
    .select({ status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.outletId, outletId),
        eq(accountingPeriods.periodYear, yy),
        eq(accountingPeriods.periodMonth, mm),
      ),
    )
    .limit(1);
  if (period && period.status !== "open") {
    blockers.push(
      `Periode ${MONTH_NAMES[mm]} ${yy} sudah ${period.status === "locked" ? "dikunci" : "tutup buku"} — buka dulu di Akuntansi → Periode, atau pilih tanggal di bulan yang masih terbuka.`,
    );
  }

  /* Penilaian tidak boleh mundur melewati penilaian yang sudah ada. */
  const [lastEvent] = await db
    .select({
      effectiveDate: fixedAssetValuations.effectiveDate,
    })
    .from(fixedAssetValuations)
    .where(
      and(
        eq(fixedAssetValuations.assetId, asset.id),
        isNull(fixedAssetValuations.reversedAt),
      ),
    )
    .orderBy(desc(fixedAssetValuations.effectiveDate))
    .limit(1);
  if (lastEvent && input.effectiveDate < (lastEvent.effectiveDate as string)) {
    blockers.push(
      `Aset ini sudah pernah dinilai ulang per ${lastEvent.effectiveDate as string}. Tanggal berlakunya tidak boleh lebih tua dari itu.`,
    );
  }

  /* Penyusutan sampai bulan efektif wajib sudah diposting. */
  const sched = scheduleOf(asset);
  const pending = pendingDepreciationMonths(
    sched,
    effMonth,
    (asset.lastDepreciatedMonth as string | null) ?? null,
  );
  if (pending.length > 0) {
    blockers.push(
      `Penyusutan ${pending.map((m) => monthLabelOf(m)).join(", ")} belum diposting. Jalankan dulu Hitung Depresiasi sampai ${monthLabelOf(effMonth)} supaya nilai tercatatnya benar.`,
    );
  }

  const state = stateOf(asset);
  const plan = planAssetValuation(state, {
    kind: input.kind,
    newCarrying: input.newCarrying,
    remainingLifeMonths: input.remainingLifeMonths,
  });
  blockers.push(...plan.errors);

  const monthlyAfter = plan.nextState
    ? Math.floor(
        Math.max(0, plan.nextState.basisAmount - state.salvageValue) /
          Math.max(1, plan.nextState.basisRemainingMonths),
      )
    : 0;

  const preview: ValuationPreview = {
    assetName: asset.name,
    kind: input.kind,
    effectiveDate: input.effectiveDate,
    basisMonth,
    basisMonthLabel: monthLabelOf(basisMonth),
    carryingBefore: plan.carryingBefore,
    carryingAfter: plan.carryingAfter,
    delta: plan.delta,
    surplusCredit: plan.surplusCredit,
    surplusDebit: plan.surplusDebit,
    plGain: plan.plGain,
    plLoss: plan.plLoss,
    accumDepEliminated: plan.accumDepEliminated,
    accumImpairmentEliminated: plan.accumImpairmentEliminated,
    remainingLifeMonths: Math.round(input.remainingLifeMonths),
    monthlyDepreciationAfter: monthlyAfter,
    lines: plan.lines.map((l) => ({
      accountCode: l.accountCode,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      description: l.description,
    })),
    totalDebit: plan.lines.reduce((s, l) => s + (l.debit ?? 0), 0),
    blockers,
    warnings: plan.warnings,
  };

  return ok({
    preview,
    asset,
    lines: plan.lines,
    nextState: plan.nextState ?? {
      grossAmount: state.grossAmount,
      accumulatedDepreciation: state.accumulatedDepreciation,
      accumulatedImpairment: state.accumulatedImpairment,
      revaluationSurplus: state.revaluationSurplus,
      revaluationLossRecognized: state.revaluationLossRecognized,
      basisAmount: state.grossAmount,
      basisRemainingMonths: 1,
    },
  });
}

export async function previewAssetValuation(
  input: ValuationPreviewInput,
): Promise<ApiResult<ValuationPreview>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat menilai ulang aset");
  }
  const built = await buildPreview(session.user.outletId, input);
  if (!built.ok) return built as ApiResult<never>;
  return ok(built.data.preview);
}

export type PostValuationInput = ValuationPreviewInput & {
  reason: string;
  valuationBasis?: string | null;
};

export async function postAssetValuation(
  input: PostValuationInput,
): Promise<ApiResult<{ valuationId: string; journalEntryId: string; entryNumber: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat menilai ulang aset");
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) {
    return fail(
      "VALIDATION",
      "Alasan penilaian minimal 10 karakter — ini yang dibaca akuntan/pemeriksa nanti.",
    );
  }

  const built = await buildPreview(session.user.outletId, input);
  if (!built.ok) return built as ApiResult<never>;
  const { preview, asset, lines, nextState } = built.data;
  if (preview.blockers.length > 0) {
    return fail("BLOCKED", preview.blockers[0]);
  }

  /* Aktifkan akun-akun penilaian saat pertama kali dipakai (pola sama dengan
   * akun aset tetap: di-seed non-aktif supaya bagan akun tidak penuh untuk
   * outlet yang tidak memakai modul ini). */
  await db
    .update(chartOfAccounts)
    .set({ isActive: true, updatedAt: new Date() })
    .where(
      and(
        eq(chartOfAccounts.outletId, session.user.outletId),
        inArray(chartOfAccounts.code, VALUATION_ACCOUNT_CODES),
        eq(chartOfAccounts.isActive, false),
      ),
    );

  const previousState = {
    grossAmount: grossOf(asset),
    basisAmount: asset.basisAmount === null ? null : Number(asset.basisAmount),
    basisMonth: (asset.basisMonth as string | null) ?? null,
    basisAccumulated: Number(asset.basisAccumulated ?? 0),
    basisRemainingMonths: asset.basisRemainingMonths ?? null,
    accumulatedImpairment: Number(asset.accumulatedImpairment ?? 0),
    revaluationSurplus: Number(asset.revaluationSurplus ?? 0),
    revaluationLossRecognized: Number(asset.revaluationLossRecognized ?? 0),
    lastDepreciatedMonth: (asset.lastDepreciatedMonth as string | null) ?? null,
  };

  /* Baris riwayat dibuat DULU: id-nya jadi sourceId jurnal, sehingga satu aset
   * boleh dinilai berkali-kali tanpa menabrak ux_je_outlet_source_active. */
  const [event] = await db
    .insert(fixedAssetValuations)
    .values({
      outletId: session.user.outletId,
      assetId: asset.id,
      kind: input.kind,
      effectiveDate: input.effectiveDate,
      basisMonth: preview.basisMonth,
      carryingBefore: preview.carryingBefore,
      carryingAfter: preview.carryingAfter,
      surplusCredit: preview.surplusCredit,
      surplusDebit: preview.surplusDebit,
      plGain: preview.plGain,
      plLoss: preview.plLoss,
      accumDepEliminated: preview.accumDepEliminated,
      accumImpairmentDelta:
        input.kind === "impairment"
          ? preview.plLoss
          : input.kind === "impairment_reversal"
            ? -preview.plGain
            : -preview.accumImpairmentEliminated,
      remainingLifeMonths: preview.remainingLifeMonths,
      reason,
      valuationBasis: input.valuationBasis?.trim() || null,
      previousState,
      createdBy: session.user.id,
    })
    .returning();

  let journalEntryId: string;
  let entryNumber: string;
  try {
    const result = await recordJournal({
      outletId: session.user.outletId,
      entryDate: input.effectiveDate,
      description:
        input.kind === "revaluation"
          ? `Revaluasi aset: ${asset.name}`
          : input.kind === "impairment"
            ? `Penurunan nilai aset: ${asset.name}`
            : `Pemulihan penurunan nilai: ${asset.name}`,
      sourceType:
        input.kind === "revaluation" ? "asset_revaluation" : "asset_impairment",
      sourceId: event.id,
      lines,
      actorId: session.user.id,
      metadata: {
        valuation: {
          kind: input.kind,
          assetId: asset.id,
          valuationId: event.id,
          carryingBefore: preview.carryingBefore,
          carryingAfter: preview.carryingAfter,
          basisMonth: preview.basisMonth,
        },
      },
    });
    journalEntryId = result.entryId;
    entryNumber = result.entryNumber;
  } catch (e) {
    /* Jurnalnya gagal → baris riwayatnya jangan ditinggal menggantung; kalau
     * dibiarkan, aset ini terlihat "sudah dinilai ulang" padahal bukunya tidak
     * berubah sama sekali. */
    await db
      .delete(fixedAssetValuations)
      .where(eq(fixedAssetValuations.id, event.id));
    return fail(
      "JOURNAL_FAILED",
      logAndSanitize(e, "accounting", "Jurnal penilaian gagal dibuat"),
    );
  }

  await db
    .update(fixedAssetValuations)
    .set({ journalEntryId })
    .where(eq(fixedAssetValuations.id, event.id));

  await db
    .update(fixedAssets)
    .set({
      grossAmount: nextState.grossAmount,
      basisAmount: nextState.basisAmount,
      basisMonth: preview.basisMonth,
      basisAccumulated: nextState.accumulatedDepreciation,
      basisRemainingMonths: nextState.basisRemainingMonths,
      accumulatedImpairment: nextState.accumulatedImpairment,
      revaluationSurplus: nextState.revaluationSurplus,
      revaluationLossRecognized: nextState.revaluationLossRecognized,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(fixedAssets.id, asset.id));

  await logAudit({
    eventType:
      input.kind === "revaluation"
        ? "fixed_asset.revaluation"
        : input.kind === "impairment"
          ? "fixed_asset.impairment"
          : "fixed_asset.impairment_reversal",
    userId: session.user.id,
    entityType: "fixed_asset",
    entityId: asset.id,
    payload: {
      summary: `${
        input.kind === "revaluation"
          ? "Revaluasi"
          : input.kind === "impairment"
            ? "Penurunan nilai"
            : "Pemulihan penurunan nilai"
      } ${asset.name}: Rp ${preview.carryingBefore.toLocaleString("id-ID")} → Rp ${preview.carryingAfter.toLocaleString("id-ID")} (berlaku ${input.effectiveDate})`,
      context: {
        valuationId: event.id,
        journalEntryId,
        kind: input.kind,
        delta: preview.delta,
        surplusCredit: preview.surplusCredit,
        surplusDebit: preview.surplusDebit,
        plGain: preview.plGain,
        plLoss: preview.plLoss,
        basisMonth: preview.basisMonth,
        remainingLifeMonths: preview.remainingLifeMonths,
        reason,
      },
    },
  });

  return ok({ valuationId: event.id, journalEntryId, entryNumber });
}

export async function cancelAssetValuation(
  valuationId: string,
  reason: string,
): Promise<ApiResult<{ id: string; reverseEntryNumber: string | null }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat membatalkan penilaian");
  }
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 10) {
    return fail("VALIDATION", "Alasan pembatalan minimal 10 karakter");
  }

  const [event] = await db
    .select()
    .from(fixedAssetValuations)
    .where(
      and(
        eq(fixedAssetValuations.id, valuationId),
        eq(fixedAssetValuations.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!event) return fail("NOT_FOUND", "Penilaian tidak ditemukan");
  if (event.reversedAt !== null) {
    return fail("INVALID_STATE", "Penilaian ini sudah dibatalkan.");
  }

  const asset = await loadAsset(session.user.outletId, event.assetId);
  if (!asset) return fail("NOT_FOUND", "Aset tidak ditemukan");

  /* Hanya peristiwa TERAKHIR yang boleh dibatalkan — keadaan aset sekarang
   * adalah hasil tumpukan peristiwa, jadi membatalkan yang di tengah tidak
   * punya arti yang bisa dipulihkan dengan benar. */
  const [latest] = await db
    .select({ id: fixedAssetValuations.id })
    .from(fixedAssetValuations)
    .where(
      and(
        eq(fixedAssetValuations.assetId, event.assetId),
        isNull(fixedAssetValuations.reversedAt),
      ),
    )
    .orderBy(desc(fixedAssetValuations.effectiveDate), desc(fixedAssetValuations.createdAt))
    .limit(1);
  if (!latest || latest.id !== event.id) {
    return fail(
      "INVALID_STATE",
      "Hanya penilaian TERAKHIR yang bisa dibatalkan. Batalkan yang lebih baru dulu.",
    );
  }

  const lastDep = (asset.lastDepreciatedMonth as string | null) ?? null;
  if (lastDep && lastDep >= (event.basisMonth as string)) {
    return fail(
      "INVALID_STATE",
      `Penyusutan ${monthLabelOf(firstDayOfMonthIso(lastDep))} sudah diposting memakai nilai baru. Batalkan dulu jurnal penyusutan itu, baru penilaian ini bisa dibatalkan.`,
    );
  }

  let reverseEntryNumber: string | null = null;
  if (event.journalEntryId) {
    const rev = await reverseJournalEntry(
      event.journalEntryId,
      `Pembatalan penilaian aset: ${trimmed}`,
    );
    if (!rev.ok) return rev as ApiResult<never>;
    reverseEntryNumber = rev.data.reverseEntryNumber;
  }

  const prev = event.previousState as {
    grossAmount: number;
    basisAmount: number | null;
    basisMonth: string | null;
    basisAccumulated: number;
    basisRemainingMonths: number | null;
    accumulatedImpairment: number;
    revaluationSurplus: number;
    revaluationLossRecognized: number;
  };

  await db
    .update(fixedAssets)
    .set({
      grossAmount: prev.grossAmount,
      basisAmount: prev.basisAmount,
      basisMonth: prev.basisMonth,
      basisAccumulated: prev.basisAccumulated,
      basisRemainingMonths: prev.basisRemainingMonths,
      accumulatedImpairment: prev.accumulatedImpairment,
      revaluationSurplus: prev.revaluationSurplus,
      revaluationLossRecognized: prev.revaluationLossRecognized,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(fixedAssets.id, asset.id));

  await db
    .update(fixedAssetValuations)
    .set({
      reversedAt: new Date(),
      reversedBy: session.user.id,
      reversalReason: trimmed,
    })
    .where(eq(fixedAssetValuations.id, event.id));

  await logAudit({
    eventType: "fixed_asset.valuation_cancel",
    userId: session.user.id,
    entityType: "fixed_asset",
    entityId: asset.id,
    payload: {
      summary: `Batal penilaian ${asset.name} (${event.kind}, berlaku ${event.effectiveDate as string}) — nilai tercatat kembali ke Rp ${Number(event.carryingBefore).toLocaleString("id-ID")}`,
      context: {
        valuationId: event.id,
        journalEntryId: event.journalEntryId,
        reverseEntryNumber,
        reason: trimmed,
      },
    },
  });

  return ok({ id: event.id, reverseEntryNumber });
}

/* Ringkasan surplus/penurunan nilai TIDAK dibuatkan action sendiri: angkanya
 * sudah ikut di tiap baris `listFixedAssets`, jadi layar menjumlahkannya
 * sendiri tanpa perjalanan tambahan ke server. */
