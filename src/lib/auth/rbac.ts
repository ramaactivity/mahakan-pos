export type Role = "owner" | "manager" | "supervisor" | "staff";

/**
 * Permission matrix — single source of truth.
 *
 * Mirror of `docs/05-ROLES-RBAC.md §4`. Server-side enforced via
 * `hasPermission()` and `requirePermission()`. Mutations to this object
 * MUST be reflected in the docs.
 *
 * Phase 8.1 Option B (sesi AC-4): "supervisor" role added between manager
 * and staff. Default scope = "Manager-lite shift lead": semua manager
 * permissions kecuali yang irreversible (delete/cancel/finalize),
 * financial commitment (mark_paid, cash_deposit.verify), atau admin master
 * (menu/inventory/supplier CRUD, settings, payroll, accounting). Owner
 * dapat tweak per-permission kalau scope tidak pas saat field test.
 */
export const permissions = {
  // Auth
  "auth.password_login": ["owner", "manager", "supervisor"],
  "auth.pin_login": ["owner", "manager", "supervisor", "staff"],

  // POS — Transactions
  "pos.transaction.create": ["owner", "manager", "supervisor", "staff"],
  "pos.transaction.view": ["owner", "manager", "supervisor", "staff"],
  "pos.transaction.void": ["owner", "manager", "supervisor"],
  "pos.transaction.refund": ["owner", "manager", "supervisor"],
  /** Apply a pre-configured promo at checkout. Staff allowed to PICK
   * promos (Owner standard sesi K — no manual %/nominal entry). Promos
   * with requires_approval=true also need separate Owner/Manager PIN. */
  "pos.promo.apply": ["owner", "manager", "supervisor", "staff"],
  /** Legacy manual discount apply — kept for back-compat audit. NOT used
   * in new POS flow (Owner standard: only pre-configured promos). */
  "pos.discount.apply": ["owner", "manager", "supervisor"],
  "pos.receipt.print": ["owner", "manager", "supervisor", "staff"],
  "pos.receipt.reprint": ["owner", "manager", "supervisor", "staff"],

  // POS — Menu
  "pos.menu.mark_sold_out": ["owner", "manager", "supervisor", "staff"],
  "pos.menu.mark_available": ["owner", "manager", "supervisor"],

  // Shift
  "shift.open_own": ["owner", "manager", "supervisor", "staff"],
  "shift.close_own": ["owner", "manager", "supervisor", "staff"],
  "shift.view_own": ["owner", "manager", "supervisor", "staff"],
  "shift.view_all": ["owner", "manager", "supervisor"],
  "shift.force_close": ["owner"],

  // Menu CRUD — supervisor TIDAK bisa edit master menu (master data scope).
  "menu.item.create": ["owner", "manager"],
  "menu.item.update": ["owner", "manager"],
  "menu.item.delete": ["owner", "manager"],
  "menu.item.bulk_update": ["owner", "manager"],
  "menu.export_csv": ["owner"],
  "menu.category.crud": ["owner", "manager"],
  "menu.modifier.update": ["owner", "manager"],
  "menu.modifier.create": ["owner", "manager"],
  "menu.modifier.delete": ["owner"],

  // Cash & Expenses
  "expense.create": ["owner", "manager", "supervisor", "staff"],
  "expense.update_within_24h": ["owner", "manager", "supervisor"],
  "expense.update_anytime": ["owner"],
  "expense.delete": ["owner"],
  "expense.category.create": ["owner", "manager"],
  "expense.category.update": ["owner"],
  "expense.category.delete": ["owner"],
  "income.create": ["owner", "manager", "supervisor", "staff"],
  "income.update_within_24h": ["owner", "manager", "supervisor"],
  "income.update_anytime": ["owner"],
  "income.delete": ["owner"],
  "cash.daily_summary.view": ["owner", "manager", "supervisor", "staff"],

  // Reports — supervisor lihat operational, NOT P&L / cost / financial export.
  "report.sales.view": ["owner", "manager", "supervisor"],
  "report.items.view": ["owner", "manager", "supervisor"],
  "report.shift.view_all": ["owner", "manager", "supervisor"],
  "report.pnl.view": ["owner"],
  "report.cost_visibility": ["owner"],
  "report.export.operational": ["owner", "manager", "supervisor"],
  "report.export.financial": ["owner"],

  // User Management — supervisor TIDAK bisa CRUD user; HANYA reset PIN
  // staff (helpful saat kasir lupa PIN mid-shift).
  "user.list.all": ["owner"],
  "user.list.staff": ["owner", "manager", "supervisor"],
  "user.create.staff": ["owner", "manager"],
  "user.create.manager": ["owner"],
  "user.create.owner": ["owner"],
  "user.update.staff": ["owner", "manager"],
  "user.update.manager": ["owner"],
  "user.update.owner": ["owner"],
  "user.deactivate.staff": ["owner", "manager"],
  "user.deactivate.manager": ["owner"],
  "user.reset_pin.staff": ["owner", "manager", "supervisor"],
  "user.reset_password.manager": ["owner"],
  "audit.view.all": ["owner"],
  "audit.view.staff_actions": ["owner", "manager", "supervisor"],

  // HR — Employee management (Sesi C-6). Supervisor view-only.
  "employee.view": ["owner", "manager", "supervisor"],
  "employee.create": ["owner", "manager"],
  "employee.update": ["owner", "manager"],
  "employee.delete": ["owner"],

  // HR — Attendance (Sesi C-7). `record` = clock in/out (the kiosk
  // operator). `view` = list/admin reports. Staff can record their own
  // attendance via the kiosk; the device's logged-in user is the actor.
  "attendance.view": ["owner", "manager", "supervisor"],
  "attendance.record": ["owner", "manager", "supervisor", "staff"],
  /** Phase 4 (sesi AB) — set/reset attendance PIN per karyawan via
   * Admin → Karyawan. Owner+Manager. */
  "employee.attendance_pin.manage": ["owner", "manager"],
  /** Phase 4 — set GPS center coords for mobile absensi via Settings. */
  "outlet.attendance_gps.manage": ["owner", "manager"],

  // HR — Schedule + Payroll (Sesi C-8). Supervisor view schedule only;
  // payroll TIDAK terlihat (sensitive — gaji teman tim).
  "schedule.view": ["owner", "manager", "supervisor"],
  "schedule.update": ["owner", "manager"],
  "payroll.view": ["owner", "manager"],
  "payroll.manage": ["owner"],

  // Promos / Campaigns (Sesi K). View read-only at backoffice; manage =
  // create/update/archive. Apply lives under pos.promo.apply. Supervisor
  // view only — manage promo bisa abuse jadi diskon liar.
  "promo.view": ["owner", "manager", "supervisor"],
  "promo.manage": ["owner", "manager"],

  // Settings — Supervisor cuma device-level (printer pair/test).
  "settings.business.update": ["owner"],
  "settings.printer.pair": ["owner", "manager", "supervisor", "staff"],
  "settings.printer.test": ["owner", "manager", "supervisor", "staff"],
  "settings.hours.update": ["owner"],
  "settings.receipt.update": ["owner", "manager"],
  "settings.thresholds.update": ["owner"],
  "settings.features.update": ["owner"],
  "settings.approval.update": ["owner"],

  // Inventory — Supervisor view + receive + waste (operational), TIDAK
  // CRUD master ingredient/recipe (master data) atau adjust (sensitive).
  "inventory.ingredient.view": ["owner", "manager", "supervisor"],
  "inventory.ingredient.create": ["owner", "manager"],
  "inventory.ingredient.update": ["owner", "manager"],
  "inventory.ingredient.delete": ["owner"],
  "inventory.recipe.view": ["owner", "manager", "supervisor"],
  "inventory.recipe.create": ["owner", "manager"],
  "inventory.recipe.update": ["owner", "manager"],
  "inventory.recipe.delete": ["owner"],
  "inventory.receive": ["owner", "manager", "supervisor"],
  "inventory.adjust": ["owner"],
  "inventory.waste": ["owner", "manager", "supervisor"],
  "inventory.movement.view": ["owner", "manager", "supervisor"],
  "inventory.cost.view": ["owner"],

  // Phase 2 Tier 1.2 (M23) — Preparations.
  "inventory.preparation.view": ["owner", "manager", "supervisor"],
  "inventory.preparation.create": ["owner", "manager"],
  "inventory.preparation.update": ["owner", "manager"],
  "inventory.preparation.delete": ["owner"],

  // Stock Opname (Sesi N). Owner standard — opname wajib bulanan oleh
  // staff & karyawan. Staff CAN start/count/submit (so they can run
  // the count themselves); finalize + cancel manager+ only (commits
  // adjust movements; fraud-prevention boundary). Supervisor TIDAK
  // finalize (finalize = commit, sensitive boundary).
  "inventory.opname.view": ["owner", "manager", "supervisor", "staff"],
  "inventory.opname.start": ["owner", "manager", "supervisor", "staff"],
  "inventory.opname.count": ["owner", "manager", "supervisor", "staff"],
  "inventory.opname.finalize": ["owner", "manager"],
  "inventory.opname.cancel": ["owner", "manager"],

  // Suppliers master — Supervisor view-only (master data).
  "supplier.view": ["owner", "manager", "supervisor"],
  "supplier.create": ["owner", "manager"],
  "supplier.update": ["owner", "manager"],
  "supplier.delete": ["owner"],

  // Purchases (Sesi O). Replaces Form Cash + Form TOP spreadsheets.
  // Staff bisa input pembelian harian (mereka tim purchasing); finalize
  // payment & cancel manager+ only. Supervisor view + create (operational
  // belanja), TIDAK update / cancel / mark_paid (financial commitment).
  "purchase.view": ["owner", "manager", "supervisor"],
  "purchase.create": ["owner", "manager", "supervisor", "staff"],
  "purchase.update": ["owner", "manager"],
  "purchase.cancel": ["owner", "manager"],
  "purchase.mark_paid": ["owner", "manager"],

  // Purchase Requests (Phase 6.5+6.6, sesi AC-3) — list belanja dari kasir
  // saat tutup shift; admin receive di "Permintaan Belanja" section.
  // Supervisor receive (relevant to shift lead) tapi NOT cancel.
  "purchase_request.view": ["owner", "manager", "supervisor"],
  "purchase_request.create": ["owner", "manager", "supervisor", "staff"],
  "purchase_request.receive": ["owner", "manager", "supervisor"],
  "purchase_request.cancel": ["owner", "manager"],

  // Reports HPP + Purchase rollup (Sesi O). HPP = COGS by ingredient,
  // owner-only karena cost-sensitive. Purchase rollup OK for manager.
  "report.hpp.view": ["owner"],
  "report.purchase_rollup.view": ["owner", "manager", "supervisor"],

  // Bulk-assign section to ingredients (Sesi O). Manager+ untuk avoid
  // accidental staff misclassify.
  "inventory.section.bulk_assign": ["owner", "manager"],

  // Phase 2 Tier 1.3 (M29) — Customers / Loyalty.
  "customer.lookup": ["owner", "manager", "supervisor", "staff"],
  "customer.view": ["owner", "manager", "supervisor"],
  "customer.create": ["owner", "manager", "supervisor", "staff"],
  "customer.update": ["owner", "manager"],

  // Sesi B-2 — Owner-only approval code mechanism for void/refund.
  // *.request perms let any role INITIATE the request. Code-mode authz
  // tetap owner-only (Supervisor tidak otomatis qualify untuk be code
  // approver — owner can extend later kalau perlu).
  "pos.transaction.void.request": ["owner", "manager", "supervisor", "staff"],
  "pos.transaction.refund.request": ["owner", "manager", "supervisor", "staff"],
  /** Code-mode void authorization. Owner-only when flag is "code". */
  "pos.transaction.void.code": ["owner"],
  /** Code-mode refund authorization. Owner-only when flag is "code". */
  "pos.transaction.refund.code": ["owner"],
  /** View + revoke active approval codes (admin panel). */
  "approval_code.view": ["owner"],
  "approval_code.revoke": ["owner"],

  // Finance / Keuangan (Sesi Q). Verify is owner-only by design.
  // Supervisor view + create deposit/aggregator (operational data entry),
  // TIDAK verify deposit atau cash flow report (sensitive).
  "finance.dashboard.view": ["owner", "manager", "supervisor"],
  "report.daily_settlement.view": ["owner", "manager", "supervisor"],
  "cash_deposit.view": ["owner", "manager", "supervisor"],
  "cash_deposit.create": ["owner", "manager", "supervisor"],
  "cash_deposit.verify": ["owner"],
  "report.cash_flow.view": ["owner"],
  "aggregator_settlement.view": ["owner", "manager", "supervisor"],
  "aggregator_settlement.create": ["owner", "manager", "supervisor"],
  "settings.cash_threshold.update": ["owner"],

  // Settlement Log per channel per hari (Phase 6.1, sesi AC-5).
  // Owner input mutasi bank actual + variance log. Supervisor view-only
  // (compare expected vs actual saat shift), tidak input atau hapus
  // (financial entry — owner+manager only).
  "settlement_log.view": ["owner", "manager", "supervisor"],
  "settlement_log.create": ["owner", "manager"],
  "settlement_log.update": ["owner", "manager"],
  "settlement_log.delete": ["owner"],

  // Accounting / Buku Besar — Supervisor TIDAK terlibat akuntansi
  // (sensitif, post/close period commits financial state).
  "accounting.coa.view": ["owner", "manager"],
  "accounting.coa.manage": ["owner"],
  "accounting.journal.view": ["owner", "manager"],
  "accounting.journal.draft": ["owner", "manager"],
  "accounting.journal.post": ["owner"],
  "accounting.journal.reverse": ["owner"],
  "accounting.period.view": ["owner", "manager"],
  "accounting.period.close": ["owner"],
  "accounting.period.reopen": ["owner"],
  "accounting.period.lock": ["owner"],
  "accounting.report.view": ["owner", "manager"],
  "accounting.report.export": ["owner"],
  "accounting.opening_balance.input": ["owner"],
} as const satisfies Record<string, ReadonlyArray<Role>>;

export type Permission = keyof typeof permissions;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (permissions[permission] as ReadonlyArray<Role>).includes(role);
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(
      `Forbidden: role "${role}" cannot "${permission}"`,
    );
  }
}

/**
 * Role hierarchy for actions like "can create user with role X" — owner can
 * affect manager + supervisor + staff; manager can affect supervisor + staff;
 * supervisor cannot create/manage other users (just reset PIN, gated by
 * permission). Phase 8.1 Option B (sesi AC-4).
 */
export function canActOnRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return target === "supervisor" || target === "staff";
  return false;
}

/**
 * Session duration per role (C2 = A).
 * Staff + Supervisor: 12h shift-long (frontline); Owner/Manager: 2h tighter
 * for back office. Returned in seconds — used by middleware to enforce
 * stale-session redirect.
 */
export function sessionMaxAgeSeconds(role: Role): number {
  return role === "staff" || role === "supervisor"
    ? 12 * 60 * 60
    : 2 * 60 * 60;
}
