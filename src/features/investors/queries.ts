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

  /* Stat sub-aggregates per-investor:
   *  - dividendYtd: SUM(dividend_credit kind WHERE occurredAt >= year start)
   *  - dividendLifetime: SUM(dividend_credit kind)
   *  - movementCount: COUNT(*)
   * LEFT JOIN aggregated subquery scoped by holderType='investor'. */
  const dividendAgg = db.$with("dividend_agg").as(
    db
      .select({
        holderId: capitalMovements.holderId,
        dividendYtd: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.kind} = 'dividend_credit' AND ${capitalMovements.occurredAt} >= ${yearStart}), 0)`.as(
          "dividend_ytd",
        ),
        dividendLifetime: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.kind} = 'dividend_credit'), 0)`.as(
          "dividend_lifetime",
        ),
        movementCount: sql<string>`COUNT(*)`.as("movement_count"),
      })
      .from(capitalMovements)
      .where(
        and(
          eq(capitalMovements.holderType, "investor"),
          eq(capitalMovements.outletId, outletId),
        ),
      )
      .groupBy(capitalMovements.holderId),
  );

  const rows = await db
    .with(dividendAgg)
    .select({
      i: investors,
      dividendYtd: sql<string>`COALESCE(${dividendAgg.dividendYtd}, 0)`,
      dividendLifetime: sql<string>`COALESCE(${dividendAgg.dividendLifetime}, 0)`,
      movementCount: sql<string>`COALESCE(${dividendAgg.movementCount}, 0)`,
    })
    .from(investors)
    .leftJoin(dividendAgg, eq(dividendAgg.holderId, investors.id))
    .where(and(...conditions))
    .orderBy(desc(investors.modalDisetor), investors.fullName)
    .limit(pageSize)
    .offset(offset);

  return {
    items: rows.map((r) => ({
      ...r.i,
      dividendYtd: Number(r.dividendYtd),
      dividendLifetime: Number(r.dividendLifetime),
      movementCount: Number(r.movementCount),
    })),
    total,
    hasMore: offset + rows.length < total,
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
