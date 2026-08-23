import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi S — Accounting tier (Phase 2): foundational schema for double-entry
 * general ledger on top of existing single-entry Finance/Keuangan module.
 *
 * Cutover date: 2026-06-01. Pre-cutover transactions tidak di-journal —
 * akses via Finance views existing.
 *
 * 4 tables:
 *  - chart_of_accounts: ~52 default accounts seeded, custom account allowed
 *  - accounting_periods: monthly buckets, state machine open→closed→locked
 *  - journal_entries (header): per economic event, idempotent via (sourceType, sourceId)
 *  - journal_lines (detail): debit/credit lines, must balance per entry
 *
 * No journal posting actions sesi S — schema + COA + read-only UI saja.
 * Auto-journal hooks shipped sesi T+.
 *
 * Refer: docs/10-ACCOUNTING-DESIGN.md §3 untuk full spec.
 */

// ---------- chart_of_accounts ----------

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    code: text("code").notNull(), // e.g. "1101"
    name: text("name").notNull(), // e.g. "Kas Tunai (Drawer POS)"

    type: text("type", {
      enum: ["asset", "liability", "equity", "revenue", "cogs", "expense"],
    }).notNull(),

    normalBalance: text("normal_balance", {
      enum: ["debit", "credit"],
    }).notNull(),

    parentCode: text("parent_code"), // informational grouping, e.g. "1100"
    isContra: boolean("is_contra").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),

    displayOrder: integer("display_order").notNull().default(0),
    notes: text("notes"),

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
    uniqueIndex("ux_coa_outlet_code")
      .on(t.outletId, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_coa_lookup").on(
      t.outletId,
      t.type,
      t.isActive,
      t.displayOrder,
    ),
  ],
);

// ---------- accounting_periods ----------

export const accountingPeriods = pgTable(
  "accounting_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),

    status: text("status", {
      enum: ["open", "closed", "locked"],
    })
      .notNull()
      .default("open"),

    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id),

    /** Nullable self-FK to journal_entries.id — set saat period close run.
     * Soft FK (text) untuk avoid circular dependency w/ journal_entries; resolved app-side. */
    closingEntryId: uuid("closing_entry_id"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_periods_outlet_year_month").on(
      t.outletId,
      t.periodYear,
      t.periodMonth,
    ),
    check("ck_period_month_range", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check("ck_period_year_range", sql`${t.periodYear} BETWEEN 2020 AND 2100`),
  ],
);

// ---------- journal_entries (header) ----------

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => accountingPeriods.id),

    /** Format JE-YYYYMM-NNNN. Atomic per (outlet, period) via advisory lock. */
    entryNumber: text("entry_number").notNull(),

    /** Date of economic event (YYYY-MM-DD). Must fall within period. */
    entryDate: date("entry_date").notNull(),
    description: text("description").notNull(),

    sourceType: text("source_type", {
      enum: [
        "manual",
        "opening_balance",
        "pos_sale",
        "pos_refund",
        "pos_void",
        "pos_compliment",
        /* Sesi AE-193 — jurnal penjualan HARIAN (pengganti pos_sale
         * per-transaksi sejak tanggal cutover `dailyJournalSince`).
         * sourceId = pos_daily_journals.id, satu per (outlet, tanggal WIB).
         * Baris lama pos_sale sengaja TIDAK diubah — riwayat tetap utuh.
         * pos_daily_sales_void = pembalik saat batch dihitung ulang karena
         * ada void/koreksi menyusul; sourceId sama dengan batch-nya. */
        "pos_daily_sales",
        "pos_daily_compliment",
        "pos_daily_sales_void",
        "purchase_create",
        /* Sesi AE-188 — PO diedit setelah barang diterima (alur harga Rp 0
         * dulu supaya PIC Operasional bisa GR, harga diisi saat nota datang).
         * Jurnal GR lama dibalik dengan sourceType ini lalu diposting ulang
         * memakai nilai baru. sourceId = goods_receipts.id (sama dengan
         * sourceId jurnal aslinya sejak AE-177h). */
        "purchase_create_void",
        "purchase_pay",
        "purchase_cancel",
        /* Audit AE-181 — cancel purchase yang SUDAH dibayar wajib membalik
         * jurnal pembayarannya juga (Dr bank / Cr 2101). Sebelumnya hanya
         * jurnal create yang dibalik → 2101 + bank drift per cancel-paid. */
        "purchase_pay_reversal",
        "payroll_paid",
        /* Sesi AE-210 — pembalik payroll_paid saat owner mengoreksi
         * rekening/metode pembayaran gaji (mis. tercatat BCA padahal
         * ditransfer dari BRI). sourceId = payroll_periods.id, sama
         * dengan jurnal aslinya. */
        "payroll_paid_reversal",
        "expense_create",
        "expense_void",
        "income_create",
        "income_void",
        "cash_deposit_verified",
        "cash_deposit_unverified",
        "aggregator_settlement",
        "shift_variance",
        "shift_variance_reversal",
        "opname_adjustment",
        "period_close",
        "period_reopen",
        /* Sesi AE-62r — per-transaction correction approved.
         * pos_sale_reversal: Dr↔Cr swap dari original pos_sale (no COGS lines).
         * pos_sale_correction: re-post dengan corrected paymentMethod/total (no COGS lines).
         * sourceId = transaction_corrections.id (BUKAN transactions.id supaya
         * tidak collide dengan original pos_sale source key — lihat Trap T8). */
        "pos_sale_reversal",
        "pos_sale_correction",
        /* Sesi AE-63 — Investor / Pengelola modal flows.
         * capital_injection: Dr 1101/Cash Cr 3101 Modal Owner (saat
         *   investor/pengelola setor modal awal atau top-up).
         * capital_withdrawal: Dr 3201 Prive Cr 1101 (saat investor exit
         *   dan tarik modal — beda dari dividen).
         * dividend_distribution: Dr 3201 Prive Cr 1101 bulk per period
         *   (saat profit_distribution status='posted'). 1 header entry
         *   dengan N lines per holder. */
        "capital_injection",
        "capital_withdrawal",
        "dividend_distribution",
        /* Sesi AE-80 — Modal & Dividen v2 (ledger / mutasi dinamis).
         *
         * dividend_distribution_reversal: jurnal pembalik dari
         *   dividend_distribution yang di-reverse. sourceId = distribution.id
         *   (sama dengan original — partial unique allow karena status berbeda).
         *
         * dividend_withdrawal: pencairan saldo dividen investor (Dr 3202
         *   Hutang Dividen / Cr Bank). sourceId = withdrawal_request.id.
         * dividend_withdrawal_reversal: jurnal pembalik.
         *
         * creditor_repayment: cicilan hutang kreditur (Dr 2150 Hutang
         *   Kreditur + Dr 5301 Beban Bunga / Cr Kas). sourceId = creditor_repayment.id.
         * creditor_repayment_reversal: jurnal pembalik.
         *
         * share_buyback: outlet beli kembali share investor (Dr 3301
         *   Buyback Saham / Cr Kas). sourceId = share_transaction.id.
         * share_buyback_reversal: jurnal pembalik. */
        "dividend_distribution_reversal",
        "dividend_withdrawal",
        "dividend_withdrawal_reversal",
        "creditor_repayment",
        "creditor_repayment_reversal",
        /* Audit AE-181 — kreditur baru/import kini langsung Cr 2150 saat
         * dibuat (sebelumnya GL hanya dapat credit dari konversi investor →
         * Neraca understate). Dr = bank (uang masuk sekarang) atau 3301
         * (hutang lama / penyesuaian saldo). sourceId = creditor.id. */
        "creditor_create",
        "share_buyback",
        "share_buyback_reversal",
        /* Sesi AE-80 follow-up — convert investor → kreditur.
         *
         * Investor di-exit dan modalnya dipindah ke akun hutang kreditur
         * (re-classify equity ke liability). sourceId = creditor.id (kreditur
         * yang baru di-create). Journal: Dr 3101 Modal Owner / Cr 2150
         * Hutang Kreditur senilai principalOriginal. */
        "investor_to_creditor_conversion",
        /* Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola).
         *
         * internal_debt_expense: talangan biaya — owner bayar pengeluaran
         *   pakai uang pribadi (Dr <akun beban> / Cr 2170 Hutang Internal).
         *   sourceId = internal_debt_entries.id.
         * internal_debt_loan: pinjaman tunai masuk ke rekening bisnis
         *   (Dr <bank> / Cr 2170). sourceId = internal_debt_entries.id.
         * internal_debt_entry_reversal: jurnal pembalik entry (salah input).
         * internal_debt_repayment: cicilan hutang internal (Dr 2170 /
         *   Cr <bank>). sourceId = internal_debt_repayments.id.
         * internal_debt_repayment_reversal: jurnal pembalik cicilan. */
        "internal_debt_expense",
        "internal_debt_loan",
        "internal_debt_entry_reversal",
        "internal_debt_repayment",
        "internal_debt_repayment_reversal",
        /* Sesi AE-209b — Kasbon Karyawan jadi piutang (akun 1155).
         *
         * employee_advance_issue: kasbon diberikan (Dr 1155 / Cr kas atau
         *   bank). sourceId = employee_advances.id.
         * employee_advance_forgive: sisa kasbon dimaafkan owner
         *   (Dr 6102 Tunjangan & Bonus / Cr 1155). sourceId = advance.id.
         * employee_advance_repayment: karyawan nyicil (Dr kas/bank / Cr 1155).
         *   sourceId = employee_advance_repayments.id.
         * employee_advance_repayment_reversal: pembalik cicilan.
         * Pelunasan lewat potong gaji TIDAK punya sourceType sendiri — ikut
         * di dalam jurnal 'payroll_paid' sebagai baris Cr 1155. */
        "employee_advance_issue",
        "employee_advance_forgive",
        "employee_advance_repayment",
        "employee_advance_repayment_reversal",
        /* Sesi AE-116 — COGS period close adjustment.
         *
         * Reconcile recognized HPP (pos_sale running) vs actual COGS (WAC
         * period × consumed qty from opname). Adjustment lines:
         *   Dr 5101/5102/5103 HPP <section>  (variance, signed)
         *      Cr 1140/1141/1142 Persediaan <section>
         * sourceId = cogs_period_closes.id. One entry per (outlet, period). */
        "cogs_period_close",
        /* Sesi AE-211 — Jurnal Penyesuaian (adjusting entry).
         *
         * Entry BARU berisi SELISIH-nya saja; entry yang disesuaikan tetap
         * 'posted' dan tetap terhitung (beda dengan reverse yang menandai
         * keduanya 'reversed', dan beda dengan edit draft yang mengubah entry
         * yang sama di tempatnya).
         *
         * sourceId sengaja NULL — satu jurnal boleh disesuaikan lebih dari
         * sekali, sedangkan `ux_je_outlet_source_active` hanya mengizinkan
         * satu entry aktif per (sourceType, sourceId). Tautan ke jurnal yang
         * disesuaikan disimpan di `metadata.adjusting.adjustsEntryId`. */
        "adjusting",
        /* Sesi AE-214 — penilaian ulang aset tetap.
         *
         * 'asset_revaluation' = nilai wajar (naik → ekuitas 3501, turun →
         * gerus surplus dulu lalu rugi 6506). 'asset_impairment' menampung
         * penurunan nilai DAN pemulihannya (arahnya terbaca dari barisnya;
         * jenis persisnya ada di metadata.valuation.kind).
         *
         * sourceId = fixed_asset_valuations.id, BUKAN id asetnya — satu aset
         * boleh dinilai ulang berkali-kali sedangkan
         * `ux_je_outlet_source_active` cuma mengizinkan satu entry aktif per
         * (sourceType, sourceId). */
        "asset_revaluation",
        "asset_impairment",
      ],
    }).notNull(),

    /** Soft FK ke source table (polymorphic). Null untuk manual / opening_balance. */
    sourceId: uuid("source_id"),

    status: text("status", {
      enum: ["draft", "posted", "reversed"],
    })
      .notNull()
      .default("posted"),

    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by").references(() => users.id),

    /** Self-FK: kalau entry ini di-reverse, tunjuk ke counter-entry yang membatalkan. */
    reversedByEntryId: uuid("reversed_by_entry_id"),
    /** Self-FK: kalau entry ini ADALAH counter-entry, tunjuk ke entry asli yang dibatalkan. */
    reversesEntryId: uuid("reverses_entry_id"),
    reverseReason: text("reverse_reason"),

    /* Sesi AE-206 — bukti transaksi/transfer untuk jurnal manual (link
     * Google Drive, folder "BUKTI JURNAL/{YYYY}/{NN. BULAN}/"). Nullable:
     * jurnal otomatis (POS, pembelian, payroll) punya buktinya di modul
     * masing-masing dan tidak mengisi kolom ini. */
    receiptImageUrl: text("receipt_image_url"),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex("ux_je_outlet_number").on(t.outletId, t.entryNumber),
    index("idx_je_period").on(t.periodId),
    index("idx_je_source").on(t.sourceType, t.sourceId),
    index("idx_je_outlet_date").on(t.outletId, t.entryDate),
    /* Sesi AE-63 audit P1 — period close + balance queries filter by
     * status='posted'. Extend (outletId, entryDate, status) supaya index-only
     * scan untuk getAccountBalances + period close iteration. */
    index("idx_je_date_status").on(t.outletId, t.entryDate, t.status),
    /* Sesi AE-62t — defense-in-depth UNIQUE pada (outletId, sourceType, sourceId)
     * untuk ACTIVE entries (posted/draft, source_id non-null). Reversed entries
     * boleh duplikat karena legal pattern (post → reverse → re-post di sumber
     * yang sama, mis. pos_sale → pos_void → re-create dari koreksi).
     *
     * Sebelumnya: idempotency check di `recordJournal.findExistingEntry`
     * adalah SELECT-then-INSERT (TOCTOU race) — 2 concurrent hook fires bisa
     * silent duplicate post → GL overstatement permanent. UNIQUE constraint
     * guarantee 1 active entry per (outlet, source) pair di DB level.
     *
     * Source-less entries (manual / opening_balance) di-exclude — manual entries
     * harus boleh duplikat. */
    uniqueIndex("ux_je_outlet_source_active")
      .on(t.outletId, t.sourceType, t.sourceId)
      .where(
        sql`${t.sourceId} IS NOT NULL AND ${t.status} IN ('posted', 'draft')`,
      ),
  ],
);

// ---------- journal_lines (detail) ----------

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),

    /** 1-indexed within entry. */
    lineNumber: integer("line_number").notNull(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => chartOfAccounts.id),

    debit: bigint("debit", { mode: "number" }).notNull().default(0),
    credit: bigint("credit", { mode: "number" }).notNull().default(0),

    description: text("description"),
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_jl_entry_line").on(t.entryId, t.lineNumber),
    index("idx_jl_account").on(t.accountId),
    check(
      "ck_jl_amount_nonneg",
      sql`${t.debit} >= 0 AND ${t.credit} >= 0`,
    ),
    check(
      "ck_jl_xor",
      sql`(${t.debit} > 0 AND ${t.credit} = 0) OR (${t.debit} = 0 AND ${t.credit} > 0)`,
    ),
  ],
);
