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
  "transaction.discount.applied",
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
  | "inventory_movement";

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
