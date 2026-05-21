import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  decimal,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { investors } from "./investors";

/**
 * Sesi AE-80 — Kreditur (pemberi pinjaman) Mahakan.
 *
 * Berbeda dari `investors` (modal equity, dapat share dividen) — kreditur
 * adalah pemberi pinjaman dengan kontrak hutang + bunga. Tidak ikut
 * dividen pool. Saat repayment dibayar: Dr 2150 Hutang Kreditur (pokok)
 * + Dr 5301 Beban Bunga (bunga) / Cr 1101 Kas.
 *
 * `principalOriginal` = pokok awal (snapshot, jangan diubah setelah created).
 * `principalOutstanding` = sisa pokok berjalan (denormalized, di-maintain
 * service layer saat repayment). CHECK constraint guarantee non-negative.
 *
 * Bunga model: simple — `interestRatePct` per `interestPeriod`. Saat
 * repayment, owner manual input principal + interest split (atau
 * auto-calc dari outstanding × rate kalau monthly). Tidak ada amortization
 * schedule auto-generate (kompleksitas untuk Phase 2+).
 */
export const creditors = pgTable(
  "creditors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    // Identity
    fullName: text("full_name").notNull(),
    nickname: text("nickname"),
    /** KTP/NPWP optional. */
    nik: text("nik"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),

    // Bank info untuk transfer pembayaran cicilan
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankAccountHolderName: text("bank_account_holder_name"),

    /** Pokok awal pinjaman (Rupiah, snapshot, immutable setelah created). */
    principalOriginal: bigint("principal_original", { mode: "number" })
      .notNull(),
    /** Sisa pokok berjalan (denormalized, decrement saat repayment posted). */
    principalOutstanding: bigint("principal_outstanding", { mode: "number" })
      .notNull()
      .default(0),

    /** Bunga rate (per periode). Decimal(5,2) cukup untuk 0.00-100.00%. */
    interestRatePct: decimal("interest_rate_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0.00"),
    /** Period bunga: monthly/yearly/flat. 'flat' = bunga sekali fix. */
    interestPeriod: text("interest_period", {
      enum: ["monthly", "yearly", "flat"],
    })
      .notNull()
      .default("monthly"),

    startDate: date("start_date").notNull(),
    /** Optional jatuh tempo. Null = open-ended. */
    dueDate: date("due_date"),

    status: text("status", {
      enum: ["active", "settled", "defaulted"],
    })
      .notNull()
      .default("active"),

    notes: text("notes"),

    /* Sesi AE-80 follow-up — Convert / link investor → kreditur.
     *
     * `linkedInvestorId` non-null = kreditur ini hasil convert dari investor
     * yang exited (atau dikaitkan ke profil investor existing untuk auto-fill
     * kontak/bank, tanpa convert). Nullable supaya tetap allow kreditur baru
     * yang murni pihak eksternal (tidak pernah jadi investor).
     *
     * `convertedFromInvestorAt` non-null hanya kalau row hasil convert
     * (bukan sekadar link). Saat convert dibuka, kita post journal
     * Dr 3101 Modal Owner / Cr 2150 Hutang Kreditur untuk re-classify
     * equity → liability. */
    linkedInvestorId: uuid("linked_investor_id").references(
      () => investors.id,
    ),
    convertedFromInvestorAt: timestamp("converted_from_investor_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("idx_creditors_outlet_status").on(t.outletId, t.status),
    /* NIK unique per outlet kalau di-set (mirror investors pattern). */
    uniqueIndex("ux_creditors_outlet_nik")
      .on(t.outletId, t.nik)
      .where(sql`${t.nik} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check(
      "ck_creditors_principal_original_nonneg",
      sql`${t.principalOriginal} >= 0`,
    ),
    check(
      "ck_creditors_principal_outstanding_nonneg",
      sql`${t.principalOutstanding} >= 0`,
    ),
    check(
      "ck_creditors_principal_outstanding_lte_original",
      sql`${t.principalOutstanding} <= ${t.principalOriginal}`,
    ),
    check(
      "ck_creditors_interest_rate_range",
      sql`${t.interestRatePct}::numeric BETWEEN 0 AND 100`,
    ),
    check(
      "ck_creditors_due_after_start",
      sql`${t.dueDate} IS NULL OR ${t.dueDate} >= ${t.startDate}`,
    ),
    /* Sesi AE-80 follow-up — index lookup linked_investor_id (jarang query
     * tapi non-trivial saat owner buka detail kreditur "ini dulu investor
     * siapa"). Partial index: skip null. */
    index("idx_creditors_linked_investor").on(t.linkedInvestorId),
  ],
);
