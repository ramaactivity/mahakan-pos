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

  /* Sesi AE-63e-hotfix: 2 query terpisah dibanding CTE pattern (lebih
   * predictable di Next.js production runtime). */
  const baseRows = await db
    .select()
    .from(pengelola)
    .where(
      and(eq(pengelola.outletId, outletId), isNull(pengelola.deletedAt)),
    )
    .orderBy(desc(pengelola.modalDisetor), pengelola.fullName);

  const ids = baseRows.map((r) => r.id);
  const statsByHolder = new Map<
    string,
    { dividendYtd: number; dividendLifetime: number }
  >();
  if (ids.length > 0) {
    const aggRows = await db
      .select({
        holderId: capitalMovements.holderId,
        dividendYtd: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.kind} = 'dividend_credit' AND ${capitalMovements.occurredAt} >= ${yearStart}), 0)`,
        dividendLifetime: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.kind} = 'dividend_credit'), 0)`,
      })
      .from(capitalMovements)
      .where(
        and(
          eq(capitalMovements.holderType, "pengelola"),
          eq(capitalMovements.outletId, outletId),
          sql`${capitalMovements.holderId} = ANY(${ids})`,
        ),
      )
      .groupBy(capitalMovements.holderId);

    for (const r of aggRows) {
      statsByHolder.set(r.holderId, {
        dividendYtd: Number(r.dividendYtd),
        dividendLifetime: Number(r.dividendLifetime),
      });
    }
  }

  return baseRows.map((p) => {
    const stats = statsByHolder.get(p.id) ?? {
      dividendYtd: 0,
      dividendLifetime: 0,
    };
    return {
      ...p,
      dividendYtd: stats.dividendYtd,
      dividendLifetime: stats.dividendLifetime,
      sharePct:
        totalModal > 0 && p.status === "active"
          ? Number(((p.modalDisetor / totalModal) * 100).toFixed(4))
          : 0,
    };
  });
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
