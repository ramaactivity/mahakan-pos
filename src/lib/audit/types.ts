/**
 * Catalog of audit event types. New events MUST be added here so the viewer
 * filter UI stays in sync with what's actually written.
 */
export const AUDIT_EVENT_TYPES = [
  // Auth
  "auth.login.success",
  "auth.login.failed",
  "auth.logout",
  // Transactions
  "transaction.void",
  "transaction.refund",
  "transaction.refund.partial",
  "transaction.discount.applied",
  "transaction.compliment.applied",
  "transaction.open_bill.create",
  "transaction.open_bill.close",
  "transaction.open_bill.edit",
  "transaction.open_bill.cancel",
  /* Sesi AE-62o — shift rebalancing workflow events. */
  "shift.rebalance.request",
  "shift.rebalance.approve",
  "shift.rebalance.reject",
  "shift.rebalance.cancel",
  /* Sesi AE-62r — per-transaction correction workflow events (paymentMethod/
   * total swap dari Riwayat POS dengan email approval owner). */
  "transaction.correction.request",
  "transaction.correction.approve",
  "transaction.correction.reject",
  "transaction.correction.cancel",
  /* Sesi AE-67 — Entry change (pengeluaran/pemasukan edit/delete) dengan
   * suggest staff → approve owner via 6-digit code. */
  "entry_change.propose",
  "entry_change.approve",
  "entry_change.reject",
  "entry_change.cancel",
  "transaction.reprint",
  "transaction.split_payment.add",
  // Menu
  "menu.item.create",
  "menu.item.update",
  "menu.item.delete",
  "menu.item.sold_out_toggle",
  "menu.category.create",
  "menu.category.update",
  "menu.category.delete",
  "menu.category.reorder",
  "menu.modifier.update",
  "menu.modifier.create",
  "menu.modifier.delete",
  // Users
  "user.create",
  "user.update",
  "user.deactivate",
  "user.reactivate",
  "user.role_change",
  "user.reset_pin",
  // Operasional Checklist (sesi AE-131)
  "operasional.task.template.create",
  "operasional.task.template.update",
  "operasional.task.template.archive",
  "operasional.task.template.restore_default",
  "operasional.task.check",
  "operasional.task.check_late",
  "operasional.task.uncheck",
  "operasional.task.wa_export",
  // Arsip Nota (sesi AE-132)
  "nota_archive.create",
  "nota_archive.update",
  "nota_archive.review",
  "nota_archive.flag",
  "nota_archive.delete",
  "nota_archive.file.add",
  "nota_archive.file.delete",
  // Cash
  "expense.create",
  "expense.update",
  "expense.delete",
  "expense_category.create",
  "expense_category.update",
  "expense_category.delete",
  "income.create",
  "income.update",
  "income.delete",
  // Settings
  "settings.update",
  // Inventory
  "inventory.ingredient.create",
  "inventory.ingredient.update",
  "inventory.ingredient.delete",
  "inventory.recipe.create",
  "inventory.recipe.update",
  "inventory.recipe.delete",
  "inventory.receive",
  "inventory.adjust",
  "inventory.waste",
  // Inventory — Phase 2 Tier 1.2 (M23)
  "inventory.preparation.create",
  "inventory.preparation.update",
  "inventory.preparation.delete",
  "inventory.preparation.recompute",
  "inventory.cost.cascade",
  "inventory.import.run",
  // Sesi AE-112 — bulk CSV update di UI (download → edit Sheets → upload)
  "inventory.ingredient.bulk_update",
  "inventory.recipe.bulk_import",
  // Inventory — Stock Opname (Sesi N)
  "inventory.opname.start",
  "inventory.opname.submit",
  "inventory.opname.finalize",
  "inventory.opname.cancel",
  /** Sesi AE-22 — staff add bahan baru on-the-fly saat opname. */
  "inventory.opname.add_item",
  // Inventory — Section bulk assign (Sesi O)
  "inventory.section.bulk_assign",
  // Suppliers (Sesi O)
  "supplier.create",
  "supplier.update",
  "supplier.delete",
  // Purchases (Sesi O)
  "purchase.create",
  /* Sesi AE-57 — purchase yang ditarik dari Permintaan Belanja (PR).
   * Trigger: items[].purchaseRequestItemId terisi minimal 1. Payload
   * include fromPurchaseRequestId + prLinkedItemCount. */
  "purchase.create_from_pr",
  "purchase.update",
  "purchase.cancel",
  "purchase.mark_paid",
  "purchase.unmark_paid",
  // Sesi AE-173 — alur PR→PO→GR.
  "purchase.order_create",
  /* Sesi AE-188 — edit PO (harga menyusul nota) + sinkron turunannya. */
  "purchase.order_update",
  "purchase.goods_receive",
  /* Sesi AE-188 — hapus GR (owner-only), membalik stok/kas/PR/jurnal. */
  "purchase.goods_receipt_delete",
  /* Sesi AE-188 — koreksi tanggal pembayaran hutang yang terlanjur salah
   * (geser paid_at + tanggal expense + tanggal jurnal purchase_pay). */
  "purchase.payment_date_update",
  /* Sesi AE-199 — koreksi metode pembayaran hutang (jurnal diposting ulang). */
  "purchase.payment_method_update",
  // Purchase Requests (Phase 6.5+6.6, sesi AC-3)
  "purchase_request.create",
  "purchase_request.receive",
  "purchase_request.cancel",
  "purchase_request.complete",
  "purchase_request.whatsapp_sent",
  // Settlement Logs (Phase 6.1, sesi AC-5)
  "settlement_log.create",
  "settlement_log.update",
  "settlement_log.delete",
  // Customers / Loyalty — Phase 2 Tier 1.3 (M29)
  "customer.create",
  "customer.update",
  "transaction.points.earned",
  "transaction.points.redeemed",
  // HR (Sesi C-6) — Employee master.
  "employee.create",
  "employee.update",
  "employee.delete",
  // HR (Sesi C-7) — Attendance.
  "attendance.clock_in",
  "attendance.clock_out",
  // HR Phase 4 (sesi AB) — Mobile absensi PIN + outlet GPS config.
  "employee.attendance_pin.set",
  "employee.attendance_pin.reset",
  "outlet.attendance_gps.update",
  "attendance.mobile_clock_in",
  "attendance.mobile_clock_out",
  "attendance.mobile_rejected",
  /* Sesi AE-200 — absen TETAP DITERIMA tapi ada yang perlu dilihat owner
   * (mis. tag GPS di foto ngaco). Dulu kejadian ini ikut dicatat sebagai
   * "mobile_rejected" — 58 baris palsu dalam 45 hari — sehingga daftar
   * penolakan tidak bisa dipercaya. Jangan gabungkan lagi. */
  "attendance.mobile_flagged",
  "attendance.drive_upload_failed",
  /* Sesi AE-63 phase8 — HR manual edit attendance status / lateMinutes /
   * overtimeMinutes (special case: konfirmasi izin, sakit, dll). */
  "attendance.manual_edit",
  /* Sesi AE-162 — HR input/backfill absen manual untuk hari tanpa clock-in
   * (mock data historis + koreksi lupa absen) + hapus entri manual. */
  "attendance.manual_create",
  "attendance.manual_delete",
  "attendance.manual_backfill",
  /* Sesi AE-165 — auto-settlement QRIS/EDC dari POS + config MDR. */
  "aggregator_settlement.auto_generate",
  "outlet.cashless_mdr.update",
  /* Sesi AE-167 — kas awal standar + koreksi kas awal shift. */
  "outlet.standard_opening_cash.update",
  "shift.opening_cash.correct",
  /* Audit POS E2E 2026-06-12 — jejak buka shift eksplisit + tutup paksa
   * shift nginep oleh owner dari backoffice. */
  "shift.open",
  "shift.force_close",
  /* Sesi AE-62ag — mobile PIN endpoint audit. PIN-only auth tanpa session,
   * jadi userId NULL — context cukup pakai entityId / payload.summary. */
  "attendance_mobile.pin_invalid",
  "attendance_mobile.pin_inactive_employee",
  /* Sesi AE-63 — Investor + Pengelola + Profit Distribution lifecycle */
  "investor.create",
  "investor.update",
  "investor.delete",
  "investor.import",
  /* Sesi AE-160f — wipe seluruh modul investor/pengelola/kreditur (owner-only). */
  "investor_module.wipe",
  "pengelola.create",
  "pengelola.update",
  "pengelola.delete",
  /* Sesi AE-80 follow-up — bulk import CSV. */
  "pengelola.import",
  "creditor.import",
  "capital_movement.create",
  "capital_movement.delete",
  "distribution.compute",
  "distribution.approve",
  "distribution.post",
  "distribution.cancel",
  "distribution.recompute",
  /* Sesi AE-80 — reversal distribusi V2 + flows baru. */
  "distribution.reverse",
  "withdrawal.post",
  "withdrawal.reverse",
  /* Sesi AE-160h — bulk import pencairan historis (no journal, no balance
   * decrement). Owner-only flow setelah wipe + master re-import. */
  "withdrawal.bulk_import_historical",
  "creditor.create",
  "creditor.update",
  "creditor.delete",
  /* Sesi AE-80 follow-up — convert investor → kreditur. */
  "creditor.convert_from_investor",
  "investor.convert_to_creditor",
  "creditor_repayment.post",
  "creditor_repayment.reverse",
  /* Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola). */
  "internal_debt_party.create",
  "internal_debt_party.update",
  "internal_debt_party.delete",
  "internal_debt_entry.post",
  "internal_debt_entry.reverse",
  "internal_debt_repayment.post",
  "internal_debt_repayment.reverse",
  "share_transaction.p2p_transfer",
  "share_transaction.company_buyback",
  "share_transaction.reverse",
  "investor_statement.send",
  "investor_statement.resend",
  "investor_statement.failed",
  // HR (Sesi C-8) — Schedule + Payroll.
  "schedule.upsert",
  "schedule.copy_week",
  "payroll.period.create",
  "payroll.period.delete",
  "payroll.compute",
  "payroll.finalize",
  "payroll.paid",
  /* Sesi AE-210 — koreksi rekening/metode pembayaran gaji (jurnal dibalik
   * lalu diposting ulang ke akun bank yang benar). */
  "payroll.payment_method_update",
  "payroll.expense.create",
  /* Sesi AE-60 — Apply THR ke semua line di period. */
  "payroll.thr_applied",
  /* Sesi AE-62ad — Slip gaji email dikirim (auto saat markPaid atau manual resend). */
  "payroll.payslip.send",
  "payroll.payslip.resend",
  "payroll.payslip.failed",
  /* Sesi AE-60 — Kasbon (employee advance) lifecycle. */
  "advance.create",
  "advance.forgive",
  /* Sesi AE-209 — cicilan kasbon (setor tunai/transfer di luar potong gaji). */
  "advance.repayment.post",
  "advance.repayment.reverse",
  // Sesi Q — Finance (Keuangan): cash deposit + aggregator settlement.
  "cash_deposit.create",
  "cash_deposit.update",
  "cash_deposit.verify",
  "cash_deposit.reject",
  "cash_deposit.unverify",
  "aggregator_settlement.create",
  "aggregator_settlement.update",
  /* Sesi AE-56 — workflow status set untuk Rekonsiliasi audit (open →
   * investigating → resolved/disputed) + free-form note. */
  "reconciliation.update",
  // Promos / Campaigns (Sesi K).
  "promo.create",
  "promo.update",
  "promo.delete",
  "promo.apply",
  // Career history (Sesi M) — manual backfill + delete.
  "career_history.create",
  "career_history.delete",
  // Employee CSV export (Sesi M).
  "employee.export_csv",
  // Sesi B-2 — Owner-only approval code (void/refund).
  "approval_code.generate",
  "approval_code.consume",
  "approval_code.failed_attempt",
  "approval_code.revoked",
  "approval_code.email_failed",
  // Accounting (Sesi S+) — Chart of Accounts + Periods + Journal entries.
  "chart_of_accounts.create",
  "chart_of_accounts.update",
  "chart_of_accounts.deactivate",
  "accounting_period.open",
  "accounting_period.close",
  "accounting_period.lock",
  "accounting_period.reopen",
  "journal_entry.draft",
  "journal_entry.post",
  "journal_entry.update_draft",
  "journal_entry.reverse",
  /* Sesi AE-211 — jurnal penyesuaian: entry BARU berisi selisih, entry
   * aslinya tetap berlaku (beda dari reverse yang meniadakan keduanya, dan
   * beda dari update_draft yang mengubah entry yang sama). Payload menyimpan
   * alasan + nomor jurnal yang disesuaikan. */
  "journal_entry.adjust",
  "journal_entry.adjust_draft",
  /* Sesi AE-185 — ubah tanggal jurnal yang sudah posted tanpa reverse.
   * Payload menyimpan tanggal & nomor lama supaya jejaknya utuh. */
  "journal_entry.date_changed",
  /* Sesi AE-63 phase4 — staff finance request: edit/hapus draft manual.
   * Posted entries tetap hanya reverse (audit trail). */
  "journal_entry.delete",
  /* Sesi AE-46 — fire-and-forget journal hook gagal post-commit.
   * Source action sudah committed (sale/refund/expense/purchase/payroll/
   * etc) tapi journal posting throw. Owner liat di Back Office buat
   * manual retry/reconcile. Detail full di payload (sourceType + sourceId
   * + error message). */
  "journal.posting_failed",
  /* Sesi AE-62w — retry queue lifecycle untuk failed journal hook. */
  "journal.retry.enqueued",
  "journal.retry.succeeded",
  "journal.retry.failed",
  "journal.retry.abandoned",
  /* Sesi AE-182 — sapuan otomatis (cron/manual) yang mencari transaksi &
   * pengeluaran tanpa jurnal lalu memposting ulang. Ringkasan hasil sapuan
   * masuk sini supaya owner punya jejak apa yang dipulihkan kapan. */
  "journal.sweep.completed",
  "opening_balance.posted",
  "report.income_statement.export",
  "report.balance_sheet.export",
  // Fixed Assets (Sesi X) — capitalization + monthly depreciation.
  "fixed_asset.create",
  "fixed_asset.deactivate",
  "fixed_asset.depreciation",
  // Bank Accounts master (Sesi AE-13) — owner CRUD untuk dropdown setoran.
  "bank_account.create",
  "bank_account.update",
  "bank_account.delete",
  // Sesi AE-32 — nuclear reset operational data (mockup → trial).
  "system.reset_mockup_data",
  /* Sesi AE-62 — Historical reconciliation (CSV import dari Majoo/Kasir Pintar).
   * Aggregated daily summary 3-6 bulan untuk laporan akuntansi + investor. */
  "historical.import_summary",
  "historical.import_expense",
  "historical.update",
  "historical.delete",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/**
 * Sesi AE-62u — event prefixes yang HIDDEN dari non-owner viewer (manager +
 * supervisor) di audit log viewer.
 *
 * Manager+supervisor punya permission `audit.view.staff_actions` (lihat
 * aksi staff untuk supervision), tapi tidak `audit.view.all` (kayak
 * settings change, user CRUD, payroll details). Filter ini implementasi
 * batas dua tier tersebut.
 *
 * Apa yang TETAP visible ke manager+supervisor:
 *   - transaction.*, attendance.*, customer.*, inventory.*, purchase*.*,
 *     shift.*, promo.*, supplier.*, expense.*, income.*, cash_deposit.*,
 *     aggregator_settlement.*, approval_code.*, employee.* (kecuali yg
 *     sensitive), bank_account.*, reconciliation.*, settlement_log.*,
 *     menu.*, auth.*, journal.posting_failed
 */
export const STAFF_RESTRICTED_EVENT_PREFIXES = [
  "settings.",
  "user.",
  "system.",
  "historical.",
  "accounting_period.",
  "accounting.",
  "chart_of_accounts.",
  "journal_entry.",
  "payroll.",
  "advance.",
  "opening_balance.",
  "report.income_statement.",
  "report.balance_sheet.",
  "fixed_asset.",
] as const;

export function isStaffVisibleEvent(eventType: string): boolean {
  return !STAFF_RESTRICTED_EVENT_PREFIXES.some((prefix) =>
    eventType.startsWith(prefix),
  );
}

export type AuditEntityType =
  | "transaction"
  | "menu_item"
  | "category"
  | "modifier"
  | "user"
  | "expense"
  | "expense_category"
  | "income"
  | "outlet"
  | "session"
  | "ingredient"
  | "recipe"
  | "inventory_movement"
  | "preparation"
  | "import_run"
  | "customer"
  | "approval_code"
  | "employee"
  | "attendance"
  | "schedule"
  | "payroll_period"
  | "payroll_line"
  | "payroll_payslip_email"
  | "employee_advance"
  /* Sesi AE-209 — baris cicilan kasbon. */
  | "employee_advance_repayment"
  /* Sesi AE-63 — Modal & Dividen */
  | "investor"
  | "pengelola"
  | "capital_movement"
  | "profit_distribution"
  | "profit_distribution_line"
  | "investor_statement_email"
  /* Sesi AE-80 — Modal & Dividen v2 (Ledger / Mutasi Dinamis). */
  | "withdrawal_request"
  | "creditor"
  | "creditor_repayment"
  /* Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola). */
  | "internal_debt_party"
  | "internal_debt_entry"
  | "internal_debt_repayment"
  | "share_transaction"
  | "promo"
  | "employee_career_history"
  | "stock_opname_session"
  | "stock_opname_line"
  | "supplier"
  | "purchase"
  | "purchase_request"
  | "purchase_request_item"
  | "settlement_log"
  | "cash_deposit"
  | "aggregator_settlement"
  | "reconciliation_note"
  | "shift"
  | "shift_rebalance"
  | "transaction_correction"
  | "pending_entry_change"
  | "chart_of_accounts"
  | "accounting_period"
  | "journal_entry"
  | "journal_retry_queue"
  | "fixed_asset"
  | "bank_account"
  | "historical_daily_summary"
  | "historical_expense"
  /* Sesi AE-131 — Operasional checklist. */
  | "operasional_task_template"
  | "operasional_task_completion"
  | "operasional_task_wa_export"
  /* Sesi AE-132 — Arsip Nota. */
  | "nota_archive"
  | "nota_archive_file";

export type AuditPayload = {
  /** human summary line — will be shown in viewer table */
  summary?: string;
  /** before-state of entity (for updates) */
  before?: unknown;
  /** after-state of entity (for updates), or new state for creates */
  after?: unknown;
  /** changed-fields snapshot (computed from before/after diff) */
  diff?: Record<string, { before: unknown; after: unknown }>;
  /** any extra context relevant to the event */
  context?: Record<string, unknown>;
};

export type AuditMetadata = {
  ip?: string;
  userAgent?: string;
  /** Outlet scope, copied from session for fast filtering */
  outletId?: string;
  /** Role of acting user at time of event */
  actorRole?: string;
};
