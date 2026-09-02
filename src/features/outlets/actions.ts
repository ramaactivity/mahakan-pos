"use server";

import { and, count, eq, gt, ilike, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  employeeAdvances,
  fixedAssets,
  incomes,
  outlets,
  purchases,
  shifts,
  stockOpnameSessions,
} from "@/db/schema";
import type { OperationalHours, OutletSettings } from "@/db/schema/outlets";
import { currentMonthWib } from "@/lib/month-wib";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit/logger";
import type { ApiResult, Outlet } from "./types";

function err(code: string, message: string): ApiResult<never> {
  return { success: false, error: { code, message } };
}

async function requirePerm(perm: Permission) {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  if (!hasPermission(session.user.role, perm)) {
    throw new Error(`FORBIDDEN:${perm}`);
  }
  return session;
}

export async function getOwnOutlet(): Promise<ApiResult<Outlet>> {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", "No session");
  const [row] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!row) return err("NOT_FOUND", "Outlet tidak ditemukan");
  return { success: true, data: row };
}

// ---------- Business Info ----------

const businessInfoSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib").max(100),
  address: z.string().trim().max(500).nullable(),
  phone: z.string().trim().max(40).nullable(),
  logoUrl: z.string().trim().max(500).nullable(),
});

export type UpdateBusinessInfoInput = z.infer<typeof businessInfoSchema>;

export async function updateBusinessInfo(
  input: UpdateBusinessInfoInput,
): Promise<ApiResult<Outlet>> {
  let session;
  try {
    session = await requirePerm("settings.business.update");
  } catch (e) {
    const m = e instanceof Error ? e.message : "FORBIDDEN";
    return err(m.startsWith("FORBIDDEN") ? "FORBIDDEN" : "UNAUTHORIZED", m);
  }

  const parsed = businessInfoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const [row] = await db
    .update(outlets)
    .set({
      name: v.name,
      address: v.address?.trim() || null,
      phone: v.phone?.trim() || null,
      logoUrl: v.logoUrl?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  const beforeSnap = {
    name: before.name,
    address: before.address,
    phone: before.phone,
    logoUrl: before.logoUrl,
  };
  const afterSnap = {
    name: row.name,
    address: row.address,
    phone: row.phone,
    logoUrl: row.logoUrl,
  };
  const diff = diffShallow(beforeSnap, afterSnap);
  if (diff) {
    await logAudit({
      eventType: "settings.update",
      userId: session.user.id,
      entityType: "outlet",
      entityId: row.id,
      payload: {
        summary: "Update info bisnis",
        before: beforeSnap,
        after: afterSnap,
        diff,
        context: { section: "business" },
      },
      metadata: { outletId: row.id, actorRole: session.user.role },
    });
  }

  return { success: true, data: row };
}

// ---------- Operational Hours ----------

const dayHoursSchema = z
  .object({
    isOpen: z.boolean(),
    openTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Format jam HH:MM")
      .optional(),
    closeTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Format jam HH:MM")
      .optional(),
  })
  .refine(
    (h) => !h.isOpen || (h.openTime && h.closeTime),
    "Hari buka harus punya jam buka & jam tutup",
  );

const operationalHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

export async function updateOperationalHours(
  input: OperationalHours,
): Promise<ApiResult<Outlet>> {
  let session;
  try {
    session = await requirePerm("settings.hours.update");
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }

  const parsed = operationalHoursSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const [row] = await db
    .update(outlets)
    .set({ operationalHours: parsed.data, updatedAt: new Date() })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  await logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: row.id,
    payload: {
      summary: "Update jam operasional",
      before: { operationalHours: before.operationalHours },
      after: { operationalHours: row.operationalHours },
      context: { section: "operationalHours" },
    },
    metadata: { outletId: row.id, actorRole: session.user.role },
  });

  return { success: true, data: row };
}

// ---------- Receipt + Thresholds + Features (settings JSONB) ----------

const receiptSchema = z.object({
  footerText: z.string().trim().max(200).optional(),
  showQrRating: z.boolean().optional(),
  headerLines: z
    .array(z.string().trim().max(64))
    .max(3, "Maksimal 3 baris header")
    .optional(),
  wifiSsid: z.string().trim().max(48).optional(),
  wifiPassword: z.string().trim().max(48).optional(),
  extraFooterLines: z
    .array(z.string().trim().max(64))
    .max(3, "Maksimal 3 baris tambahan footer")
    .optional(),
});

const thresholdsSchema = z.object({
  shiftVarianceAlert: z.number().int().min(0).max(99_999_999),
});

const featuresSchema = z.object({
  showHppToStaff: z.boolean().optional(),
  loyaltyEnabled: z.boolean().optional(),
  recipeEnabled: z.boolean().optional(),
  multiOutletEnabled: z.boolean().optional(),
  /** Sesi T+: when true, auto-journal hooks fire on POS sale / refund /
   * payroll / cash deposit / aggregator settlement / shift variance. Default
   * off — Owner toggle ON post-test (verify sample journal entry benar). */
  accounting_auto_journal: z.boolean().optional(),
  /** Phase 7.2 — markup% untuk auto-suggest harga jual dari BOM cost.
   * Range 0-500. Default 250% kalau tidak set. */
  defaultMarkupPct: z.number().int().min(0).max(500).optional(),
  /** Sesi AE-173 — inventory mode. Default (undefined) = perpetual (lama).
   * false → stok hanya dari Opname (penjualan/pembelian tak menggerakkan stok). */
  perpetualStockSales: z.boolean().optional(),
  perpetualStockPurchases: z.boolean().optional(),
  /**
   * Sesi AE-193 — tanggal mulai jurnal penjualan HARIAN (YYYY-MM-DD).
   *
   * Sengaja tanggal, bukan sakelar: transaksi SEBELUM tanggal ini tetap punya
   * jurnal per-transaksi (riwayat tidak disentuh), sejak tanggal ini penjualan
   * diringkas jadi satu jurnal per hari. Dengan begitu cutover tidak pernah
   * menghasilkan hari yang terjurnal dua kali maupun yang bolong.
   *
   * null = matikan lagi (kembali ke jurnal per transaksi).
   */
  dailyJournalSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
    .nullable()
    .optional(),
});

const attendanceSettingsSchema = z.object({
  lateGraceMinutes: z.number().int().min(0).max(60).optional(),
  /** Phase 4 (sesi AB) — outlet GPS center untuk validasi mobile absensi.
   * Karyawan harus dalam radius dari (lat,lng) saat clock-in/out.
   * Indonesia bbox: lat -11..6, lng 95..141. */
  gpsCenter: z
    .object({
      lat: z.number().min(-11).max(6),
      lng: z.number().min(95).max(141),
      radiusMeters: z.number().int().min(10).max(500),
    })
    .optional(),
});

const payrollSettingsSchema = z.object({
  latePerMinute: z.number().int().min(0).max(99_999).optional(),
  overtimePerMinute: z.number().int().min(0).max(99_999).optional(),
  /** Sesi AE-62ac — bonus untuk karyawan double-shift / full-shift.
   * Optional — kalau owner unset, fitur off (bonus=0).
   * minMinutes default 600 (10 jam). bonusType "fixed"|"multiplier". */
  doubleShift: z
    .object({
      minMinutes: z.number().int().min(60).max(1440),
      bonusType: z.enum(["fixed", "multiplier"]),
      bonusValue: z.number().min(0).max(10_000_000),
    })
    .nullable()
    .optional(),
  thrMonthlyBaseMultiplier: z.number().min(0).max(10).optional(),
});

/* Sesi AE-53 — schedule shift templates editable per outlet.
 * Validate label unique + HH:mm format + start < end (atau OFF). */
const timeHHmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:mm");

const scheduleTemplatesSchema = z.object({
  templates: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(20),
        start: timeHHmm,
        end: timeHHmm,
        /* Sesi AE-222 — kelompok template (Weekday/Weekend). Optional:
         * template lama tanpa group tetap valid, di UI masuk "Lainnya". */
        group: z.enum(["weekday", "weekend"]).optional(),
      }),
    )
    .min(1, "Minimal 1 template")
    .max(10, "Maksimal 10 template"),
});

const approvalSchema = z.object({
  /* Sesi AE-229 — "pin_or_code": PIN manager di tempat ATAU kode Owner. */
  voidMode: z.enum(["pin", "code", "pin_or_code"]).optional(),
  refundMode: z.enum(["pin", "code", "pin_or_code"]).optional(),
  /** @deprecated kept for back-compat */
  notifyEmail: z
    .string()
    .trim()
    .max(120)
    .optional()
    .refine(
      (s) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
      "Email tidak valid",
    ),
  /** New: multi-recipient. Each entry validated individually. Max 10
   * to prevent abuse. */
  notifyEmails: z
    .array(
      z
        .string()
        .trim()
        .max(120)
        .refine(
          (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
          "Email tidak valid",
        ),
    )
    .max(10, "Maksimal 10 email tujuan")
    .optional(),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const booksCutoffSchema = z.object({
  /** null / "" = matikan cutoff (tampilkan semua data lagi). */
  date: z
    .string()
    .regex(ISO_DATE, "Format tanggal harus YYYY-MM-DD")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  opnameDate: z
    .string()
    .regex(ISO_DATE, "Format tanggal harus YYYY-MM-DD")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  note: z.string().max(300).nullable().optional(),
});

async function updateSettingsSection(
  perm: Permission,
  section:
    | "receipt"
    | "thresholds"
    | "features"
    | "approval"
    | "attendance"
    | "payroll"
    | "openingBalance"
    | "booksCutoff"
    | "dividen",
  patch: Partial<OutletSettings[keyof OutletSettings]>,
): Promise<ApiResult<Outlet>> {
  let session;
  try {
    session = await requirePerm(perm);
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const beforeSettings: OutletSettings = before.settings ?? {};
  const merged: OutletSettings = {
    ...beforeSettings,
    [section]: { ...(beforeSettings[section] ?? {}), ...patch },
  };

  const [row] = await db
    .update(outlets)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  await logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: row.id,
    payload: {
      summary: `Update settings.${section}`,
      before: { [section]: beforeSettings[section] },
      after: { [section]: row.settings?.[section] },
      context: { section },
    },
    metadata: { outletId: row.id, actorRole: session.user.role },
  });

  return { success: true, data: row };
}

export async function updateReceiptSettings(
  input: z.input<typeof receiptSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.receipt.update",
    "receipt",
    parsed.data,
  );
}

export async function updateThresholds(
  input: z.input<typeof thresholdsSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = thresholdsSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.thresholds.update",
    "thresholds",
    parsed.data,
  );
}

/**
 * Sesi AE-207 — BATAS BUKU (cutoff). Sembunyikan data sebelum tanggal ini
 * dari semua halaman, TANPA menghapusnya. Owner-only.
 *
 * Kirim `date: null` untuk MEMATIKAN cutoff → seluruh data lama muncul lagi
 * seketika. Ini jalan keluar owner kalau suatu saat butuh nota/laporan lama
 * (audit, pajak) tanpa perlu memanggil developer.
 *
 * `opnameDate` sengaja terpisah: sesi opname akhir bulan sebelum cutoff
 * adalah STOK AWAL periode baru dan wajib tetap terlihat, kalau tidak laporan
 * pemakaian bahan periode baru rusak. Kalau dikosongkan, ikut `date`.
 */
export async function updateBooksCutoff(
  input: z.input<typeof booksCutoffSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = booksCutoffSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const { date, opnameDate, note } = parsed.data;
  return updateSettingsSection(
    "accounting.opening_balance.input",
    "booksCutoff",
    date
      ? {
          date,
          opnameDate: opnameDate ?? date,
          note: note ?? undefined,
          setAt: new Date().toISOString(),
        }
      : /* Mematikan: kosongkan `date`. `getBooksCutoff()` menganggap cutoff
         * mati kalau `date` tidak valid, jadi cukup ini — tak perlu menghapus
         * key-nya, dan jejak kapan pernah aktif tetap ada di `setAt`. */
        { date: null, opnameDate: null, setAt: new Date().toISOString() },
  );
}

export async function updateFeatures(
  input: z.input<typeof featuresSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = featuresSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.features.update",
    "features",
    parsed.data,
  );
}

export async function updateApproval(
  input: z.input<typeof approvalSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.approval.update",
    "approval",
    parsed.data,
  );
}

export async function updateAttendanceSettings(
  input: z.input<typeof attendanceSettingsSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = attendanceSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "schedule.update",
    "attendance",
    parsed.data,
  );
}

export async function updatePayrollSettings(
  input: z.input<typeof payrollSettingsSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = payrollSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "payroll.manage",
    "payroll",
    parsed.data,
  );
}

/* Sesi AE-80 — Modal & Dividen v2 settings.
 *
 * Owner toggle waterfall v2 + edit default rate. Permission:
 * 'distribution.approve' (owner-only) supaya change config audited
 * dan tidak bisa di-flip oleh manager. */
const dividenSettingsSchema = z.object({
  useWaterfallV2: z.boolean().optional(),
  defaultPayoutRatioPct: z.number().min(0).max(100).optional(),
  defaultLossPct: z.number().min(0).max(100).optional(),
  defaultCapexPct: z.number().min(0).max(100).optional(),
  investorPoolPct: z.number().min(0).max(100).optional(),
});

export async function updateDividenSettings(
  input: z.input<typeof dividenSettingsSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = dividenSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "distribution.approve",
    "dividen",
    parsed.data,
  );
}

/* Sesi AE-70 — Opening balance checklist progress persistence.
 * State per-outlet di outlets.settings.openingBalance JSONB.
 * Permission: pakai `settings.business.update` (owner + manager) — owner
 * yang biasanya isi, manager kadang assist staff finance.
 */
const openingBalanceSchema = z.object({
  trialStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  steps: z
    .record(z.string(), z.enum(["done", "skip", "pending"]))
    .optional(),
  updatedAt: z.string().optional(),
});

export async function updateOpeningBalance(
  input: z.input<typeof openingBalanceSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = openingBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.business.update",
    "openingBalance",
    { ...parsed.data, updatedAt: new Date().toISOString() },
  );
}

/* Sesi AE-74 — Auto-detect status per checklist item Rekonsiliasi.
 * Tujuan: owner tidak perlu manual klik "Tandai Selesai" untuk step
 * yang datanya sudah eksis di sistem. Cek programmatically apakah ada:
 *   - opname session
 *   - shift dengan openingCash > 0
 *   - kasbon outstanding
 *   - purchase TOP outstanding
 *   - fixed assets
 *   - income dengan deskripsi "Saldo Awal" (proxy bank balance setup)
 *
 * Read-only — tidak update settings. UI yang decide apakah auto-mark
 * checkbox berdasarkan hasil ini. Owner masih bisa override manual. */
export interface OpeningBalanceAutoStatus {
  stockOpnameCount: number;
  shiftWithOpeningCashCount: number;
  outstandingKasbonCount: number;
  outstandingTopPurchaseCount: number;
  fixedAssetsCount: number;
  saldoAwalIncomeCount: number;
}

export async function getOpeningBalanceAutoStatus(): Promise<
  ApiResult<OpeningBalanceAutoStatus>
> {
  let session;
  try {
    session = await requirePerm("settings.business.update");
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }
  const outletId = session.user.outletId;

  /* 6 parallel COUNT queries — each fast (indexed). */
  const [opname, shiftOpen, kasbon, topPurchase, assets, saldoAwalInc] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(stockOpnameSessions)
        .where(eq(stockOpnameSessions.outletId, outletId)),
      db
        .select({ n: count() })
        .from(shifts)
        .where(
          and(
            eq(shifts.outletId, outletId),
            gt(shifts.openingCash, 0),
          ),
        ),
      db
        .select({ n: count() })
        .from(employeeAdvances)
        .where(
          and(
            eq(employeeAdvances.outletId, outletId),
            eq(employeeAdvances.status, "pending"),
          ),
        ),
      db
        .select({ n: count() })
        .from(purchases)
        .where(
          and(
            eq(purchases.outletId, outletId),
            eq(purchases.paymentMethod, "top"),
            eq(purchases.status, "pending_payment"),
          ),
        ),
      db
        .select({ n: count() })
        .from(fixedAssets)
        .where(
          and(eq(fixedAssets.outletId, outletId), isNull(fixedAssets.deletedAt)),
        ),
      db
        .select({ n: count() })
        .from(incomes)
        .where(
          and(
            eq(incomes.outletId, outletId),
            isNull(incomes.deletedAt),
            ilike(incomes.description, "%saldo awal%"),
          ),
        ),
    ]);

  return {
    success: true,
    data: {
      stockOpnameCount: Number(opname[0]?.n ?? 0),
      shiftWithOpeningCashCount: Number(shiftOpen[0]?.n ?? 0),
      outstandingKasbonCount: Number(kasbon[0]?.n ?? 0),
      outstandingTopPurchaseCount: Number(topPurchase[0]?.n ?? 0),
      fixedAssetsCount: Number(assets[0]?.n ?? 0),
      saldoAwalIncomeCount: Number(saldoAwalInc[0]?.n ?? 0),
    },
  };
}

/* Sesi AE-55 — revenue targets harian/mingguan/bulanan/tahunan.
 * Owner-only. Semua field optional non-negative integer. Kosong = hapus. */
const targetsSchema = z.object({
  dailyRevenue: z.number().int().min(0).max(9_999_999_999).optional(),
  weeklyRevenue: z.number().int().min(0).max(9_999_999_999).optional(),
  monthlyRevenue: z.number().int().min(0).max(9_999_999_999).optional(),
  yearlyRevenue: z.number().int().min(0).max(9_999_999_999).optional(),
});

export async function updateRevenueTargets(
  input: z.input<typeof targetsSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = targetsSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }

  let session;
  try {
    session = await requirePerm("settings.targets.update");
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const beforeSettings: OutletSettings = before.settings ?? {};

  /* Sesi AE-223 — kunci target bulanan untuk BULAN BERJALAN setiap kali
   * disimpan. Tanpa ini, mengubah target bulan depan diam-diam menilai ulang
   * pencapaian bulan-bulan lampau dengan patokan yang tidak pernah berlaku
   * saat itu. Dihitung lewat kalender WIB, bukan zona mesin. */
  const historyBefore = beforeSettings.targets?.monthlyHistory ?? {};
  const monthlyHistory =
    parsed.data.monthlyRevenue === undefined
      ? historyBefore
      : {
          ...historyBefore,
          [currentMonthWib()]: parsed.data.monthlyRevenue,
        };

  const merged: OutletSettings = {
    ...beforeSettings,
    targets: {
      ...(beforeSettings.targets ?? {}),
      ...parsed.data,
      monthlyHistory,
      updatedAt: new Date().toISOString(),
    },
  };

  const [row] = await db
    .update(outlets)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  await logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: row.id,
    payload: {
      summary: "Update revenue targets",
      before: { targets: beforeSettings.targets ?? null },
      after: { targets: row.settings?.targets ?? null },
      context: { section: "targets" },
    },
    metadata: { outletId: row.id, actorRole: session.user.role },
  });

  return { success: true, data: row };
}

/**
 * Sesi AE-53 — update schedule shift templates per outlet. Replace whole
 * array (bukan merge per field karena value adalah array, bukan object).
 *
 * Permission: schedule.update (Owner + Manager). Validation: 1-10 entries,
 * label 1-20 char, time HH:mm format.
 */
export async function updateScheduleTemplates(
  input: z.input<typeof scheduleTemplatesSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = scheduleTemplatesSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }

  let session;
  try {
    session = await requirePerm("schedule.update");
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const beforeSettings: OutletSettings = before.settings ?? {};
  const merged: OutletSettings = {
    ...beforeSettings,
    scheduleTemplates: parsed.data.templates,
  };

  const [row] = await db
    .update(outlets)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  await logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: row.id,
    payload: {
      summary: `Update settings.scheduleTemplates (${parsed.data.templates.length} templates)`,
      before: { scheduleTemplates: beforeSettings.scheduleTemplates ?? [] },
      after: { scheduleTemplates: parsed.data.templates },
      context: { section: "scheduleTemplates" },
    },
    metadata: { outletId: row.id, actorRole: session.user.role },
  });

  return { success: true, data: row };
}


/**
 * Sesi AE-223 — kunci target bulanan untuk SATU bulan tertentu.
 *
 * Dipakai owner untuk mencatat target yang dulu benar-benar berlaku di bulan
 * lampau (backfill), atau memasang target bulan berjalan tanpa mengubah
 * target "berlaku sekarang" yang dipakai kartu progres berjalan.
 *
 * `amount` null = hapus catatan bulan itu; pencapaiannya kembali dinyatakan
 * "tidak tercatat" alih-alih dinilai dengan patokan yang salah.
 */
export async function setMonthlyTargetForMonth(input: {
  month: string;
  amount: number | null;
}): Promise<ApiResult<Outlet>> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    return err("VALIDATION_ERROR", "Bulan harus format YYYY-MM");
  }
  if (
    input.amount !== null &&
    (!Number.isInteger(input.amount) ||
      input.amount < 0 ||
      input.amount > 9_999_999_999)
  ) {
    return err("VALIDATION_ERROR", "Nominal target tidak valid");
  }

  let session;
  try {
    session = await requirePerm("settings.targets.update");
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const beforeSettings: OutletSettings = before.settings ?? {};
  const history = { ...(beforeSettings.targets?.monthlyHistory ?? {}) };
  if (input.amount === null) delete history[input.month];
  else history[input.month] = input.amount;

  const merged: OutletSettings = {
    ...beforeSettings,
    targets: {
      ...(beforeSettings.targets ?? {}),
      monthlyHistory: history,
      updatedAt: new Date().toISOString(),
    },
  };

  const [row] = await db
    .update(outlets)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  await logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: row.id,
    payload: {
      summary:
        input.amount === null
          ? `Hapus target bulan ${input.month}`
          : `Set target bulan ${input.month} = ${input.amount.toLocaleString("id-ID")}`,
      before: { month: input.month, amount: beforeSettings.targets?.monthlyHistory?.[input.month] ?? null },
      after: { month: input.month, amount: input.amount },
      context: { section: "targets" },
    },
    metadata: { outletId: row.id, actorRole: session.user.role },
  });

  return { success: true, data: row };
}
