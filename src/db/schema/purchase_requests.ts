import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  numeric,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { shifts } from "./shifts";
import { ingredients } from "./inventory";

/**
 * Purchase request (Phase 6.5, sesi AC-3). Diisi cashier saat tutup shift
 * untuk ingredient yang stoknya ≤ reorder_threshold. Owner/manager terima
 * notif via WhatsApp link (wa.me MVP) lalu manual belanja. Setelah belanja,
 * admin masuk screen "Permintaan Belanja" untuk receive qty per item
 * (Phase 6.6); status auto-promote ke partial / completed.
 *
 * Bukan ganti tabel `purchases` — `purchases` adalah header pembelian
 * aktual (untuk inventory movement + accounting + payable). Request hanya
 * "list belanja" dari kasir; admin opsional manually link ke purchase row
 * di follow-up.
 */
export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Shift saat request dibuat. NULL untuk request manual oleh owner. */
    shiftId: uuid("shift_id").references(() => shifts.id),

    status: text("status", {
      enum: ["open", "partial", "completed", "cancelled"],
    })
      .notNull()
      .default("open"),

    notes: text("notes"),

    /** Stamped saat WA link dibuka via UI. Tidak guarantee message terkirim;
     * sekadar audit trail kapan request di-share. */
    whatsappSentAt: timestamp("whatsapp_sent_at", { withTimezone: true }),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("idx_purchase_requests_outlet_status").on(t.outletId, t.status),
    index("idx_purchase_requests_shift").on(t.shiftId),
    index("idx_purchase_requests_outlet_created").on(
      t.outletId,
      t.createdAt,
    ),
  ],
);

export const purchaseRequestItems = pgTable(
  "purchase_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: "cascade" }),
    /** Sesi AE-16 — ingredientId is NULLABLE supaya support manual entries
     * (staff Tambah Item Manual untuk bahan yang belum di-master). Snapshot
     * name + unit always required (lossless display). Linked items punya
     * FK; manual items ingredientId=null. */
    ingredientId: uuid("ingredient_id").references(() => ingredients.id),

    /** Snapshot — tetap displayable kalau ingredient di-rename / soft-delete. */
    ingredientNameSnapshot: text("ingredient_name_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),

    /** Qty yang diminta. Bigint sesuai pattern purchase_items (atomic unit). */
    requestedQty: bigint("requested_qty", { mode: "number" }).notNull(),
    /** Sesi AE-16 — decimal mirror untuk decimal qty (e.g. 0.5 kg). */
    requestedQtyDecimal: numeric("requested_qty_decimal", {
      precision: 15,
      scale: 4,
    }),
    /** Qty yang sudah diterima. 0 → open. > 0 dan < requested → partial. */
    receivedQty: bigint("received_qty", { mode: "number" })
      .notNull()
      .default(0),
    receivedQtyDecimal: numeric("received_qty_decimal", {
      precision: 15,
      scale: 4,
    }),

    notes: text("notes"),
    displayOrder: integer("display_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_pri_request").on(t.requestId),
    index("idx_pri_ingredient").on(t.ingredientId),
    check("ck_pri_requested_qty_pos", sql`${t.requestedQty} > 0`),
    check("ck_pri_received_qty_nonneg", sql`${t.receivedQty} >= 0`),
    check(
      "ck_pri_received_lte_requested",
      sql`${t.receivedQty} <= ${t.requestedQty}`,
    ),
  ],
);
