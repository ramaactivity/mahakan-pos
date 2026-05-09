import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  numeric,
  integer,
  date,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { suppliers } from "./suppliers";
import { ingredients, inventoryMovements } from "./inventory";
import { expenses } from "./expenses";

/**
 * Purchase header (Sesi O). Replaces Owner's `Form Pembelanjaan Cash` +
 * `Form TOP` spreadsheets with a unified model. One purchase = many items
 * (typical: 5-17 lines per shopping run).
 *
 * payment_method covers Owner's bank-level granularity (BCA/BRI/Cash) plus
 * 'top' for credit terms. status lifecycle: pending_payment → paid (or →
 * cancelled). due_date auto-computed from purchase_date + payment_term_days
 * for TOP; null for non-TOP.
 *
 * On confirm: TX-create inventoryMovements (kind='purchase') per item +
 * update ingredient.current_stock + (optional) auto-create kas expense
 * with backlink via expense_id.
 */
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Nullable: pasar / walk-in tanpa supplier formal. */
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    purchaseDate: date("purchase_date").notNull(),

    paymentMethod: text("payment_method", {
      enum: ["cash", "transfer_bca", "transfer_bri", "transfer_other", "top"],
    }).notNull(),
    /** TOP days — 0 untuk non-TOP. */
    paymentTermDays: integer("payment_term_days").notNull().default(0),
    /** Auto-computed: purchase_date + payment_term_days. NULL untuk non-TOP. */
    dueDate: date("due_date"),

    invoiceNo: text("invoice_no"),
    notes: text("notes"),

    status: text("status", {
      enum: ["pending_payment", "paid", "cancelled"],
    })
      .notNull()
      .default("pending_payment"),

    /** Denormalized total: sum(items.total_cost). Stamped on insert/update
     * for fast list rendering tanpa join. */
    totalAmount: bigint("total_amount", { mode: "number" })
      .notNull()
      .default(0),

    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidBy: uuid("paid_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),

    /** Backlink to auto-created expense (kas). NULL kalau Owner uncheck
     * "buat entry kas" atau kalau status='pending_payment' (TOP). */
    expenseId: uuid("expense_id").references(() => expenses.id),

    /** Vercel Blob URL ke foto nota / bukti transfer (sesi AA #2).
     * Free-text URL field — file rename + path konvensi diatur di
     * client (purchase-receipts/{outletId}/{ts}-{filename}). NULL = belum
     * di-upload. JPG/PNG/WebP/PDF max 5MB enforced di /api/v1/purchase-receipts/upload. */
    receiptImageUrl: text("receipt_image_url"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("idx_purchases_outlet_date").on(t.outletId, t.purchaseDate),
    index("idx_purchases_supplier").on(t.supplierId),
    index("idx_purchases_status_due").on(t.status, t.dueDate),
    check("ck_purchases_total_nonneg", sql`${t.totalAmount} >= 0`),
    check("ck_purchases_term_nonneg", sql`${t.paymentTermDays} >= 0`),
  ],
);

export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),

    qty: bigint("qty", { mode: "number" }).notNull(),
    unitCost: bigint("unit_cost", { mode: "number" }).notNull(),
    totalCost: bigint("total_cost", { mode: "number" }).notNull(),

    /** Sesi AE — decimal qty (e.g. 0.5 kg, 0.25 L). NULL = legacy integer
     * row (pre-AE) yang masih pakai bigint qty saja. Saat ada nilai,
     * server treat ini sebagai authoritative qty (totalCost &
     * inventoryMovements.qtyDelta tetap snapshot bigint round). UI display
     * prefer this kalau available. */
    qtyDecimal: numeric("qty_decimal", { precision: 15, scale: 4 }),

    /** Backlink to inventoryMovements row created on purchase confirm. */
    movementId: uuid("movement_id").references(() => inventoryMovements.id),

    /** Snapshot fields for reporting consistency even kalau ingredient
     * di-rename / di-soft-delete kemudian. */
    ingredientNameSnapshot: text("ingredient_name_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    /** Sesi AE — per-line unit override (Btl/Kg/gr/Pcs/Packs/L/ml). NULL =
     * pakai master ingredient unit (unitSnapshot). Snapshot text-only,
     * tidak ada konversi server-side; staff display apa adanya. */
    unitOverride: text("unit_override"),
    /** Snapshot section enum value at purchase time. NULL kalau ingredient
     * belum di-section-kan. Used for HPP + purchase rollup grouping. */
    sectionSnapshot: text("section_snapshot"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_purchase_items_purchase").on(t.purchaseId),
    index("idx_purchase_items_ingredient").on(t.ingredientId),
    check("ck_purchase_items_qty_pos", sql`${t.qty} > 0`),
    check("ck_purchase_items_unit_cost_nonneg", sql`${t.unitCost} >= 0`),
    check("ck_purchase_items_total_nonneg", sql`${t.totalCost} >= 0`),
  ],
);
