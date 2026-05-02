import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  integer,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi X — Fixed Asset register.
 *
 * Owner-managed table of capitalized assets (furniture, equipment) yang
 * di-depreciate straight-line per bulan. Each asset linked ke pair of
 * accounts: `assetAccountCode` (1201-1204) untuk debit balance + matching
 * depreciation expense account (6501-6504) untuk monthly debit + accumulated
 * depreciation kontra-asset (1290 Akumulasi Penyusutan) untuk monthly credit.
 *
 * Workflow:
 *   1. Owner add asset (manual entry atau capitalize-from-purchase) →
 *      journal entry sourceType='manual' Dr asset Cr Kas/Bank
 *   2. Monthly depreciation (Owner button click): per asset compute
 *      monthly_dep = (cost - salvage) / useful_life_months → journal entry
 *      sourceType='manual' Dr beban penyusutan Cr akumulasi penyusutan
 *   3. Disposal (Phase later): asset retired, remove from active list
 *
 * Soft FK ke chart_of_accounts (no .references) untuk avoid circular import
 * vs accounting.ts schema.
 */
export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Display name (e.g. "Mesin Espresso La Marzocco Linea Mini"). */
    name: text("name").notNull(),
    /** Optional category label (e.g. "Peralatan Bar", "Furniture", "IT"). */
    category: text("category"),

    /** Acquisition cost in IDR (rupiah integer). */
    cost: bigint("cost", { mode: "number" }).notNull(),
    /** Salvage value at end-of-useful-life. Default 0 untuk simple straight-line. */
    salvageValue: bigint("salvage_value", { mode: "number" }).notNull().default(0),
    /** Useful life dalam bulan (e.g. 60 = 5 tahun). */
    usefulLifeMonths: integer("useful_life_months").notNull(),

    /** Date asset acquired (YYYY-MM-DD WIB). */
    acquiredDate: date("acquired_date").notNull(),

    /** Soft FK to chart_of_accounts.code untuk asset account (e.g. "1201"). */
    assetAccountCode: text("asset_account_code").notNull(),
    /** Soft FK untuk depreciation expense account (e.g. "6501"). */
    depreciationAccountCode: text("depreciation_account_code").notNull(),
    /** Soft FK untuk accumulated depreciation kontra-asset (e.g. "1290"). */
    accumulatedDepreciationAccountCode: text(
      "accumulated_depreciation_account_code",
    )
      .notNull()
      .default("1290"),

    /** Last month yang sudah di-depreciate (YYYY-MM-DD = first day of month).
     * Idempotency: kalau lastDepreciatedMonth >= target month, skip. NULL =
     * belum pernah di-depreciate (acquired month belum diaccrue, will start
     * depreciation di first run). */
    lastDepreciatedMonth: date("last_depreciated_month"),

    /** Soft delete (asset disposed atau hapus mistake). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    notes: text("notes"),

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
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [
    index("idx_fixed_assets_outlet_active").on(t.outletId, t.deletedAt),
    index("idx_fixed_assets_acquired").on(t.outletId, t.acquiredDate),
    check("ck_fixed_assets_cost_pos", sql`${t.cost} > 0`),
    check(
      "ck_fixed_assets_salvage_lte_cost",
      sql`${t.salvageValue} >= 0 AND ${t.salvageValue} < ${t.cost}`,
    ),
    check(
      "ck_fixed_assets_useful_life_pos",
      sql`${t.usefulLifeMonths} > 0 AND ${t.usefulLifeMonths} <= 600`,
    ),
  ],
);
