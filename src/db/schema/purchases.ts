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
  jsonb,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { suppliers } from "./suppliers";
import { ingredients, inventoryMovements } from "./inventory";
import { expenses } from "./expenses";
import { purchaseRequestItems } from "./purchase_requests";

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

    /** Sesi AE-173 — dimensi RECEIPT (terpisah dari `status` pembayaran),
     * mendukung alur PR → PO → GR. Default 'received' supaya SEMUA baris lama
     * + jalur instant `createPurchase` = perilaku kini (tanpa backfill).
     *  - 'ordered'   = PO dibuat, barang belum diterima (no expense/stok/jurnal)
     *  - 'received'  = GR/Goods Receive → expense + (stok kalau perpetual) + jurnal
     *  - 'cancelled' = PO dibatalkan sebelum GR. */
    receiptStatus: text("receipt_status", {
      enum: ["ordered", "received", "cancelled"],
    })
      .notNull()
      .default("received"),
    /** Stempel waktu GR (barang diterima). NULL untuk PO yang masih 'ordered'. */
    receivedAt: timestamp("received_at", { withTimezone: true }),

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
     * di-upload. JPG/PNG/WebP/PDF max 5MB enforced di /api/v1/purchase-receipts/upload.
     *
     * LEGACY (pre-AE-129): single URL. Sesi AE-129 menambah `receiptImageUrls`
     * (jsonb array) untuk multi-nota — staff sering belanja dari beberapa toko.
     * Untuk backward compat, kolom ini di-mirror dengan item pertama dari
     * `receiptImageUrls` saat ada. Read-path lama yang baca `receiptImageUrl`
     * tetap work tanpa perubahan. */
    receiptImageUrl: text("receipt_image_url"),

    /** Sesi AE-129 — array URL foto nota (multi-toko). Anisa request: belanja
     * sering dari beberapa toko, jadi satu purchase bisa punya >1 nota. Array
     * of strings (URL Google Drive). NULL atau [] = belum upload. Max 5 enforced
     * di client; tidak ada server-side cap (defensive client cap cukup karena
     * tidak ada cost server side per-URL — upload sudah throttled di endpoint). */
    receiptImageUrls: jsonb("receipt_image_urls").$type<string[]>(),

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

    /** Backlink to inventoryMovements row created on purchase confirm.
     * Sesi AE-173 — legacy: untuk instant purchase 1 movement per line. Untuk
     * alur PO→GR partial, movement dibuat per goods_receipt_items (bisa >1). */
    movementId: uuid("movement_id").references(() => inventoryMovements.id),

    /** Sesi AE-173 — qty yang SUDAH diterima (GR) kumulatif, dalam satuan RAW
     * sama dengan `qty`. Dipakai untuk partial receive: PO 'ordered' → 'partial'
     * → 'received' saat received_qty mencapai qty di semua line. Instant purchase
     * (createPurchase) langsung di-set = qty (fully received). */
    receivedQty: bigint("received_qty", { mode: "number" }).notNull().default(0),
    receivedQtyDecimal: numeric("received_qty_decimal", {
      precision: 15,
      scale: 4,
    })
      .notNull()
      .default("0"),

    /** Sesi AE-57 — link ke PR item kalau purchase ini ditarik dari Permintaan
     * Belanja. NULL untuk manual entry langsung. Saat di-set:
     *  - PR.receivedQty auto bump += qtyMaster
     *  - PR status auto-promote (open → partial → completed)
     *  - audit event purchase.create_from_pr di-fire
     * FK no-cascade (preserve traceability kalau PR item di-soft-delete). */
    purchaseRequestItemId: uuid("purchase_request_item_id").references(
      () => purchaseRequestItems.id,
    ),

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
    index("idx_purchase_items_pr_item").on(t.purchaseRequestItemId),
    check("ck_purchase_items_qty_pos", sql`${t.qty} > 0`),
    check("ck_purchase_items_unit_cost_nonneg", sql`${t.unitCost} >= 0`),
    check("ck_purchase_items_total_nonneg", sql`${t.totalCost} >= 0`),
  ],
);

/* ============================================================================
 * Sesi AE-173 — Goods Receipt (GR) partial. Satu PO bisa diterima bertahap
 * (beberapa GR). Tiap GR mencatat qty diterima per line → akumulasi ke
 * purchase_items.received_qty; PO 'ordered' → 'partial' → 'received'.
 * Tiap GR membuat expense (pengeluaran) + inventory_movements per line.
 * ========================================================================== */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    /** Tanggal barang diterima (WIB date). Dipakai utk anti-double-count + expense. */
    receivedDate: date("received_date").notNull(),
    notes: text("notes"),
    /** Total nilai GR ini (sum gr_items.total_cost). */
    totalAmount: bigint("total_amount", { mode: "number" }).notNull().default(0),
    /** Backlink ke expense (pengeluaran) yang dibuat saat GR ini. */
    expenseId: uuid("expense_id").references(() => expenses.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_goods_receipts_purchase").on(t.purchaseId),
    index("idx_goods_receipts_outlet_date").on(t.outletId, t.receivedDate),
    check("ck_goods_receipts_total_nonneg", sql`${t.totalAmount} >= 0`),
  ],
);

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goodsReceiptId: uuid("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    purchaseItemId: uuid("purchase_item_id")
      .notNull()
      .references(() => purchaseItems.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    /** Qty diterima GR ini (RAW unit, sama dgn purchase_items.qty). */
    receivedQty: bigint("received_qty", { mode: "number" }).notNull(),
    receivedQtyDecimal: numeric("received_qty_decimal", {
      precision: 15,
      scale: 4,
    }),
    unitCost: bigint("unit_cost", { mode: "number" }).notNull(),
    totalCost: bigint("total_cost", { mode: "number" }).notNull(),
    /** Movement (kind='purchase') yang dibuat utk line GR ini. */
    movementId: uuid("movement_id").references(() => inventoryMovements.id),
    ingredientNameSnapshot: text("ingredient_name_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    sectionSnapshot: text("section_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_gr_items_gr").on(t.goodsReceiptId),
    index("idx_gr_items_purchase_item").on(t.purchaseItemId),
    index("idx_gr_items_ingredient").on(t.ingredientId),
    check("ck_gr_items_received_qty_pos", sql`${t.receivedQty} > 0`),
    check("ck_gr_items_total_nonneg", sql`${t.totalCost} >= 0`),
  ],
);
