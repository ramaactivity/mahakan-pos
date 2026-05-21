import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

export type OperationalHours = {
  [day in "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"]: {
    isOpen: boolean;
    openTime?: string;
    closeTime?: string;
  };
};

export type OutletSettings = {
  features?: {
    loyaltyEnabled?: boolean;
    recipeEnabled?: boolean;
    multiOutletEnabled?: boolean;
    showHppToStaff?: boolean;
    /** Sesi T+: master switch untuk Phase 2 accounting auto-journal hooks.
     * Default false. Owner toggle true SETELAH test sample transaction +
     * verify journal entry benar di Admin → Akuntansi → Jurnal. */
    accounting_auto_journal?: boolean;
    /** Phase 7.2 (sesi AB) — default markup percentage untuk auto-suggest
     * harga jual berdasar BOM cost. Suggested price = COGS × (1 + pct/100).
     * Owner bisa override per item. Default 250% kalau tidak set. Range
     * 0..500. */
    defaultMarkupPct?: number;
  };
  receipt?: {
    /** Existing: short text below "Terima kasih" line. */
    footerText?: string;
    showQrRating?: boolean;
    /** New: 1-3 lines printed above the outlet name (promo banners). */
    headerLines?: string[];
    /** New: WiFi credentials printed in the footer area for customers. */
    wifiSsid?: string;
    wifiPassword?: string;
    /** New: 1-3 free-form lines printed after the footer (notes, IG, etc). */
    extraFooterLines?: string[];
  };
  thresholds?: {
    shiftVarianceAlert?: number;
  };
  approval?: {
    /** void/refund approval source. "pin" = legacy ApproverOverrideModal
     * (Owner+Manager PIN); "code" = new email-delivered Owner-only 6-digit
     * code via ApprovalCodeModal. Default "pin" so existing field-test
     * isn't disrupted. Owner flips to "code" after team training. */
    voidMode?: "pin" | "code";
    refundMode?: "pin" | "code";
    /** @deprecated single-email — superseded by `notifyEmails` array.
     * Read by resolveApprovalEmail as fallback when notifyEmails empty. */
    notifyEmail?: string;
    /** List of recipient emails — code is sent to ALL of them so any
     * Owner/Manager available can forward to staff. Empty = fallback to
     * first active Owner's user.email. */
    notifyEmails?: string[];
  };
  /** HR attendance config (Sesi D + Phase 4 sesi AB). */
  attendance?: {
    /** Minutes after schedule start_time before late detection trips.
     * Default 5 if unset. Range 0..60. */
    lateGraceMinutes?: number;
    /** Phase 4 — outlet GPS center untuk validasi radius mobile absensi.
     * Karyawan harus dalam radius `radiusMeters` dari (lat,lng) saat
     * clock-in/out via `/absenkaryawan`. Kalau tidak di-set, fallback
     * ke default Mahakan Coffee & Space (-6.6753234, 106.9298715, 50m). */
    gpsCenter?: {
      lat: number;
      lng: number;
      radiusMeters: number;
    };
  };
  /** Sesi AE-53 — Schedule shift templates editable per outlet.
   * HR pakai untuk quick-fill jam saat edit schedule (Pagi/Siang/Sore/Full).
   * Default kalau tidak set: lihat DEFAULT_SHIFT_TEMPLATES di SchedulesSection.tsx.
   * Owner edit via Back Office → Settings → Template Shift. */
  scheduleTemplates?: Array<{
    label: string;
    start: string; // HH:mm
    end: string; // HH:mm
  }>;
  /** Payroll formula auto-fill (Sesi E). When set, computePayrollLines
   * derives late_deduction + overtime_pay from these rates × the
   * matching minute totals on each line. Owner can still override per
   * line via UpdatePayrollLine. Both null/0 = no auto-fill (Owner
   * computes manually). Rupiah-per-minute for granularity. */
  payroll?: {
    /** Rp per minute deducted for lateness. Example: Rp 200/m × 30m
     * late = Rp 6,000 deduction. */
    latePerMinute?: number;
    /** Rp per minute paid for overtime. Example: Rp 300/m × 60m OT
     * = Rp 18,000 OT pay. */
    overtimePerMinute?: number;
    /** Sesi AE-60 — multiplier untuk auto-suggest THR (Tunjangan Hari
     * Raya). Default 1.0 = 1× baseSalary (UU Indonesia). Owner edit di
     * settings kalau pakai konvensi lain. */
    thrMonthlyBaseMultiplier?: number;
    /** Sesi AE-62ac — bonus tambahan untuk karyawan yang kerja
     * double-shift / full-shift (mis. pagi+sore = 8:00-23:00 untuk weekend
     * Mahakan, atau hari raya). Berlaku untuk fixed + daily salary
     * employees (per owner directive: keduanya dapat tambahan).
     *
     * Detection: attendance.workMinutes >= doubleShiftMinMinutes per hari
     * → flag sebagai double, owner-config bonus diterapkan.
     *
     * Default kalau undefined: feature off (tidak ada bonus). */
    doubleShift?: {
      /** Minimum workMinutes per hari untuk dianggap double-shift.
       * Default 600 (= 10 jam). Weekend Mahakan full-shift 8:00-23:00 =
       * 15 jam → easily passes. Normal weekday shift 14:00-22:00 = 8 jam
       * → tidak pass. */
      minMinutes: number;
      /** Tipe bonus:
       *   - "fixed": tambahan flat amount per hari double (mis. Rp 100k).
       *   - "multiplier": basePerDay × multiplier (mis. 1.5× = 50% extra).
       *     Untuk fixed salary employees, baseDailyAmount = monthlySalary
       *     / 30 (atau scheduled days kalau owner config).
       */
      bonusType: "fixed" | "multiplier";
      /** Untuk fixed: rupiah. Untuk multiplier: decimal (1.5 = 1.5×). */
      bonusValue: number;
    } | null;
  };
  /** Sesi AE-63 — Profit distribution config (Modal & Dividen). Default
   *  per Sheets owner Mahakan. Editable di Settings → Modal & Dividen. */
  dividendConfig?: {
    /** % dari Net Profit. Default 10.00. */
    bagiHasilPct: number;
    /** Loss buffer reserve % dari Net Profit. Default 3.00. */
    lossPct: number;
    /** Capex reserve % dari Net Profit. Default 0.70. */
    capexPct: number;
    /** Retained earnings tertahan eksplisit % (residue dari rounding
     *  auto masuk juga ke retained). Default 0.20. */
    retainedPct: number;
    /** Pool split investor vs pengelola dalam Bagi Hasil. Total 100. */
    investorPoolPct: number;
    pengelolaPoolPct: number;
  };
  /** Sesi AE-55 — Revenue targets untuk indikator progress di Laporan.
   * Semua nilai dalam Rupiah, optional. Null/undefined = belum ada target. */
  targets?: {
    dailyRevenue?: number;
    weeklyRevenue?: number;
    monthlyRevenue?: number;
    yearlyRevenue?: number;
    /** ISO timestamp last edit, untuk audit/staleness check. */
    updatedAt?: string;
  };
  /** Sesi AE-70 — Opening balance checklist progress (Rekonsiliasi).
   * Persisted di server supaya tidak hilang antar device/browser. */
  openingBalance?: {
    /** Tanggal trial start — POS efektif dipakai harian per tanggal ini. */
    trialStartDate?: string;
    /** State per checklist step. Key = step.key dari OpeningBalanceChecklist. */
    steps?: Record<string, "done" | "skip" | "pending">;
    /** ISO timestamp last update untuk audit. */
    updatedAt?: string;
  };
};

export const outlets = pgTable("outlets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  logoUrl: text("logo_url"),
  operationalHours: jsonb("operational_hours").$type<OperationalHours>(),
  settings: jsonb("settings").$type<OutletSettings>().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
