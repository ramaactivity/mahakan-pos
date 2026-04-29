export type Role = "owner" | "manager" | "staff";

/**
 * Permission matrix — single source of truth.
 *
 * Mirror of `docs/05-ROLES-RBAC.md §4`. Server-side enforced via
 * `hasPermission()` and `requirePermission()`. Mutations to this object
 * MUST be reflected in the docs.
 */
export const permissions = {
  // Auth
  "auth.password_login": ["owner", "manager"],
  "auth.pin_login": ["owner", "manager", "staff"],

  // POS — Transactions
  "pos.transaction.create": ["owner", "manager", "staff"],
  "pos.transaction.view": ["owner", "manager", "staff"],
  "pos.transaction.void": ["owner", "manager"],
  "pos.transaction.refund": ["owner", "manager"],
  "pos.discount.apply": ["owner", "manager"],
  "pos.receipt.print": ["owner", "manager", "staff"],
  "pos.receipt.reprint": ["owner", "manager", "staff"],

  // POS — Menu
  "pos.menu.mark_sold_out": ["owner", "manager", "staff"],
  "pos.menu.mark_available": ["owner", "manager"],

  // Shift
  "shift.open_own": ["owner", "manager", "staff"],
  "shift.close_own": ["owner", "manager", "staff"],
  "shift.view_own": ["owner", "manager", "staff"],
  "shift.view_all": ["owner", "manager"],
  "shift.force_close": ["owner"],

  // Menu CRUD
  "menu.item.create": ["owner", "manager"],
  "menu.item.update": ["owner", "manager"],
  "menu.item.delete": ["owner", "manager"],
  "menu.item.bulk_update": ["owner", "manager"],
  "menu.export_csv": ["owner"],
  "menu.category.crud": ["owner", "manager"],
  "menu.modifier.update": ["owner", "manager"],

  // Cash & Expenses
  "expense.create": ["owner", "manager"],
  "expense.update_within_24h": ["owner", "manager"],
  "expense.update_anytime": ["owner"],
  "expense.delete": ["owner"],
  "expense.category.create": ["owner", "manager"],
  "expense.category.update": ["owner"],
  "expense.category.delete": ["owner"],
  "income.create": ["owner", "manager"],
  "income.update_within_24h": ["owner", "manager"],
  "income.update_anytime": ["owner"],
  "income.delete": ["owner"],
  "cash.daily_summary.view": ["owner", "manager"],

  // Reports
  "report.sales.view": ["owner", "manager"],
  "report.items.view": ["owner", "manager"],
  "report.shift.view_all": ["owner", "manager"],
  "report.pnl.view": ["owner"],
  "report.cost_visibility": ["owner"],
  "report.export.operational": ["owner", "manager"],
  "report.export.financial": ["owner"],

  // User Management
  "user.list.all": ["owner"],
  "user.list.staff": ["owner", "manager"],
  "user.create.staff": ["owner", "manager"],
  "user.create.manager": ["owner"],
  "user.create.owner": ["owner"],
  "user.update.staff": ["owner", "manager"],
  "user.update.manager": ["owner"],
  "user.update.owner": ["owner"],
  "user.deactivate.staff": ["owner", "manager"],
  "user.deactivate.manager": ["owner"],
  "user.reset_pin.staff": ["owner", "manager"],
  "user.reset_password.manager": ["owner"],
  "audit.view.all": ["owner"],
  "audit.view.staff_actions": ["owner", "manager"],

  // Settings
  "settings.business.update": ["owner"],
  "settings.printer.pair": ["owner", "manager", "staff"],
  "settings.printer.test": ["owner", "manager", "staff"],
  "settings.hours.update": ["owner"],
  "settings.receipt.update": ["owner", "manager"],
  "settings.thresholds.update": ["owner"],
  "settings.features.update": ["owner"],

  // Inventory (Phase 2 Tier 1.1)
  "inventory.ingredient.view": ["owner", "manager"],
  "inventory.ingredient.create": ["owner", "manager"],
  "inventory.ingredient.update": ["owner", "manager"],
  "inventory.ingredient.delete": ["owner"],
  "inventory.recipe.view": ["owner", "manager"],
  "inventory.recipe.create": ["owner", "manager"],
  "inventory.recipe.update": ["owner", "manager"],
  "inventory.recipe.delete": ["owner"],
  "inventory.receive": ["owner", "manager"],
  "inventory.adjust": ["owner"],
  "inventory.waste": ["owner", "manager"],
  "inventory.movement.view": ["owner", "manager"],
  "inventory.cost.view": ["owner"],

  // Phase 2 Tier 1.2 (M23) — Preparations.
  "inventory.preparation.view": ["owner", "manager"],
  "inventory.preparation.create": ["owner", "manager"],
  "inventory.preparation.update": ["owner", "manager"],
  "inventory.preparation.delete": ["owner"],

  // Phase 2 Tier 1.3 (M29) — Customers / Loyalty.
  // Lookup is open to all roles so kasir can pull member info at checkout;
  // edit + admin list scoped to owner+manager.
  "customer.lookup": ["owner", "manager", "staff"],
  "customer.view": ["owner", "manager"],
  "customer.create": ["owner", "manager", "staff"],
  "customer.update": ["owner", "manager"],
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
 * affect manager + staff, manager can affect staff only.
 */
export function canActOnRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return target === "staff";
  return false;
}

/**
 * Session duration per role (C2 = A).
 * Staff: 12h shift-long; Owner/Manager: 2h tighter for back office.
 * Returned in seconds — used by middleware to enforce stale-session redirect.
 */
export function sessionMaxAgeSeconds(role: Role): number {
  return role === "staff" ? 12 * 60 * 60 : 2 * 60 * 60;
}
