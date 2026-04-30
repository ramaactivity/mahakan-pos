import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
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

  // Sub-aggregate of total discount given via promo_usages JOINed to
  // non-voided transactions. Use lateral subselect for clean aggregation.
  const rows = await db
    .select({
      promo: promos,
      totalDiscountGiven: sql<number>`
        COALESCE(
          (SELECT SUM(${promoUsages.discountAmount})
           FROM ${promoUsages}
           INNER JOIN ${transactions} ON ${transactions.id} = ${promoUsages.transactionId}
           WHERE ${promoUsages.promoId} = ${promos.id}
             AND ${transactions.status} NOT IN ('voided', 'refunded')),
          0
        )::bigint
      `,
    })
    .from(promos)
    .where(and(...conds))
    .orderBy(desc(promos.createdAt));

  return rows.map((r) => ({
    ...r.promo,
    totalDiscountGiven: Number(r.totalDiscountGiven),
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
