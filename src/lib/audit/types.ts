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
  "user.reset_pin",
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
  // Purchase Requests (Phase 6.5+6.6, sesi AC-3)
  "purchase_request.create",
  "purchase_request.receive",
  "purchase_request.cancel",
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
  "attendance.drive_upload_failed",
  // HR (Sesi C-8) — Schedule + Payroll.
  "schedule.upsert",
  "schedule.copy_week",
  "payroll.period.create",
  "payroll.period.delete",
  "payroll.compute",
  "payroll.finalize",
  "payroll.paid",
  "payroll.expense.create",
  /* Sesi AE-60 — Apply THR ke semua line di period. */
  "payroll.thr_applied",
  /* Sesi AE-60 — Kasbon (employee advance) lifecycle. */
  "advance.create",
  "advance.forgive",
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
  /* Sesi AE-46 — fire-and-forget journal hook gagal post-commit.
   * Source action sudah committed (sale/refund/expense/purchase/payroll/
   * etc) tapi journal posting throw. Owner liat di Back Office buat
   * manual retry/reconcile. Detail full di payload (sourceType + sourceId
   * + error message). */
  "journal.posting_failed",
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
  | "employee_advance"
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
  | "shift_rebalance"
  | "chart_of_accounts"
  | "accounting_period"
  | "journal_entry"
  | "fixed_asset"
  | "bank_account"
  | "historical_daily_summary"
  | "historical_expense";

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
