import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { employees } from "./employees";
import { payrollPeriods } from "./hr";
import { bankAccounts } from "./bank-accounts";

/**
 * Sesi AE-60 — Kasbon (employee cash advance) audit trail.
 *
 * Owner kasih kasbon ke karyawan → buat row dengan status='pending'.
 * Saat compute payroll periode berikutnya, server auto-link advances
 * dengan status='pending' → mark 'deducted' + set deductedFromPeriodId,
 * dan payroll_lines.advance_deduction = SUM(amount per employee).
 *
 * Status workflow:
 *   - pending: kasbon baru di-issue, belum dikurangi gaji
 *   - deducted: sudah dikurangi dari payroll period tertentu
 *   - forgiven: owner forgive (kasbon dianggap lunas tanpa potong gaji)
 *   - repaid: lunas lewat cicilan (setor tunai/transfer), tanpa potong gaji
 *
 * Tidak ada DELETE — semua kasbon di-track historical untuk audit.
 *
 * Sesi AE-209b — KASBON MASUK PEMBUKUAN sebagai piutang. Kasbon yang
 * diberikan sekarang memposting Dr 1155 Piutang Kasbon Karyawan / Cr Kas
 * atau bank sesuai `funding_source`, dan `journal_entry_id` menyimpan
 * jurnalnya. Semua penyelesaian (cicilan, potong gaji, forgive) meng-kredit
 * 1155 sampai piutangnya nol. Detail + aturan anti saldo-minus ada di
 * `src/features/accounting/mapping/employeeAdvance.ts`.
 *
 * `funding_source='opening_balance'` = kasbon lama yang uangnya sudah keluar
 * sebelum kasbon masuk pembukuan → SENGAJA tanpa jurnal (journal_entry_id
 * NULL). Baris tanpa jurnal tidak boleh menghasilkan credit 1155 di jalur
 * mana pun; potongan gajinya tetap lewat 6105 seperti perilaku lama.
 *
 * Sesi AE-209 — CICILAN. Sebelumnya kasbon cuma bisa lunas sekaligus
 * (potong gaji penuh) atau di-forgive; karyawan yang mau nyicil harus
 * dipecah manual per periode (lihat pesan error "Bagi kasbon ke periode
 * berikut" di payroll/actions.ts). Sekarang tiap kasbon punya banyak
 * `employee_advance_repayments`, dan `repaid_amount` = running total
 * cicilan posted. Sisa yang dipotong gaji = amount − repaid_amount.
 */
export const employeeAdvances = pgTable(
  "employee_advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),

    /** Jumlah kasbon (Rp). Always > 0. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** Alasan kasbon: "Bayar SPP anak", "Renovasi rumah", dll. Optional. */
    reason: text("reason"),
    /** Tanggal owner kasih kasbon (WIB). */
    issuedDate: date("issued_date").notNull(),

    /** Sesi AE-209b — uang kasbon diambil dari mana:
     *  'cash'           → Dr 1155 / Cr 1101 Kas
     *  'bank'           → Dr 1155 / Cr <bank>, bank_account_id WAJIB
     *  'opening_balance'→ kasbon lama, uangnya keluar sebelum kasbon masuk
     *                     pembukuan → TANPA jurnal (lihat catatan di atas). */
    fundingSource: text("funding_source", {
      enum: ["cash", "bank", "opening_balance"],
    })
      .notNull()
      .default("cash"),
    /** Rekening bisnis sumber uang (WAJIB untuk funding_source='bank'). */
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    /** Jurnal pembukaan piutang (Dr 1155). NULL = kasbon di luar pembukuan
     * (baris pra-AE-209 atau funding_source='opening_balance'). */
    journalEntryId: uuid("journal_entry_id"),

    /** Status workflow. Default 'pending' saat insert. */
    status: text("status", {
      enum: ["pending", "deducted", "forgiven", "repaid"],
    })
      .notNull()
      .default("pending"),

    /** Sesi AE-209 — total cicilan posted (Rp). Denormalized running total
     * dari employee_advance_repayments, di-maintain service layer dalam
     * transaction + CHECK 0 <= repaid_amount <= amount. Sisa hutang yang
     * jadi potongan gaji = amount − repaid_amount. */
    repaidAmount: bigint("repaid_amount", { mode: "number" })
      .notNull()
      .default(0),

    /** Set saat status='deducted' — period mana yang nge-pull kasbon ini. */
    deductedFromPeriodId: uuid("deducted_from_period_id").references(
      () => payrollPeriods.id,
    ),
    /** Timestamp kapan status berubah ke 'deducted' atau 'forgiven'. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_employee_advances_employee").on(t.employeeId),
    index("idx_employee_advances_period").on(t.deductedFromPeriodId),
    index("idx_employee_advances_outlet_status").on(t.outletId, t.status),
    check("ck_employee_advances_amount_pos", sql`${t.amount} > 0`),
    check(
      "ck_employee_advances_resolve_consistency",
      sql`(${t.status} = 'pending' AND ${t.resolvedAt} IS NULL)
        OR (${t.status} != 'pending' AND ${t.resolvedAt} IS NOT NULL)`,
    ),
    /* Sesi AE-209 — cicilan tidak boleh lebih besar dari kasbonnya, dan
     * tidak boleh negatif (reversal cicilan mengurangi kolom ini). */
    check(
      "ck_employee_advances_repaid_range",
      sql`${t.repaidAmount} >= 0 AND ${t.repaidAmount} <= ${t.amount}`,
    ),
    /* Sesi AE-209b — bentuk data sumber dana dijaga di DB: hanya
     * funding_source='bank' yang punya rekening. */
    check(
      "ck_employee_advances_funding_shape",
      sql`(${t.fundingSource} = 'bank' AND ${t.bankAccountId} IS NOT NULL)
        OR (${t.fundingSource} <> 'bank' AND ${t.bankAccountId} IS NULL)`,
    ),
  ],
);

/**
 * Sesi AE-209 — Cicilan kasbon karyawan.
 *
 * Karyawan bayar balik kasbon di luar potong gaji: setor tunai ke kasir
 * atau transfer ke rekening bisnis (bisa dilampiri bukti transfer, sama
 * seperti cicilan kreditur/hutang internal).
 *
 * CATATAN AKUNTANSI (sengaja, jangan "dirapikan" tanpa baca ini):
 * cicilan kasbon TIDAK memposting jurnal. Alasannya kasbon memang belum
 * masuk pembukuan — saat kasbon dikeluarkan tidak ada jurnal kas keluar
 * (dicek di produksi sesi AE-209: 1 kasbon Rp 200rb, tanpa Pengeluaran
 * pasangannya). Kalau cicilan dijurnal Dr Kas / Cr 6105 sementara kas
 * keluarnya tidak pernah dijurnal, kas GL jadi ketinggian sebesar cicilan
 * DAN beban gaji jadi kekecilan — dua-duanya salah. Tanpa jurnal, kas
 * keluar (tak tercatat) dan kas masuk (tak tercatat) saling menghapus, dan
 * beban gaji tetap penuh karena potongannya berkurang. `journal_entry_id`
 * disiapkan nullable supaya kalau nanti kasbon diangkat jadi Piutang
 * Karyawan (akun 1155), baris lama bisa di-backfill tanpa migrasi lagi.
 */
export const employeeAdvanceRepayments = pgTable(
  "employee_advance_repayments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    advanceId: uuid("advance_id")
      .notNull()
      .references(() => employeeAdvances.id),
    /** Denormalized dari advance — dipakai filter/riwayat per karyawan. */
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),

    /** Nominal cicilan (Rp). Selalu > 0. */
    amount: bigint("amount", { mode: "number" }).notNull(),

    /** 'cash' = setor tunai ke kasir; 'transfer' = masuk rekening bisnis
     * (bank_account_id wajib). 'payroll' TIDAK ada di sini — potong gaji
     * tetap lewat payroll compute, bukan baris cicilan. */
    method: text("method", { enum: ["cash", "transfer"] }).notNull(),
    /** Rekening bisnis penerima transfer (FK bank_accounts). NULL utk cash. */
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),

    /** Tanggal uang diterima (WIB). */
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    description: text("description"),
    /** Bukti transfer di Google Drive (folder BUKTI JURNAL). Disaring
     * `normalizeReceiptUrl` sebelum masuk DB. */
    receiptImageUrl: text("receipt_image_url"),

    /** Disiapkan untuk masa depan — lihat CATATAN AKUNTANSI di atas. */
    journalEntryId: uuid("journal_entry_id"),

    status: text("status", { enum: ["posted", "reversed"] })
      .notNull()
      .default("posted"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_emp_advance_repay_advance").on(t.advanceId, t.occurredAt),
    index("idx_emp_advance_repay_employee").on(t.employeeId, t.occurredAt),
    index("idx_emp_advance_repay_outlet_date").on(t.outletId, t.occurredAt),
    check("ck_emp_advance_repay_amount_pos", sql`${t.amount} > 0`),
    /* Bentuk data dijaga di DB (pola ck_creditor_repay_funding_shape):
     * tunai tidak punya rekening, transfer wajib punya. */
    check(
      "ck_emp_advance_repay_method_shape",
      sql`(${t.method} = 'cash' AND ${t.bankAccountId} IS NULL)
        OR (${t.method} = 'transfer' AND ${t.bankAccountId} IS NOT NULL)`,
    ),
  ],
);
