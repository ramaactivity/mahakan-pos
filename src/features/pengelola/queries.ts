import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { capitalMovements, pengelola } from "@/db/schema";
import type { Pengelola, PengelolaWithStats } from "./types";

/**
 * Pengelola list dengan derived stats: dividend YTD/lifetime, %-share
 * dalam pool. %-share derived dari total modal pengelola (aktif).
 */
export async function fetchPengelola(
  outletId: string,
): Promise<PengelolaWithStats[]> {
  const yearStart = new Date(
    `${new Date().getUTCFullYear()}-01-01T00:00:00+07:00`,
  );

  /* Total modal pengelola aktif untuk denominator share-pct. */
  const [totalRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${pengelola.modalDisetor}), 0)`,
    })
    .from(pengelola)
    .where(
      and(
        eq(pengelola.outletId, outletId),
        eq(pengelola.status, "active"),
        isNull(pengelola.deletedAt),
      ),
    );
  const totalModal = Number(totalRow?.total ?? 0);

  /* Dividend aggregates per holder (scoped holderType='pengelola'). */
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
      })
      .from(capitalMovements)
      .where(
        and(
          eq(capitalMovements.holderType, "pengelola"),
          eq(capitalMovements.outletId, outletId),
        ),
      )
      .groupBy(capitalMovements.holderId),
  );

  const rows = await db
    .with(dividendAgg)
    .select({
      p: pengelola,
      dividendYtd: sql<string>`COALESCE(${dividendAgg.dividendYtd}, 0)`,
      dividendLifetime: sql<string>`COALESCE(${dividendAgg.dividendLifetime}, 0)`,
    })
    .from(pengelola)
    .leftJoin(dividendAgg, eq(dividendAgg.holderId, pengelola.id))
    .where(
      and(
        eq(pengelola.outletId, outletId),
        isNull(pengelola.deletedAt),
      ),
    )
    .orderBy(desc(pengelola.modalDisetor), pengelola.fullName);

  return rows.map((r) => ({
    ...r.p,
    dividendYtd: Number(r.dividendYtd),
    dividendLifetime: Number(r.dividendLifetime),
    sharePct:
      totalModal > 0 && r.p.status === "active"
        ? Number(((r.p.modalDisetor / totalModal) * 100).toFixed(4))
        : 0,
  }));
}

export async function fetchPengelolaById(
  outletId: string,
  id: string,
): Promise<Pengelola | null> {
  const [row] = await db
    .select()
    .from(pengelola)
    .where(
      and(
        eq(pengelola.id, id),
        eq(pengelola.outletId, outletId),
        isNull(pengelola.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function fetchTotalModalPengelola(
  outletId: string,
): Promise<{ total: number; count: number }> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${pengelola.modalDisetor}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(pengelola)
    .where(
      and(
        eq(pengelola.outletId, outletId),
        eq(pengelola.status, "active"),
        isNull(pengelola.deletedAt),
      ),
    );
  return { total: Number(row?.total ?? 0), count: Number(row?.count ?? 0) };
}
