"use server";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chartOfAccounts,
  fixedAssets,
  journalEntries,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { todayJakarta } from "@/lib/tz";
import {
  mapCapitalizeAsset,
  mapMonthlyDepreciation,
  type CapitalizeAssetPaymentMethod,
} from "./mapping";
import {
  accumulatedDepreciationThrough,
  firstDayOfMonthIso,
  monthlyDepreciationFor,
  monthsBetweenIso,
  type DepreciationSchedule,
} from "./fixed-asset-schedule";
import { recordJournal } from "./posting";
import {
  fail,
  ok,
  type ApiResult,
} from "./types";

/**
 * Sesi X — Fixed Asset register actions.
 *
 * Owner-only: createFixedAsset (Dr asset Cr kas/bank capitalization),
 * runMonthlyDepreciation (Dr beban penyusutan Cr akum penyusutan, idempotent
 * via lastDepreciatedMonth check), deactivateFixedAsset (soft delete).
 *
 * Activate placeholder accounts (1201-1204, 1290, 6501-6504) on first asset
 * create — mereka di-seed dengan isActive=false di sesi S, jadi UI dropdown
 * tidak show sampai Owner adopt fixed asset module.
 */

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

const FIXED_ASSET_PLACEHOLDER_CODES = [
  "1201", // Furniture & Peralatan Cafe
  "1202", // Mesin & Peralatan Dapur
  "1203", // Peralatan Bar
  "1204", // Peralatan IT
  "1290", // Akumulasi Penyusutan
  "6501", // Beban Penyusutan Furniture
  "6502", // Beban Penyusutan Peralatan Dapur
  "6503", // Beban Penyusutan Peralatan Bar
  "6504", // Beban Penyusutan Peralatan IT
];

export type FixedAssetRow = {
  id: string;
  name: string;
  category: string | null;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  acquiredDate: string;
  assetAccountCode: string;
  depreciationAccountCode: string;
  accumulatedDepreciationAccountCode: string;
  lastDepreciatedMonth: string | null;
  notes: string | null;
  /** Computed: cumulative depreciation = cost - salvage rounded by month. */
  accumulatedDepreciation: number;
  /** Computed: net book value = cost - accumulated depreciation. */
  netBookValue: number;
  /** Computed: months since acquired. */
  monthsElapsed: number;
  /* ===== Sesi AE-214 — revaluasi & penurunan nilai ===== */
  /** Nilai bruto di buku besar. Sama dengan `cost` selama belum pernah direvaluasi. */
  grossAmount: number;
  accumulatedImpairment: number;
  revaluationSurplus: number;
  /** Terisi kalau aset ini pernah dinilai ulang (basis penyusutan berubah). */
  basisAmount: number | null;
  basisMonth: string | null;
  basisRemainingMonths: number | null;
  /** Sisa umur manfaat yang berlaku sekarang (bulan). */
  remainingLifeMonths: number;
};

// ============================================================
// List
// ============================================================

export async function listFixedAssets(): Promise<
  ApiResult<FixedAssetRow[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses Aset Tetap");
  }

  const rows = await db
    .select()
    .from(fixedAssets)
    .where(
      and(
        eq(fixedAssets.outletId, session.user.outletId),
        isNull(fixedAssets.deletedAt),
      ),
    )
    .orderBy(asc(fixedAssets.acquiredDate));

  const todayWib = todayJakarta();
  const result: FixedAssetRow[] = rows.map((r) => {
    const monthsElapsed = monthsBetween(r.acquiredDate as string, todayWib);
    /* Sesi AE-214 — akumulasi & nilai buku sekarang lewat jadwal yang sadar
     * basis. Untuk aset yang tidak pernah dinilai ulang hasilnya identik
     * dengan rumus lama (basisMonth null → jalur legacy). */
    const sched = scheduleOfRow(r);
    const acc = accumulatedDepreciationThrough(
      sched,
      (r.lastDepreciatedMonth as string | null) ?? null,
    );
    const gross = grossOfRow(r);
    const impairment = Number(r.accumulatedImpairment ?? 0);
    const remainingLife = sched.basisMonth && sched.basisRemainingMonths
      ? Math.max(
          0,
          sched.basisRemainingMonths -
            monthsBetweenIso(sched.basisMonth, firstDayOfMonthIso(todayWib)),
        )
      : Math.max(0, r.usefulLifeMonths - monthsElapsed);

    return {
      id: r.id,
      name: r.name,
      category: r.category,
      cost: Number(r.cost),
      salvageValue: Number(r.salvageValue),
      usefulLifeMonths: r.usefulLifeMonths,
      acquiredDate: r.acquiredDate as string,
      assetAccountCode: r.assetAccountCode,
      depreciationAccountCode: r.depreciationAccountCode,
      accumulatedDepreciationAccountCode: r.accumulatedDepreciationAccountCode,
      lastDepreciatedMonth: r.lastDepreciatedMonth as string | null,
      notes: r.notes,
      accumulatedDepreciation: acc,
      netBookValue: gross - acc - impairment,
      monthsElapsed,
      grossAmount: gross,
      accumulatedImpairment: impairment,
      revaluationSurplus: Number(r.revaluationSurplus ?? 0),
      basisAmount: r.basisAmount === null ? null : Number(r.basisAmount),
      basisMonth: (r.basisMonth as string | null) ?? null,
      basisRemainingMonths: r.basisRemainingMonths ?? null,
      remainingLifeMonths: remainingLife,
    };
  });

  return ok(result);
}

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

type FixedAssetDbRow = typeof fixedAssets.$inferSelect;

/**
 * Sesi AE-214 — jadwal penyusutan sebuah baris aset. Satu tempat, dipakai
 * daftar aset, pratinjau depresiasi, dan postingnya, supaya ketiganya tidak
 * mungkin memakai dasar hitung yang berbeda.
 */
function scheduleOfRow(r: FixedAssetDbRow): DepreciationSchedule {
  return {
    acquiredDate: r.acquiredDate as string,
    cost: Number(r.cost),
    salvageValue: Number(r.salvageValue),
    usefulLifeMonths: r.usefulLifeMonths,
    basisAmount: r.basisAmount === null ? null : Number(r.basisAmount),
    basisMonth: (r.basisMonth as string | null) ?? null,
    basisAccumulated: Number(r.basisAccumulated ?? 0),
    basisRemainingMonths: r.basisRemainingMonths ?? null,
  };
}

/** Nilai bruto di buku. Aset lama (sebelum AE-214) punya 0 → pakai `cost`. */
function grossOfRow(r: FixedAssetDbRow): number {
  const g = Number(r.grossAmount ?? 0);
  return g > 0 ? g : Number(r.cost);
}

// ============================================================
// Create
// ============================================================

export type CreateFixedAssetInput = {
  name: string;
  category?: string | null;
  cost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  acquiredDate: string;
  assetAccountCode: string;
  depreciationAccountCode: string;
  /** Default "1290". */
  accumulatedDepreciationAccountCode?: string;
  /** Capitalization payment method. Required kalau capitalize=true. */
  capitalize: boolean;
  paymentMethod?: CapitalizeAssetPaymentMethod;
  /** Sesi AE-212 — akun lawan pilihan owner (dikredit). Kalau kosong, dipakai
   * pemetaan bawaan dari `paymentMethod`. */
  creditAccountCode?: string | null;
  notes?: string | null;
};

export async function createFixedAsset(
  input: CreateFixedAssetInput,
): Promise<
  ApiResult<{
    id: string;
    journalEntryId: string | null;
    /** Sesi AE-212 — terisi kalau aset tersimpan tapi jurnalnya gagal. */
    capitalizeError: string | null;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat input aset tetap");
  }

  // Basic validation
  if (input.name.trim().length < 2) {
    return fail("VALIDATION", "Nama aset minimal 2 karakter");
  }
  if (input.cost <= 0) {
    return fail("VALIDATION", "Biaya pengadaan harus > 0");
  }
  const salvage = input.salvageValue ?? 0;
  if (salvage < 0 || salvage >= input.cost) {
    return fail(
      "VALIDATION",
      "Nilai sisa harus 0 ≤ salvage < cost",
    );
  }
  if (input.usefulLifeMonths < 1 || input.usefulLifeMonths > 600) {
    return fail("VALIDATION", "Useful life harus 1-600 bulan");
  }
  if (!/^[1-6]\d{3}$/.test(input.assetAccountCode)) {
    return fail("VALIDATION", "Kode akun aset tidak valid");
  }
  if (input.capitalize && !input.paymentMethod && !input.creditAccountCode) {
    return fail(
      "VALIDATION",
      "Pilih dulu akun lawannya (uangnya keluar dari mana) kalau aset ini dijurnal",
    );
  }

  // Activate placeholder accounts on first adoption.
  await db
    .update(chartOfAccounts)
    .set({ isActive: true, updatedAt: new Date() })
    .where(
      and(
        eq(chartOfAccounts.outletId, session.user.outletId),
        inArray(chartOfAccounts.code, FIXED_ASSET_PLACEHOLDER_CODES),
        eq(chartOfAccounts.isActive, false),
      ),
    );

  const accumCode = input.accumulatedDepreciationAccountCode ?? "1290";

  // Insert fixed_asset row
  const [created] = await db
    .insert(fixedAssets)
    .values({
      outletId: session.user.outletId,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      cost: input.cost,
      salvageValue: salvage,
      usefulLifeMonths: input.usefulLifeMonths,
      acquiredDate: input.acquiredDate,
      assetAccountCode: input.assetAccountCode,
      depreciationAccountCode: input.depreciationAccountCode,
      accumulatedDepreciationAccountCode: accumCode,
      notes: input.notes?.trim() || null,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning();

  let journalEntryId: string | null = null;
  let capitalizeError: string | null = null;

  // Capitalize: create journal entry Dr asset Cr kas/bank.
  if (input.capitalize && (input.paymentMethod || input.creditAccountCode)) {
    try {
      const lines = mapCapitalizeAsset({
        assetId: created.id,
        assetName: created.name,
        outletId: session.user.outletId,
        entryDate: created.acquiredDate as string,
        cost: Number(created.cost),
        assetAccountCode: created.assetAccountCode,
        paymentMethod: input.paymentMethod ?? "cash",
        creditAccountCode: input.creditAccountCode ?? null,
      });
      const result = await recordJournal({
        outletId: session.user.outletId,
        entryDate: created.acquiredDate as string,
        description: `Pengadaan aset: ${created.name}`,
        sourceType: "manual",
        sourceId: created.id,
        lines,
        actorId: session.user.id,
      });
      journalEntryId = result.entryId;
    } catch (e) {
      /* Sesi AE-212 — asetnya tetap dibuat (datanya sudah benar), TAPI
       * kegagalan jurnalnya tidak lagi ditelan diam-diam. Sebelumnya hanya
       * masuk console: aset terdaftar tanpa pernah masuk neraca, dan tidak ada
       * satu pun tanda di layar. */
      console.error("[fixed_asset:capitalize]", e);
      capitalizeError =
        e instanceof Error ? e.message : "Jurnal pengadaan gagal dibuat";
    }
  }

  await logAudit({
    eventType: "fixed_asset.create",
    userId: session.user.id,
    entityType: "fixed_asset",
    entityId: created.id,
    payload: {
      summary: `Aset tetap: ${created.name} Rp ${Number(created.cost).toLocaleString("id-ID")} (${created.usefulLifeMonths} bulan)`,
      after: created,
      context: { capitalized: input.capitalize, journalEntryId },
    },
  });

  return ok({ id: created.id, journalEntryId, capitalizeError });
}

// ============================================================
// Deactivate (soft delete)
// ============================================================

// ============================================================
// Sesi Y polish #5 — Bulk CSV Import
// ============================================================

export type BulkImportRow = {
  name: string;
  category: string | null;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  acquiredDate: string;
  assetAccountCode: string;
  depreciationAccountCode: string;
  capitalize: boolean;
  paymentMethod: "cash" | "transfer_bca" | "transfer_bri" | "transfer_other";
  notes: string | null;
};

export type BulkImportResult = {
  inserted: number;
  capitalized: number;
  errors: Array<{ name: string; message: string }>;
};

export async function bulkImportFixedAssets(
  rows: BulkImportRow[],
): Promise<ApiResult<BulkImportResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner yang dapat bulk import aset tetap",
    );
  }

  if (rows.length === 0) {
    return fail("VALIDATION", "Tidak ada baris untuk di-import");
  }
  if (rows.length > 200) {
    return fail("VALIDATION", "Maksimal 200 baris per import (batch)");
  }

  // Activate placeholder accounts on first adoption (idempotent — safe re-run).
  await db
    .update(chartOfAccounts)
    .set({ isActive: true, updatedAt: new Date() })
    .where(
      and(
        eq(chartOfAccounts.outletId, session.user.outletId),
        inArray(chartOfAccounts.code, FIXED_ASSET_PLACEHOLDER_CODES),
        eq(chartOfAccounts.isActive, false),
      ),
    );

  let inserted = 0;
  let capitalized = 0;
  const errors: BulkImportResult["errors"] = [];
  const insertedIds: string[] = [];

  for (const r of rows) {
    try {
      const [created] = await db
        .insert(fixedAssets)
        .values({
          outletId: session.user.outletId,
          name: r.name,
          category: r.category,
          cost: r.cost,
          salvageValue: r.salvageValue,
          usefulLifeMonths: r.usefulLifeMonths,
          acquiredDate: r.acquiredDate,
          assetAccountCode: r.assetAccountCode,
          depreciationAccountCode: r.depreciationAccountCode,
          accumulatedDepreciationAccountCode: "1290",
          notes: r.notes,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();

      inserted++;
      insertedIds.push(created.id);

      // Capitalize journal kalau toggle ON
      if (r.capitalize) {
        try {
          const lines = mapCapitalizeAsset({
            assetId: created.id,
            assetName: created.name,
            outletId: session.user.outletId,
            entryDate: created.acquiredDate as string,
            cost: Number(created.cost),
            assetAccountCode: created.assetAccountCode,
            paymentMethod: r.paymentMethod,
          });
          await recordJournal({
            outletId: session.user.outletId,
            entryDate: created.acquiredDate as string,
            description: `Pengadaan aset: ${created.name} (bulk import)`,
            sourceType: "manual",
            sourceId: created.id,
            lines,
            actorId: session.user.id,
          });
          capitalized++;
        } catch (e) {
          // Capitalize failure tidak block insert
          console.error("[bulk-import:capitalize]", e);
          errors.push({
            name: r.name,
            message: `Asset tersimpan, tapi journal capitalize gagal: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    } catch (e) {
      errors.push({
        name: r.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await logAudit({
    eventType: "fixed_asset.create",
    userId: session.user.id,
    entityType: "fixed_asset",
    entityId: insertedIds[0] ?? null,
    payload: {
      summary: `Bulk import aset tetap: ${inserted} sukses, ${capitalized} capitalized, ${errors.length} error`,
      context: { inserted, capitalized, errorCount: errors.length },
    },
  });

  return ok({ inserted, capitalized, errors });
}

export async function deactivateFixedAsset(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat deactivate aset");
  }

  const [existing] = await db
    .select()
    .from(fixedAssets)
    .where(
      and(
        eq(fixedAssets.id, id),
        eq(fixedAssets.outletId, session.user.outletId),
        isNull(fixedAssets.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Aset tidak ditemukan");

  await db
    .update(fixedAssets)
    .set({
      deletedAt: new Date(),
      deletedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(fixedAssets.id, id));

  await logAudit({
    eventType: "fixed_asset.deactivate",
    userId: session.user.id,
    entityType: "fixed_asset",
    entityId: id,
    payload: { summary: `Deactivate aset: ${existing.name}` },
  });

  return ok({ id });
}

// ============================================================
// Monthly Depreciation Run (Owner button)
// ============================================================

export type DepreciationPreflight = {
  /** First day of target month (YYYY-MM-DD). E.g. "2026-06-01" untuk Juni. */
  targetMonth: string;
  /** "Juni 2026". */
  targetMonthLabel: string;
  /** Per-asset preview entries. */
  assets: Array<{
    id: string;
    name: string;
    monthIndex: number;
    monthlyAmount: number;
    /** True kalau sudah pernah depreciated bulan ini (will be skipped). */
    alreadyDepreciatedThisMonth: boolean;
  }>;
  totalAmount: number;
  /** True kalau sudah ada journal entry sourceType='manual' dengan target month
   * description (informational, idempotency tetap via lastDepreciatedMonth). */
  alreadyPostedThisMonth: boolean;
};

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

function firstDayOfMonth(yyyymm: string): string {
  return `${yyyymm}-01`;
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MONTH_NAMES[m]} ${y}`;
}

/** Returns { yyyymm: '2026-06' } from a YYYY-MM-DD. */
function ymOf(iso: string): string {
  return iso.slice(0, 7);
}

export async function previewMonthlyDepreciation(
  targetYearMonth: string,
): Promise<ApiResult<DepreciationPreflight>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat preview depresiasi");
  }

  if (!/^\d{4}-\d{2}$/.test(targetYearMonth)) {
    return fail("VALIDATION", "Format target month harus YYYY-MM");
  }
  const targetMonth = firstDayOfMonth(targetYearMonth);
  const label = monthLabel(targetYearMonth);

  const assets = await db
    .select()
    .from(fixedAssets)
    .where(
      and(
        eq(fixedAssets.outletId, session.user.outletId),
        isNull(fixedAssets.deletedAt),
      ),
    );

  const previewItems: DepreciationPreflight["assets"] = [];
  let totalAmount = 0;

  for (const a of assets) {
    // Skip kalau acquired month > target month (asset belum exist).
    if (ymOf(a.acquiredDate as string) > targetYearMonth) continue;

    /* Sesi AE-214 — nomor bulan dihitung terhadap basis yang berlaku. Untuk
     * aset yang pernah dinilai ulang, "bulan ke-3" berarti bulan ketiga sejak
     * nilai barunya berlaku, bukan sejak dibeli — kalau tidak, angka di layar
     * tidak nyambung dengan jumlah yang dijurnal. */
    const sched = scheduleOfRow(a);
    const monthIndex = sched.basisMonth
      ? monthsBetweenIso(sched.basisMonth, targetMonth) + 1
      : monthsBetween(a.acquiredDate as string, targetMonth) + 1;

    const alreadyDepreciatedThisMonth =
      a.lastDepreciatedMonth !== null &&
      (a.lastDepreciatedMonth as string) >= targetMonth;

    if (alreadyDepreciatedThisMonth) {
      previewItems.push({
        id: a.id,
        name: a.name,
        monthIndex,
        monthlyAmount: 0,
        alreadyDepreciatedThisMonth: true,
      });
      continue;
    }

    const monthly = monthlyDepreciationFor(sched, targetMonth);
    if (monthly === 0) continue;

    previewItems.push({
      id: a.id,
      name: a.name,
      monthIndex,
      monthlyAmount: monthly,
      alreadyDepreciatedThisMonth: false,
    });
    totalAmount += monthly;
  }

  // Check if journal entry already exists untuk target month
  const [existing] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, session.user.outletId),
        eq(journalEntries.sourceType, "manual"),
        sql`${journalEntries.metadata}->>'depreciation_month' = ${targetYearMonth}`,
      ),
    )
    .limit(1);

  return ok({
    targetMonth,
    targetMonthLabel: label,
    assets: previewItems,
    totalAmount,
    alreadyPostedThisMonth: Boolean(existing),
  });
}

export async function postMonthlyDepreciation(
  targetYearMonth: string,
): Promise<ApiResult<{ entryId: string | null; assetsDepreciated: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "accounting.coa.manage")) {
    return fail("FORBIDDEN", "Hanya Owner yang dapat post depresiasi");
  }

  const preflight = await previewMonthlyDepreciation(targetYearMonth);
  if (!preflight.ok) return preflight as ApiResult<never>;
  if (preflight.data.alreadyPostedThisMonth) {
    return fail(
      "ALREADY_POSTED",
      `Depresiasi ${preflight.data.targetMonthLabel} sudah pernah di-post.`,
    );
  }

  const eligible = preflight.data.assets.filter(
    (a) => !a.alreadyDepreciatedThisMonth && a.monthlyAmount > 0,
  );
  if (eligible.length === 0) {
    return fail("NO_ASSETS", "Tidak ada aset yang perlu di-depreciate.");
  }

  // Fetch full asset rows lagi untuk get account codes.
  const assetRows = await db
    .select()
    .from(fixedAssets)
    .where(
      and(
        eq(fixedAssets.outletId, session.user.outletId),
        inArray(
          fixedAssets.id,
          eligible.map((a) => a.id),
        ),
      ),
    );

  const lines = (await import("./mapping")).mapMonthlyDepreciation({
    outletId: session.user.outletId,
    periodFirstDay: preflight.data.targetMonth,
    periodLabel: preflight.data.targetMonthLabel,
    assets: assetRows.map((a) => {
      const preview = eligible.find((p) => p.id === a.id)!;
      return {
        assetId: a.id,
        assetName: a.name,
        cost: Number(a.cost),
        salvageValue: Number(a.salvageValue),
        usefulLifeMonths: a.usefulLifeMonths,
        depreciationAccountCode: a.depreciationAccountCode,
        accumulatedDepreciationAccountCode:
          a.accumulatedDepreciationAccountCode,
        monthIndex: preview.monthIndex,
        /* Sesi AE-214 — nilai yang DIPOSTING diambil dari pratinjau, bukan
         * dihitung ulang di mapper. Aset yang pernah dinilai ulang punya dasar
         * hitung berbeda (nilai baru ÷ sisa umur); menghitungnya dua kali di
         * dua tempat adalah cara paling gampang membuat angka yang dilihat
         * owner beda dengan angka yang masuk buku. */
        amount: preview.monthlyAmount,
      };
    }),
  });

  // Last day of target month untuk entryDate.
  const [yyyy, mm] = targetYearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(yyyy, mm, 0)).toISOString().slice(0, 10);

  let entryId: string | null = null;
  try {
    const result = await recordJournal({
      outletId: session.user.outletId,
      entryDate: lastDay,
      description: `Depresiasi ${preflight.data.targetMonthLabel}`,
      sourceType: "manual",
      sourceId: null,
      lines,
      actorId: session.user.id,
      metadata: {
        depreciation_month: targetYearMonth,
        asset_count: eligible.length,
      },
    });
    entryId = result.entryId;
  } catch (e) {
    return fail("DB_ERROR", logAndSanitize(e, "accounting", "Operasi database gagal"));
  }

  // Update lastDepreciatedMonth per asset
  await db
    .update(fixedAssets)
    .set({
      lastDepreciatedMonth: preflight.data.targetMonth,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(fixedAssets.outletId, session.user.outletId),
        inArray(
          fixedAssets.id,
          eligible.map((a) => a.id),
        ),
      ),
    );

  await logAudit({
    eventType: "fixed_asset.depreciation",
    userId: session.user.id,
    entityType: "journal_entry",
    entityId: entryId ?? null,
    payload: {
      summary: `Depresiasi ${preflight.data.targetMonthLabel} (${eligible.length} aset, total Rp ${preflight.data.totalAmount.toLocaleString("id-ID")})`,
      context: { targetMonth: targetYearMonth, assetCount: eligible.length },
    },
  });

  return ok({ entryId, assetsDepreciated: eligible.length });
}
