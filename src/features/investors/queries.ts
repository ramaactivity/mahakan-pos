import "server-only";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { investors, capitalMovements } from "@/db/schema";
import type {
  Investor,
  InvestorWithStats,
  ListInvestorsOptions,
  Paginated,
} from "./types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Fetch investors list dengan derived stats per row (dividen YTD,
 * lifetime, movement count). Aggregates dari capital_movements via
 * subquery agar 1 round-trip ke DB.
 */
export async function fetchInvestors(
  outletId: string,
  opts: ListInvestorsOptions = {},
): Promise<Paginated<InvestorWithStats>> {
  const status = opts.status ?? "active";
  const search = opts.search?.trim();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, opts.pageSize ?? DEFAULT_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  const yearStart = new Date(`${new Date().getUTCFullYear()}-01-01T00:00:00+07:00`);

  const conditions = [
    eq(investors.outletId, outletId),
    isNull(investors.deletedAt),
  ];
  if (status !== "all") conditions.push(eq(investors.status, status));
  if (search) {
    const like = `%${search}%`;
    const searchClause = or(
      ilike(investors.fullName, like),
      ilike(investors.nik, like),
      ilike(investors.email, like),
      ilike(investors.phone, like),
    );
    if (searchClause) conditions.push(searchClause);
  }

  const totalQuery = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(investors)
    .where(and(...conditions));
  const total = Number(totalQuery[0]?.count ?? 0);

  /* Sesi AE-63e-hotfix: pakai 2 query terpisah dibanding CTE pattern.
   * CTE `db.$with()` di Drizzle kadang trigger error di Next.js production
   * runtime walaupun typecheck/build OK. Simpler subquery aggregation
   * lebih predictable. */
  const baseRows = await db
    .select()
    .from(investors)
    .where(and(...conditions))
    .orderBy(desc(investors.modalDisetor), investors.fullName)
    .limit(pageSize)
    .offset(offset);

  /* Aggregate stats by holder dalam 1 query terpisah. */
  const investorIds = baseRows.map((r) => r.id);
  const statsByHolder = new Map<
    string,
    { dividendYtd: number; dividendLifetime: number; movementCount: number }
  >();
  if (investorIds.length > 0) {
    const aggRows = await db
      .select({
        holderId: capitalMovements.holderId,
        dividendYtd: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.kind} = 'dividend_credit' AND ${capitalMovements.occurredAt} >= ${yearStart}), 0)`,
        dividendLifetime: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.kind} = 'dividend_credit'), 0)`,
        movementCount: sql<string>`COUNT(*)`,
      })
      .from(capitalMovements)
      .where(
        and(
          eq(capitalMovements.holderType, "investor"),
          eq(capitalMovements.outletId, outletId),
          sql`${capitalMovements.holderId} = ANY(${investorIds})`,
        ),
      )
      .groupBy(capitalMovements.holderId);

    for (const r of aggRows) {
      statsByHolder.set(r.holderId, {
        dividendYtd: Number(r.dividendYtd),
        dividendLifetime: Number(r.dividendLifetime),
        movementCount: Number(r.movementCount),
      });
    }
  }

  return {
    items: baseRows.map((i) => {
      const stats = statsByHolder.get(i.id) ?? {
        dividendYtd: 0,
        dividendLifetime: 0,
        movementCount: 0,
      };
      return { ...i, ...stats };
    }),
    total,
    hasMore: offset + baseRows.length < total,
  };
}

export async function fetchInvestorById(
  outletId: string,
  id: string,
): Promise<Investor | null> {
  const [row] = await db
    .select()
    .from(investors)
    .where(
      and(
        eq(investors.id, id),
        eq(investors.outletId, outletId),
        isNull(investors.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/* Quick aggregate total modal investor untuk validator settings. */
export async function fetchTotalModalInvestors(
  outletId: string,
): Promise<{ total: number; count: number }> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${investors.modalDisetor}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(investors)
    .where(
      and(
        eq(investors.outletId, outletId),
        eq(investors.status, "active"),
        isNull(investors.deletedAt),
      ),
    );
  return {
    total: Number(row?.total ?? 0),
    count: Number(row?.count ?? 0),
  };
}
