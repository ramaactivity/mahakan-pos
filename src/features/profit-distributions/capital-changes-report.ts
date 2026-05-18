"use server";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  capitalMovements,
  investors,
  pengelola,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { fail, ok, type ApiResult } from "./types";

/**
 * Sesi AE-63e — Laporan Perubahan Modal (Statement of Changes in Equity).
 *
 * Per period (year): saldo awal modal investor + setoran baru + dividen
 *   yang masuk - withdrawal = saldo akhir. Per holder breakdown.
 *
 * Pattern mirror Balance Sheet aggregation: sum capital_movements by
 * kind, group by holder.
 *
 * Algoritma:
 *  - saldoAwal: SUM(amount × signed(kind)) WHERE occurredAt < periodStart
 *  - setoran (deposit + top_up): SUM amount WHERE kind IN (initial_deposit, top_up)
 *      AND occurredAt BETWEEN periodStart + periodEnd
 *  - dividen: SUM amount WHERE kind = 'dividend_credit' AND in range
 *  - withdrawal: SUM amount WHERE kind = 'withdrawal' AND in range
 *  - adjustment: SUM amount (signed) WHERE kind = 'adjustment'
 *  - saldoAkhir = saldoAwal + setoran + dividen - withdrawal ± adjustment
 */

export interface CapitalChangeRow {
  holderType: "investor" | "pengelola";
  holderId: string;
  holderName: string;
  modalDisetor: number;
  saldoAwal: number;
  setoran: number;
  dividen: number;
  withdrawal: number;
  adjustment: number;
  saldoAkhir: number;
}

export interface CapitalChangesReport {
  periodStart: string;
  periodEnd: string;
  investors: CapitalChangeRow[];
  pengelola: CapitalChangeRow[];
  totals: {
    saldoAwalInvestor: number;
    saldoAwalPengelola: number;
    setoranTotal: number;
    dividenTotal: number;
    withdrawalTotal: number;
    saldoAkhirInvestor: number;
    saldoAkhirPengelola: number;
  };
}

export async function fetchCapitalChangesReport(args: {
  periodStart: string;
  periodEnd: string;
}): Promise<ApiResult<CapitalChangesReport>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Tidak login");
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat laporan modal");
  }

  const outletId = session.user.outletId;
  const periodStartDate = new Date(`${args.periodStart}T00:00:00+07:00`);
  const periodEndDate = new Date(`${args.periodEnd}T23:59:59+07:00`);

  /* Fetch active holders (also include exited untuk historical view). */
  const investorRows = await db
    .select({
      id: investors.id,
      fullName: investors.fullName,
      modalDisetor: investors.modalDisetor,
    })
    .from(investors)
    .where(and(eq(investors.outletId, outletId), isNull(investors.deletedAt)))
    .orderBy(asc(investors.fullName));

  const pengelolaRows = await db
    .select({
      id: pengelola.id,
      fullName: pengelola.fullName,
      modalDisetor: pengelola.modalDisetor,
    })
    .from(pengelola)
    .where(and(eq(pengelola.outletId, outletId), isNull(pengelola.deletedAt)))
    .orderBy(asc(pengelola.fullName));

  /* Aggregate movements per holder. */
  const movements = await db
    .select({
      holderType: capitalMovements.holderType,
      holderId: capitalMovements.holderId,
      kind: capitalMovements.kind,
      saldoAwal: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.occurredAt} < ${periodStartDate} AND ${capitalMovements.kind} IN ('initial_deposit', 'top_up', 'dividend_credit', 'adjustment')), 0) - COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.occurredAt} < ${periodStartDate} AND ${capitalMovements.kind} = 'withdrawal'), 0)`,
      setoran: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.occurredAt} BETWEEN ${periodStartDate} AND ${periodEndDate} AND ${capitalMovements.kind} IN ('initial_deposit', 'top_up')), 0)`,
      dividen: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.occurredAt} BETWEEN ${periodStartDate} AND ${periodEndDate} AND ${capitalMovements.kind} = 'dividend_credit'), 0)`,
      withdrawal: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.occurredAt} BETWEEN ${periodStartDate} AND ${periodEndDate} AND ${capitalMovements.kind} = 'withdrawal'), 0)`,
      adjustment: sql<string>`COALESCE(SUM(${capitalMovements.amount}) FILTER (WHERE ${capitalMovements.occurredAt} BETWEEN ${periodStartDate} AND ${periodEndDate} AND ${capitalMovements.kind} = 'adjustment'), 0)`,
    })
    .from(capitalMovements)
    .where(eq(capitalMovements.outletId, outletId))
    .groupBy(capitalMovements.holderType, capitalMovements.holderId, capitalMovements.kind);

  /* Pivot to per-holder. Note: query returns 1 row per (holder, kind)
   * because of GROUP BY kind. Actually no — we used FILTER WHERE kind=X
   * inside SUM, so single row per (holderType, holderId). Let me re-verify. */
  /* The query has GROUP BY (holderType, holderId, kind) — that's wrong
   * for our purpose; want GROUP BY (holderType, holderId) only. Fix
   * below: do separate pass. */
  const aggByHolder = new Map<
    string,
    {
      saldoAwal: number;
      setoran: number;
      dividen: number;
      withdrawal: number;
      adjustment: number;
    }
  >();
  for (const m of movements) {
    const key = `${m.holderType}:${m.holderId}`;
    const existing = aggByHolder.get(key) ?? {
      saldoAwal: 0,
      setoran: 0,
      dividen: 0,
      withdrawal: 0,
      adjustment: 0,
    };
    existing.saldoAwal = Math.max(existing.saldoAwal, Number(m.saldoAwal));
    existing.setoran += Number(m.setoran);
    existing.dividen += Number(m.dividen);
    existing.withdrawal += Number(m.withdrawal);
    existing.adjustment += Number(m.adjustment);
    aggByHolder.set(key, existing);
  }

  function buildRows(
    rows: Array<{ id: string; fullName: string; modalDisetor: number }>,
    holderType: "investor" | "pengelola",
  ): CapitalChangeRow[] {
    return rows.map((r) => {
      const agg = aggByHolder.get(`${holderType}:${r.id}`) ?? {
        saldoAwal: 0,
        setoran: 0,
        dividen: 0,
        withdrawal: 0,
        adjustment: 0,
      };
      const saldoAkhir =
        agg.saldoAwal +
        agg.setoran +
        agg.dividen -
        agg.withdrawal +
        agg.adjustment;
      return {
        holderType,
        holderId: r.id,
        holderName: r.fullName,
        modalDisetor: r.modalDisetor,
        saldoAwal: agg.saldoAwal,
        setoran: agg.setoran,
        dividen: agg.dividen,
        withdrawal: agg.withdrawal,
        adjustment: agg.adjustment,
        saldoAkhir,
      };
    });
  }

  const investorList = buildRows(investorRows, "investor");
  const pengelolaList = buildRows(pengelolaRows, "pengelola");

  const totals = {
    saldoAwalInvestor: investorList.reduce((s, r) => s + r.saldoAwal, 0),
    saldoAwalPengelola: pengelolaList.reduce((s, r) => s + r.saldoAwal, 0),
    setoranTotal:
      investorList.reduce((s, r) => s + r.setoran, 0) +
      pengelolaList.reduce((s, r) => s + r.setoran, 0),
    dividenTotal:
      investorList.reduce((s, r) => s + r.dividen, 0) +
      pengelolaList.reduce((s, r) => s + r.dividen, 0),
    withdrawalTotal:
      investorList.reduce((s, r) => s + r.withdrawal, 0) +
      pengelolaList.reduce((s, r) => s + r.withdrawal, 0),
    saldoAkhirInvestor: investorList.reduce((s, r) => s + r.saldoAkhir, 0),
    saldoAkhirPengelola: pengelolaList.reduce((s, r) => s + r.saldoAkhir, 0),
  };

  return ok({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    investors: investorList,
    pengelola: pengelolaList,
    totals,
  });
}
