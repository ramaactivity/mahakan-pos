/**
 * Sesi AE-63 phase3 P3.4 — pure helper untuk Laporan Perubahan Modal
 * aggregation. Extracted dari fetchCapitalChangesReport supaya bisa
 * di-unit-test tanpa DB.
 *
 * Input:
 *  - investorRows, pengelolaRows: list holders (active + soft-deleted-not)
 *  - movementRows: raw aggregate per (holderType, holderId) dari SQL
 *
 * Output: CapitalChangesReport (sama shape dengan original).
 *
 * Logic:
 *  - aggByHolder map: gabung semua movement per (holderType, holderId)
 *  - per-holder: hitung saldoAkhir = saldoAwal + setoran + dividen
 *                                    - withdrawal + adjustment
 *  - totals: reduce sum per kolom × 2 grup (investor + pengelola)
 */

import type {
  CapitalChangeRow,
  CapitalChangesReport,
} from "./types";

export interface MovementAggInput {
  holderType: "investor" | "pengelola";
  holderId: string;
  saldoAwal: number;
  setoran: number;
  dividen: number;
  withdrawal: number;
  adjustment: number;
}

export interface BuildReportInput {
  periodStart: string;
  periodEnd: string;
  investorRows: Array<{
    id: string;
    fullName: string;
    modalDisetor: number;
  }>;
  pengelolaRows: Array<{
    id: string;
    fullName: string;
    modalDisetor: number;
  }>;
  movementRows: MovementAggInput[];
}

interface HolderAgg {
  saldoAwal: number;
  setoran: number;
  dividen: number;
  withdrawal: number;
  adjustment: number;
}

const ZERO_AGG: HolderAgg = {
  saldoAwal: 0,
  setoran: 0,
  dividen: 0,
  withdrawal: 0,
  adjustment: 0,
};

export function buildCapitalChangesReport(
  input: BuildReportInput,
): CapitalChangesReport {
  const aggByHolder = new Map<string, HolderAgg>();
  for (const m of input.movementRows) {
    const key = `${m.holderType}:${m.holderId}`;
    const existing = aggByHolder.get(key) ?? { ...ZERO_AGG };
    /* saldoAwal di-Math.max karena SQL GROUP BY (holderType, holderId, kind)
     * bisa kasih multi-row per holder; saldoAwal dihitung sama di semua row
     * (FILTER ke movement < periodStart), jadi ambil max idempotent. Yang
     * benar accumulate: setoran/dividen/withdrawal/adjustment. */
    existing.saldoAwal = Math.max(existing.saldoAwal, m.saldoAwal);
    existing.setoran += m.setoran;
    existing.dividen += m.dividen;
    existing.withdrawal += m.withdrawal;
    existing.adjustment += m.adjustment;
    aggByHolder.set(key, existing);
  }

  function buildRows(
    rows: BuildReportInput["investorRows"],
    holderType: "investor" | "pengelola",
  ): CapitalChangeRow[] {
    return rows.map((r) => {
      const agg = aggByHolder.get(`${holderType}:${r.id}`) ?? ZERO_AGG;
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

  const investorList = buildRows(input.investorRows, "investor");
  const pengelolaList = buildRows(input.pengelolaRows, "pengelola");

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

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    investors: investorList,
    pengelola: pengelolaList,
    totals,
  };
}
