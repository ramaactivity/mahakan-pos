import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { promos, promoUsages, transactions } from "@/db/schema";
import type { Promo, PromoWithStats } from "./types";

export interface ListPromosOptions {
  outletId: string;
  status?: "draft" | "active" | "paused" | "archived" | "all";
}

export async function fetchPromos(
  opts: ListPromosOptions,
): Promise<PromoWithStats[]> {
  const conds = [
    eq(promos.outletId, opts.outletId),
    isNull(promos.deletedAt),
  ];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(promos.status, opts.status));
  }

  // Step 1: list of promos.
  const rows = await db
    .select()
    .from(promos)
    .where(and(...conds))
    .orderBy(desc(promos.createdAt));

  if (rows.length === 0) return [];

  // Step 2: aggregate total discount given per promo, joined to non-voided
  // transactions. One GROUP BY query — simpler than correlated subselect
  // and side-steps drizzle template quirks.
  const promoIds = rows.map((r) => r.id);
  const aggRows = await db
    .select({
      promoId: promoUsages.promoId,
      totalDiscountGiven: sql<string>`COALESCE(SUM(${promoUsages.discountAmount}), 0)::text`,
    })
    .from(promoUsages)
    .innerJoin(transactions, eq(transactions.id, promoUsages.transactionId))
    .where(
      and(
        inArray(promoUsages.promoId, promoIds),
        sql`${transactions.status} NOT IN ('voided', 'refunded')`,
      ),
    )
    .groupBy(promoUsages.promoId);

  const totalByPromo = new Map<string, number>();
  for (const a of aggRows) {
    totalByPromo.set(a.promoId, Number(a.totalDiscountGiven));
  }

  return rows.map((r) => ({
    ...r,
    totalDiscountGiven: totalByPromo.get(r.id) ?? 0,
  }));
}

export async function fetchPromoById(id: string): Promise<Promo | null> {
  const [row] = await db
    .select()
    .from(promos)
    .where(and(eq(promos.id, id), isNull(promos.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Active promos for POS picker — only status='active', not deleted, ordered
 * by name for stable display. Eligibility computed client-side per cart.
 */
export async function fetchActivePromos(outletId: string): Promise<Promo[]> {
  return db
    .select()
    .from(promos)
    .where(
      and(
        eq(promos.outletId, outletId),
        eq(promos.status, "active"),
        isNull(promos.deletedAt),
      ),
    )
    .orderBy(asc(promos.name));
}
