import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
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
  TopHistoryItem,
  TopHistoryOptions,
  TopHistoryStatus,
  TopHistorySummary,
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

/**
 * Sesi AE-184 — riwayat hutang dagang: SEMUA pembelian TOP, lunas maupun
 * belum. Hanya `payment_method='top'` yang dihitung sebagai hutang; pembelian
 * cash/transfer memang tidak pernah jadi hutang jadi tidak masuk daftar.
 *
 * Cara bayar + nominal pelunasan diambil dari entry kas yang tertaut
 * (`purchases.expense_id`) karena tabel purchases tidak menyimpan cara bayar
 * saat pelunasan — hanya paidAt/paidBy.
 */
export async function fetchTopHistory(
  outletId: string,
  todayIso: string,
  opts: TopHistoryOptions = {},
): Promise<{ items: TopHistoryItem[]; summary: TopHistorySummary }> {
  const conds = [
    eq(purchases.outletId, outletId),
    eq(purchases.paymentMethod, "top"),
  ];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(purchases.status, opts.status));
  }
  if (opts.fromDate) conds.push(gte(purchases.purchaseDate, opts.fromDate));
  if (opts.toDate) conds.push(lte(purchases.purchaseDate, opts.toDate));
  if (opts.supplierId) conds.push(eq(purchases.supplierId, opts.supplierId));

  const rows = await db
    .select({
      id: purchases.id,
      purchaseDate: purchases.purchaseDate,
      supplierId: purchases.supplierId,
      supplierName: suppliers.name,
      invoiceNo: purchases.invoiceNo,
      totalAmount: purchases.totalAmount,
      dueDate: purchases.dueDate,
      status: purchases.status,
      paidAt: purchases.paidAt,
      paidByName: users.name,
      cancelledAt: purchases.cancelledAt,
      cancelReason: purchases.cancelReason,
      settlementMethod: expenses.paymentMethod,
      settlementAmount: expenses.amount,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.paidBy))
    .leftJoin(expenses, eq(expenses.id, purchases.expenseId))
    .where(and(...conds))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt))
    .limit(Math.min(opts.limit ?? 500, LIMIT_CAP));

  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const items: TopHistoryItem[] = rows.map((r) => {
    /* Hitung jatuh tempo hanya untuk yang masih berjalan — untuk yang sudah
     * lunas angka "telat sekian hari" tidak bermakna lagi. */
    let daysToDue: number | null = null;
    if (r.dueDate && r.status === "pending_payment") {
      daysToDue = Math.round(
        (Date.parse(`${r.dueDate}T00:00:00Z`) - today) / 86_400_000,
      );
    }
    return {
      id: r.id,
      purchaseDate: r.purchaseDate,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      invoiceNo: r.invoiceNo,
      totalAmount: Number(r.totalAmount),
      dueDate: r.dueDate,
      daysToDue,
      status: r.status as TopHistoryStatus,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      paidByName: r.paidByName ?? null,
      settlementMethod: r.settlementMethod ?? null,
      settlementAmount:
        r.settlementAmount === null ? null : Number(r.settlementAmount),
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      cancelReason: r.cancelReason ?? null,
    };
  });

  /* Ringkasan dihitung dari SELURUH hutang TOP (menghormati filter tanggal &
   * supplier, tapi mengabaikan filter status) supaya angka "Belum Bayar" dan
   * "Lunas" tetap utuh saat owner sedang membuka salah satu tab. */
  const baseConds = [
    eq(purchases.outletId, outletId),
    eq(purchases.paymentMethod, "top"),
  ];
  if (opts.fromDate) baseConds.push(gte(purchases.purchaseDate, opts.fromDate));
  if (opts.toDate) baseConds.push(lte(purchases.purchaseDate, opts.toDate));
  if (opts.supplierId) baseConds.push(eq(purchases.supplierId, opts.supplierId));

  const agg = await db
    .select({
      status: purchases.status,
      n: sql<string>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${purchases.totalAmount}), 0)`,
    })
    .from(purchases)
    .where(and(...baseConds))
    .groupBy(purchases.status);

  const summary: TopHistorySummary = {
    outstandingCount: 0,
    outstandingAmount: 0,
    dueSoonAmount: 0,
    overdueAmount: 0,
    paidCount: 0,
    paidAmount: 0,
    cancelledCount: 0,
    cancelledAmount: 0,
  };
  for (const a of agg) {
    const n = Number(a.n);
    const total = Number(a.total);
    if (a.status === "pending_payment") {
      summary.outstandingCount = n;
      summary.outstandingAmount = total;
    } else if (a.status === "paid") {
      summary.paidCount = n;
      summary.paidAmount = total;
    } else if (a.status === "cancelled") {
      summary.cancelledCount = n;
      summary.cancelledAmount = total;
    }
  }

  /* Jatuh tempo dari SELURUH hutang berjalan (tidak ikut filter status),
   * supaya kartu ringkasan tetap benar di tab mana pun. */
  const dueRows = await db
    .select({
      dueDate: purchases.dueDate,
      totalAmount: purchases.totalAmount,
    })
    .from(purchases)
    .where(
      and(...baseConds, eq(purchases.status, "pending_payment")),
    );
  for (const d of dueRows) {
    if (!d.dueDate) continue;
    const days = Math.round(
      (Date.parse(`${d.dueDate}T00:00:00Z`) - today) / 86_400_000,
    );
    if (days < 0) summary.overdueAmount += Number(d.totalAmount);
    else if (days <= 3) summary.dueSoonAmount += Number(d.totalAmount);
  }

  return { items, summary };
}
