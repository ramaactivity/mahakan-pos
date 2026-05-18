import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { journalEntries } from "./accounting";

/**
 * Sesi AE-63a — Capital movement log.
 *
 * Polymorphic table tracking ALL pergerakan modal per holder (investor
 * atau pengelola). Truth source untuk running balance per orang.
 *
 * `holderType` + `holderId` polymorphic FK — di-validate app-side
 * (jangan db-level FK karena 1 kolom tidak bisa point ke 2 tabel).
 * Pattern mirror `journal_entries.sourceType` + `sourceId`.
 *
 * Kind enum:
 *  - 'initial_deposit' — setoran awal saat join (1 per holder biasanya)
 *  - 'top_up' — tambah modal setelahnya
 *  - 'dividend_credit' — credit dividen yang dibayar (created saat
 *    profit_distribution posted). Tidak ubah modalDisetor — cuma trail.
 *  - 'withdrawal' — penarikan modal (kurangi modalDisetor)
 *  - 'adjustment' — koreksi manual owner (rare, audit-only)
 *
 * `journalEntryId` link ke jurnal yang relevan — initial_deposit dan
 * top_up post Dr Cash Cr 3101 Modal, withdrawal post Dr 3201 Cr Cash,
 * dividend_credit post Dr 3201 Cr Cash (bareng dengan bulk distribution).
 */
export const capitalMovements = pgTable(
  "capital_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Polymorphic FK. Investor atau Pengelola. */
    holderType: text("holder_type", {
      enum: ["investor", "pengelola"],
    }).notNull(),
    holderId: uuid("holder_id").notNull(),

    kind: text("kind", {
      enum: [
        "initial_deposit",
        "top_up",
        "dividend_credit",
        "withdrawal",
        "adjustment",
      ],
    }).notNull(),

    /** Rupiah. Positif untuk credit ke holder (deposit/dividen),
     *  positif juga untuk withdrawal (kita treat sebagai magnitude;
     *  signed-ness derived dari `kind`). Adjustment bisa signed. */
    amount: bigint("amount", { mode: "number" }).notNull(),

    /** Tanggal pergerakan (WIB date). Bisa beda dari createdAt
     *  (mis. backfill historikal). */
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    description: text("description"),

    /** Link ke jurnal kalau movement memicu posting akuntansi.
     *  Null kalau movement masih draft / belum di-post. */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
    ),

    /** Link ke profit_distribution kalau movement = dividend_credit.
     *  Soft FK — populated saat distribution status='posted'. */
    distributionId: uuid("distribution_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [
    /* Covering index untuk balance query: WHERE holder + ORDER BY date. */
    index("idx_capital_movements_holder").on(
      t.holderType,
      t.holderId,
      t.occurredAt,
    ),
    index("idx_capital_movements_outlet_date").on(t.outletId, t.occurredAt),
    index("idx_capital_movements_distribution").on(t.distributionId),
    /* Sesi AE-63 audit P1 — investor/pengelola stats aggregation query
     * pattern: WHERE outletId=X AND holderType=Y AND holderId=ANY(...).
     * Existing idx_capital_movements_holder mulai dari (holderType, holderId);
     * untuk filter outletId-first (yang lebih selective di multi-outlet
     * future), tambah index leading dengan outletId. */
    index("idx_cm_outlet_holder").on(
      t.outletId,
      t.holderType,
      t.holderId,
    ),
    check("ck_capital_movements_amount_nonzero", sql`${t.amount} != 0`),
  ],
);
