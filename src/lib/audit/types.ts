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
  // Inventory — Section bulk assign (Sesi O)
  "inventory.section.bulk_assign",
  // Suppliers (Sesi O)
  "supplier.create",
  "supplier.update",
  "supplier.delete",
  // Purchases (Sesi O)
  "purchase.create",
  "purchase.update",
  "purchase.cancel",
  "purchase.mark_paid",
  "purchase.unmark_paid",
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
  // HR (Sesi C-8) — Schedule + Payroll.
  "schedule.upsert",
  "schedule.copy_week",
  "payroll.period.create",
  "payroll.period.delete",
  "payroll.compute",
  "payroll.finalize",
  "payroll.paid",
  "payroll.expense.create",
  // Sesi Q — Finance (Keuangan): cash deposit + aggregator settlement.
  "cash_deposit.create",
  "cash_deposit.update",
  "cash_deposit.verify",
  "cash_deposit.reject",
  "aggregator_settlement.create",
  "aggregator_settlement.update",
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
  | "promo"
  | "employee_career_history"
  | "stock_opname_session"
  | "supplier"
  | "purchase"
  | "cash_deposit"
  | "aggregator_settlement";

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
