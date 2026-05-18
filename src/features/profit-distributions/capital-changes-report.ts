"use server";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  capitalMovements,
  investors,
  pengelola,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { buildCapitalChangesReport } from "./capital-changes-pure";
import {
  fail,
  ok,
  type ApiResult,
  type CapitalChangesReport,
} from "./types";

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
 *
 * Sesi AE-63e-hotfix: types CapitalChangeRow + CapitalChangesReport pindah
 * ke types.ts karena "use server" directive tidak boleh export non-async.
 */

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

  /* Sesi AE-63 phase3 P3.4 — pivot + total aggregation di-pindah ke pure
   * helper `buildCapitalChangesReport` (capital-changes-pure.ts) supaya
   * testable tanpa DB. SQL part di sini cuma fetch raw rows. */
  return ok(
    buildCapitalChangesReport({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      investorRows,
      pengelolaRows,
      movementRows: movements.map((m) => ({
        holderType: m.holderType,
        holderId: m.holderId,
        saldoAwal: Number(m.saldoAwal),
        setoran: Number(m.setoran),
        dividen: Number(m.dividen),
        withdrawal: Number(m.withdrawal),
        adjustment: Number(m.adjustment),
      })),
    }),
  );
}
