import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  decimal,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { investors } from "./investors";
import { bankAccounts } from "./bank-accounts";
import { journalEntries } from "./accounting";

/**
 * Sesi AE-80 — Share transactions (mutasi saham).
 *
 * Track perubahan share % antar investor / antara investor & outlet.
 * 4 kind:
 *  - 'p2p_transfer': share dipindah dari investor A ke investor B.
 *    No journal (transaksi internal antar pribadi, uang di luar buku).
 *  - 'company_buyback': outlet beli kembali share dari investor.
 *    Journal Dr 3301 Buyback Saham / Cr 1101 Kas. Sisa share masuk
 *    "company hold" (compute v2 alokasi residue ke pengelola_pool).
 *  - 'top_up': investor existing tambah modal → share % naik proporsional.
 *    Journal Dr 1101 Kas / Cr 3101 Modal.
 *  - 'initial': initial deposit investor baru saat onboarding.
 *    Journal Dr 1101 Kas / Cr 3101 Modal.
 *
 * `sharePctDelta` signed: positif kalau to_investor naik (transfer_in,
 * top_up, initial); pakai magnitude saja untuk audit display.
 */
export const shareTransactions = pgTable(
  "share_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    kind: text("kind", {
      enum: ["p2p_transfer", "company_buyback", "top_up", "initial"],
    }).notNull(),

    /** Investor sumber: required untuk p2p_transfer + company_buyback;
     *  null untuk top_up + initial (tidak ada source pribadi, modal masuk
     *  ke outlet). */
    fromInvestorId: uuid("from_investor_id").references(() => investors.id),
    /** Investor tujuan: required untuk p2p_transfer + top_up + initial;
     *  null untuk company_buyback (share kembali ke outlet). */
    toInvestorId: uuid("to_investor_id").references(() => investors.id),

    /** Delta share % (magnitude, 0..100). Server interpret signed
     *  per kind: + ke to_investor, − dari from_investor. */
    sharePctDelta: decimal("share_pct_delta", { precision: 7, scale: 4 })
      .notNull(),

    /** Rupiah amount: 0 untuk p2p_transfer (internal swap, no kas);
     *  > 0 untuk company_buyback, top_up, initial. */
    amountIdr: bigint("amount_idr", { mode: "number" })
      .notNull()
      .default(0),

    /** Bank source/destination kas. Null untuk p2p_transfer. */
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    description: text("description"),

    /** Sesi AE-208 — bukti transfer (URL Google Drive, folder BUKTI JURNAL).
     *  Dipakai company_buyback (kas keluar ke investor); p2p_transfer tidak
     *  ada transfer dari kas perusahaan jadi biasanya null. Disaring
     *  `normalizeReceiptUrl` sebelum masuk DB. */
    receiptImageUrl: text("receipt_image_url"),

    /** Link ke jurnal. Null untuk p2p_transfer (no journal). */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
    ),

    status: text("status", {
      enum: ["posted", "reversed"],
    })
      .notNull()
      .default("posted"),

    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_share_tx_outlet_date").on(t.outletId, t.occurredAt),
    index("idx_share_tx_from").on(t.fromInvestorId, t.occurredAt),
    index("idx_share_tx_to").on(t.toInvestorId, t.occurredAt),
    check("ck_share_tx_delta_positive", sql`${t.sharePctDelta}::numeric > 0`),
    check(
      "ck_share_tx_delta_range",
      sql`${t.sharePctDelta}::numeric <= 100`,
    ),
    check("ck_share_tx_amount_nonneg", sql`${t.amountIdr} >= 0`),
    /* Per-kind shape constraint. P2P: both investors required, amount=0,
     * no bank. Buyback: from required, amount>0, bank required. Top_up/
     * initial: to required, amount>0, bank required. */
    check(
      "ck_share_tx_kind_shape",
      sql`
        (${t.kind} = 'p2p_transfer'
          AND ${t.fromInvestorId} IS NOT NULL
          AND ${t.toInvestorId} IS NOT NULL
          AND ${t.amountIdr} = 0
          AND ${t.bankAccountId} IS NULL)
        OR (${t.kind} = 'company_buyback'
          AND ${t.fromInvestorId} IS NOT NULL
          AND ${t.toInvestorId} IS NULL
          AND ${t.amountIdr} > 0
          AND ${t.bankAccountId} IS NOT NULL)
        OR (${t.kind} IN ('top_up', 'initial')
          AND ${t.fromInvestorId} IS NULL
          AND ${t.toInvestorId} IS NOT NULL
          AND ${t.amountIdr} > 0
          AND ${t.bankAccountId} IS NOT NULL)
      `,
    ),
  ],
);
