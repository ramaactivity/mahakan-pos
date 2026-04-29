import "server-only";

import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import type {
  Customer,
  ListCustomersOptions,
  ListCustomersResult,
} from "./types";

export async function fetchCustomerByPhone(
  outletId: string,
  phone: string,
): Promise<Customer | null> {
  const [row] = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.outletId, outletId),
        eq(customers.phone, phone),
        isNull(customers.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function fetchCustomerById(id: string): Promise<Customer | null> {
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function fetchCustomers(
  outletId: string,
  opts: ListCustomersOptions = {},
): Promise<ListCustomersResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const baseWhere = and(
    eq(customers.outletId, outletId),
    isNull(customers.deletedAt),
  );

  const where = opts.search
    ? and(
        baseWhere,
        or(
          ilike(customers.name, `%${opts.search}%`),
          ilike(customers.phone, `%${opts.search}%`),
        ),
      )
    : baseWhere;

  const [{ total }] = await db
    .select({ total: count() })
    .from(customers)
    .where(where);

  const items = await db
    .select()
    .from(customers)
    .where(where)
    .orderBy(desc(customers.totalSpent), desc(customers.updatedAt))
    .limit(limit)
    .offset(offset);

  return {
    items,
    total: Number(total),
    hasMore: offset + items.length < Number(total),
  };
}

export async function fetchTopCustomers(
  outletId: string,
  limit = 10,
): Promise<Customer[]> {
  return db
    .select()
    .from(customers)
    .where(
      and(eq(customers.outletId, outletId), isNull(customers.deletedAt)),
    )
    .orderBy(desc(customers.totalSpent))
    .limit(limit);
}

/** Sanity for tests + admin badge counts. */
export async function fetchCustomerStats(outletId: string): Promise<{
  total: number;
  totalPointsOutstanding: number;
  lifetimeSpend: number;
}> {
  const [row] = await db
    .select({
      total: count(),
      points: sql<number>`coalesce(sum(${customers.totalPoints}), 0)`,
      spend: sql<number>`coalesce(sum(${customers.totalSpent}), 0)`,
    })
    .from(customers)
    .where(
      and(eq(customers.outletId, outletId), isNull(customers.deletedAt)),
    );
  return {
    total: Number(row.total),
    totalPointsOutstanding: Number(row.points),
    lifetimeSpend: Number(row.spend),
  };
}
