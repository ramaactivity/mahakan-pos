import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  purchaseItems,
  purchases,
  suppliers,
  users,
} from "@/db/schema";
import type {
  ListPurchasesOptions,
  PaymentMethod,
  Purchase,
  PurchaseDetail,
  PurchaseListItem,
  TopOutstandingItem,
} from "./types";

const LIMIT_CAP = 1000;

export async function fetchPurchases(
  outletId: string,
  opts: ListPurchasesOptions = {},
): Promise<PurchaseListItem[]> {
  const limit = Math.min(opts.limit ?? 100, LIMIT_CAP);
  const offset = opts.offset ?? 0;

  const conds = [eq(purchases.outletId, outletId)];
  if (opts.status) conds.push(eq(purchases.status, opts.status));
  if (opts.supplierId)
    conds.push(eq(purchases.supplierId, opts.supplierId));
  if (opts.paymentMethod)
    conds.push(eq(purchases.paymentMethod, opts.paymentMethod));
  if (opts.dateFrom)
    conds.push(gte(purchases.purchaseDate, opts.dateFrom));
  if (opts.dateTo)
    conds.push(lte(purchases.purchaseDate, opts.dateTo));

  const rows = await db
    .select({
      purchase: purchases,
      supplierName: suppliers.name,
      itemCount: sql<number>`(
        select count(*)::int from ${purchaseItems}
        where ${purchaseItems.purchaseId} = ${purchases.id}
      )`,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(...conds))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r.purchase,
    supplierName: r.supplierName,
    itemCount: r.itemCount,
  }));
}

export async function fetchPurchaseDetail(
  id: string,
  outletId: string,
): Promise<PurchaseDetail | null> {
  const [headerRow] = await db
    .select({
      purchase: purchases,
      supplierName: suppliers.name,
      createdByName: users.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.createdBy))
    .where(
      and(eq(purchases.id, id), eq(purchases.outletId, outletId)),
    )
    .limit(1);
  if (!headerRow) return null;

  // Resolve actor names for paid_by / cancelled_by.
  const userIds = new Set<string>();
  if (headerRow.purchase.paidBy) userIds.add(headerRow.purchase.paidBy);
  if (headerRow.purchase.cancelledBy)
    userIds.add(headerRow.purchase.cancelledBy);
  const nameById = new Map<string, string>();
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));
    for (const u of userRows) nameById.set(u.id, u.name);
  }

  const itemRows = await db
    .select({
      item: purchaseItems,
      currentUnit: ingredients.unit,
      currentSection: ingredients.section,
    })
    .from(purchaseItems)
    .innerJoin(
      ingredients,
      eq(ingredients.id, purchaseItems.ingredientId),
    )
    .where(eq(purchaseItems.purchaseId, id))
    .orderBy(purchaseItems.ingredientNameSnapshot);

  return {
    ...headerRow.purchase,
    supplierName: headerRow.supplierName,
    createdByName: headerRow.createdByName,
    paidByName: headerRow.purchase.paidBy
      ? nameById.get(headerRow.purchase.paidBy) ?? null
      : null,
    cancelledByName: headerRow.purchase.cancelledBy
      ? nameById.get(headerRow.purchase.cancelledBy) ?? null
      : null,
    items: itemRows.map((r) => ({
      ...r.item,
      currentUnit: r.currentUnit,
      currentSection: r.currentSection,
    })),
  };
}

export async function fetchTopOutstanding(
  outletId: string,
  todayIso: string,
): Promise<TopOutstandingItem[]> {
  const rows = await db
    .select({
      purchase: purchases,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(
      and(
        eq(purchases.outletId, outletId),
        eq(purchases.status, "pending_payment"),
      ),
    )
    .orderBy(purchases.dueDate);

  return rows.map((r) => {
    const due = r.purchase.dueDate;
    let daysToDue: number | null = null;
    if (due) {
      const today = Date.parse(todayIso + "T00:00:00Z");
      const dueAt = Date.parse(due + "T00:00:00Z");
      daysToDue = Math.round((dueAt - today) / (1000 * 60 * 60 * 24));
    }
    return {
      id: r.purchase.id,
      purchaseDate: r.purchase.purchaseDate,
      supplierId: r.purchase.supplierId,
      supplierName: r.supplierName,
      invoiceNo: r.purchase.invoiceNo,
      totalAmount: r.purchase.totalAmount,
      dueDate: due,
      daysToDue,
    };
  });
}

/**
 * Aggregate purchase totals grouped by date × section × payment_method.
 * Used by purchase rollup report (replaces Owner's `Rekap Inv Detail` pivot).
 */
export async function fetchPurchaseRollup(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<
  Array<{
    purchaseDate: string;
    section: string | null;
    paymentMethod: PaymentMethod;
    totalAmount: number;
  }>
> {
  const rows = await db
    .select({
      purchaseDate: purchases.purchaseDate,
      section: purchaseItems.sectionSnapshot,
      paymentMethod: purchases.paymentMethod,
      totalAmount: sql<number>`coalesce(sum(${purchaseItems.totalCost}), 0)::bigint`,
    })
    .from(purchases)
    .innerJoin(
      purchaseItems,
      eq(purchaseItems.purchaseId, purchases.id),
    )
    .where(
      and(
        eq(purchases.outletId, outletId),
        sql`${purchases.status} != 'cancelled'`,
        gte(purchases.purchaseDate, dateFrom),
        lte(purchases.purchaseDate, dateTo),
      ),
    )
    .groupBy(
      purchases.purchaseDate,
      purchaseItems.sectionSnapshot,
      purchases.paymentMethod,
    )
    .orderBy(purchases.purchaseDate);

  return rows.map((r) => ({
    purchaseDate: r.purchaseDate,
    section: r.section,
    paymentMethod: r.paymentMethod,
    totalAmount: Number(r.totalAmount),
  }));
}

export async function fetchPurchaseById(
  id: string,
  outletId: string,
): Promise<Purchase | null> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.outletId, outletId)))
    .limit(1);
  return row ?? null;
}

/** Total purchase amount per ingredient in a date range. Used by HPP report. */
export async function fetchPurchasesByIngredient(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<
  Map<string, { qty: number; cost: number }>
> {
  const rows = await db
    .select({
      ingredientId: purchaseItems.ingredientId,
      qty: sql<number>`coalesce(sum(${purchaseItems.qty}), 0)::bigint`,
      cost: sql<number>`coalesce(sum(${purchaseItems.totalCost}), 0)::bigint`,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .where(
      and(
        eq(purchases.outletId, outletId),
        sql`${purchases.status} != 'cancelled'`,
        gte(purchases.purchaseDate, dateFrom),
        lte(purchases.purchaseDate, dateTo),
      ),
    )
    .groupBy(purchaseItems.ingredientId);

  const map = new Map<string, { qty: number; cost: number }>();
  for (const r of rows) {
    map.set(r.ingredientId, {
      qty: Number(r.qty),
      cost: Number(r.cost),
    });
  }
  return map;
}
