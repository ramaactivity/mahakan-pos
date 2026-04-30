import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Supplier master (Sesi O #N+1). Adopted from Owner's old `List Supplier.csv`
 * — 17 vendors with payment terms (jatuh tempo) and category notes.
 *
 * Linked from `purchases.supplier_id` (nullable: walk-in pasar tidak punya
 * supplier formal). Soft-deletable. Unique-per-outlet name when active.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    name: text("name").notNull(),
    /** Free text — phone / WhatsApp / email / contact person. */
    contact: text("contact"),
    /** Free text category from Owner's spreadsheet — "Beans", "Cleaning",
     * "Packaging", "Belanja Dipasar". Free-text gives flexibility; normalize
     * later if collisions matter. */
    category: text("category"),
    /** Default Term of Payment in days. 0 = cash on delivery. Can be
     * overridden per purchase at entry time. */
    defaultPaymentTermDays: integer("default_payment_term_days")
      .notNull()
      .default(0),

    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("ux_suppliers_outlet_name_active")
      .on(t.outletId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_suppliers_outlet_active").on(t.outletId, t.isActive),
    check(
      "ck_suppliers_term_nonneg",
      sql`${t.defaultPaymentTermDays} >= 0`,
    ),
  ],
);
