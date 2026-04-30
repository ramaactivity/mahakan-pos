import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  splitPaymentItems,
  splitPayments,
  transactionItems,
  transactionItemModifiers,
  transactions,
} from "@/db/schema";
import type {
  Paginated,
  PaymentMethod,
  SplitPaymentBreakdown,
  SplitPaymentWithItems,
  Transaction,
  TransactionStatus,
  TransactionWithItems,
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

/**
 * Batch-fetch full TransactionWithItems for an array of trx ids in 4
 * round-trips total (trxns + items + modifiers + customers) instead of
 * N sequential calls to fetchTransactionById. Critical for OpenBillPanel
 * where kasir might have 10+ open bills and previous N+1 made the panel
 * slow (Galih ask #7).
 */
export async function fetchTransactionsByIds(
  ids: string[],
): Promise<TransactionWithItems[]> {
  if (ids.length === 0) return [];

  const trxRows = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.id, ids));
  if (trxRows.length === 0) return [];

  const itemRows = await db
    .select()
    .from(transactionItems)
    .where(inArray(transactionItems.transactionId, ids))
    .orderBy(transactionItems.createdAt);

  const itemIds = itemRows.map((i) => i.id);
  const modRows = itemIds.length
    ? await db
        .select()
        .from(transactionItemModifiers)
        .where(inArray(transactionItemModifiers.transactionItemId, itemIds))
    : [];

  const customerIds = trxRows
    .map((t) => t.customerId)
    .filter((c): c is string => c !== null);
  const memberRows = customerIds.length
    ? await db
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          totalPoints: customers.totalPoints,
        })
        .from(customers)
        .where(inArray(customers.id, customerIds))
    : [];

  const memberById = new Map(memberRows.map((m) => [m.id, m]));
  const itemsByTrxId = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    const arr = itemsByTrxId.get(it.transactionId) ?? [];
    arr.push(it);
    itemsByTrxId.set(it.transactionId, arr);
  }
  const modsByItemId = new Map<string, typeof modRows>();
  for (const m of modRows) {
    const arr = modsByItemId.get(m.transactionItemId) ?? [];
    arr.push(m);
    modsByItemId.set(m.transactionItemId, arr);
  }

  return trxRows.map((trx) => {
    const itsForTrx = itemsByTrxId.get(trx.id) ?? [];
    return {
      ...trx,
      items: itsForTrx.map((it) => ({
        ...it,
        modifiers: modsByItemId.get(it.id) ?? [],
      })),
      member: trx.customerId ? (memberById.get(trx.customerId) ?? null) : null,
    };
  });
}

/** Aggregate split-payment progress for one transaction. Returns the
 * splits in chronological order, sum paid so far, remaining amount, and
 * a per-trx-item map of quantities already accounted for via per_menu
 * splits. C-5 #13. */
export async function fetchSplitBreakdown(
  transactionId: string,
  transactionTotal: number,
): Promise<SplitPaymentBreakdown> {
  const splits = await db
    .select()
    .from(splitPayments)
    .where(eq(splitPayments.transactionId, transactionId))
    .orderBy(asc(splitPayments.createdAt));

  const splitIds = splits.map((s) => s.id);
  const itemRows = splitIds.length
    ? await db
        .select()
        .from(splitPaymentItems)
        .where(inArray(splitPaymentItems.splitPaymentId, splitIds))
    : [];

  const itemsBySplit = new Map<string, typeof itemRows>();
  for (const r of itemRows) {
    const arr = itemsBySplit.get(r.splitPaymentId) ?? [];
    arr.push(r);
    itemsBySplit.set(r.splitPaymentId, arr);
  }

  const splitsWithItems: SplitPaymentWithItems[] = splits.map((s) => ({
    ...s,
    items: itemsBySplit.get(s.id) ?? [],
  }));

  const totalPaid = splits.reduce((sum, s) => sum + s.amount, 0);
  const paidQuantityByTrxItemId: Record<string, number> = {};
  for (const r of itemRows) {
    paidQuantityByTrxItemId[r.transactionItemId] =
      (paidQuantityByTrxItemId[r.transactionItemId] ?? 0) + r.quantity;
  }

  return {
    splits: splitsWithItems,
    totalPaid,
    remainingAmount: Math.max(0, transactionTotal - totalPaid),
    paidQuantityByTrxItemId,
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
