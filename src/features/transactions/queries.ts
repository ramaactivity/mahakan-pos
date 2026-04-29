import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  transactionItems,
  transactionItemModifiers,
  transactions,
} from "@/db/schema";
import type {
  Paginated,
  Transaction,
  TransactionStatus,
  TransactionWithItems,
  PaymentMethod,
} from "./types";

export interface ListTransactionsOptions {
  shiftId?: string;
  status?: TransactionStatus;
  paymentMethod?: PaymentMethod;
  /** ISO datetime range, inclusive on both ends. */
  from?: string;
  to?: string;
  /** Substring match on transaction_number or pager. */
  search?: string;
  limit?: number;
}

export async function fetchTransactions(
  opts: ListTransactionsOptions = {},
): Promise<Paginated<Transaction>> {
  const limit = opts.limit ?? 50;
  const conds = [];
  if (opts.shiftId) conds.push(eq(transactions.shiftId, opts.shiftId));
  if (opts.status) conds.push(eq(transactions.status, opts.status));
  if (opts.paymentMethod)
    conds.push(eq(transactions.paymentMethod, opts.paymentMethod));
  if (opts.from) conds.push(gte(transactions.createdAt, new Date(opts.from)));
  if (opts.to) conds.push(lte(transactions.createdAt, new Date(opts.to)));
  if (opts.search) {
    const like = `%${opts.search.toLowerCase()}%`;
    conds.push(
      sql`(lower(${transactions.transactionNumber}) like ${like} OR cast(${transactions.pagerNumber} as text) like ${like})`,
    );
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    total: rows.length,
    hasMore,
  };
}

/** Fetch a transaction with items + modifiers joined, plus loyalty member
 * info if the trx is linked to a customer (left join). */
export async function fetchTransactionById(
  id: string,
): Promise<TransactionWithItems | null> {
  const [trx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!trx) return null;

  const items = await db
    .select()
    .from(transactionItems)
    .where(eq(transactionItems.transactionId, id))
    .orderBy(transactionItems.createdAt);

  const itemIds = items.map((i) => i.id);
  const allMods = itemIds.length
    ? await db
        .select()
        .from(transactionItemModifiers)
        .where(
          sql`${transactionItemModifiers.transactionItemId} in ${itemIds}`,
        )
    : [];

  let member: TransactionWithItems["member"] = null;
  if (trx.customerId) {
    const [c] = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        totalPoints: customers.totalPoints,
      })
      .from(customers)
      .where(eq(customers.id, trx.customerId))
      .limit(1);
    member = c ?? null;
  }

  return {
    ...trx,
    items: items.map((it) => ({
      ...it,
      modifiers: allMods.filter((m) => m.transactionItemId === it.id),
    })),
    member,
  };
}

/** Find existing transaction by clientRefId for idempotency check. */
export async function fetchTransactionByClientRefId(
  clientRefId: string,
): Promise<Transaction | null> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.clientRefId, clientRefId))
    .limit(1);
  return row ?? null;
}
