import { describe, expect, it } from "vitest";
import { buildCapitalChangesReport } from "@/features/profit-distributions/capital-changes-pure";

/**
 * Sesi AE-63 phase3 P3.4 — coverage untuk Laporan Perubahan Modal
 * aggregation logic. Test vector mirror Sheets owner Mahakan.
 *
 * Coverage:
 *  - empty input (no holders, no movements)
 *  - holders with no movements → saldoAkhir=0
 *  - investor with setoran + dividen → saldoAkhir = setoran + dividen
 *  - withdrawal subtract dari saldoAkhir
 *  - adjustment additive (positive atau negative via signed amount)
 *  - per-period totals sum across investors + pengelola
 *  - missing movement row untuk holder → zero agg fallback
 */

const PERIOD = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

const INVESTORS = [
  { id: "i-aan", fullName: "Aan Najmutsaqib", modalDisetor: 300_000 },
  { id: "i-aina", fullName: "Aina Faradilla", modalDisetor: 500_000 },
];

const PENGELOLA = [
  { id: "p-anisa", fullName: "Anisa Amalia", modalDisetor: 1_700_000 },
];

describe("buildCapitalChangesReport — Laporan Perubahan Modal", () => {
  it("empty holders + empty movements → empty report", () => {
    const r = buildCapitalChangesReport({
      ...PERIOD,
      investorRows: [],
      pengelolaRows: [],
      movementRows: [],
    });
    expect(r.investors).toEqual([]);
    expect(r.pengelola).toEqual([]);
    expect(r.totals.saldoAkhirInvestor).toBe(0);
    expect(r.totals.dividenTotal).toBe(0);
  });

  it("holder without movements → zero saldoAkhir", () => {
    const r = buildCapitalChangesReport({
      ...PERIOD,
      investorRows: INVESTORS,
      pengelolaRows: [],
      movementRows: [],
    });
    expect(r.investors).toHaveLength(2);
    expect(r.investors[0]?.saldoAkhir).toBe(0);
    expect(r.investors[0]?.modalDisetor).toBe(300_000);
    expect(r.totals.saldoAwalInvestor).toBe(0);
  });

  it("investor with saldoAwal + setoran + dividen → saldoAkhir sum", () => {
    const r = buildCapitalChangesReport({
      ...PERIOD,
      investorRows: INVESTORS,
      pengelolaRows: [],
      movementRows: [
        {
          holderType: "investor",
          holderId: "i-aan",
          saldoAwal: 300_000,
          setoran: 0,
          dividen: 50_000,
          withdrawal: 0,
          adjustment: 0,
        },
      ],
    });
    const aan = r.investors.find((i) => i.holderId === "i-aan");
    expect(aan).toBeDefined();
    expect(aan?.saldoAkhir).toBe(350_000);
    expect(aan?.saldoAwal).toBe(300_000);
    expect(aan?.dividen).toBe(50_000);
  });

  it("withdrawal subtract dari saldoAkhir", () => {
    const r = buildCapitalChangesReport({
      ...PERIOD,
      investorRows: [INVESTORS[0]!],
      pengelolaRows: [],
      movementRows: [
        {
          holderType: "investor",
          holderId: "i-aan",
          saldoAwal: 500_000,
          setoran: 0,
          dividen: 0,
          withdrawal: 200_000,
          adjustment: 0,
        },
      ],
    });
    expect(r.investors[0]?.saldoAkhir).toBe(300_000);
    expect(r.totals.withdrawalTotal).toBe(200_000);
  });

  it("adjustment positif additive, negatif subtract via signed amount", () => {
    const r = buildCapitalChangesReport({
      ...PERIOD,
      investorRows: [INVESTORS[0]!],
      pengelolaRows: [],
      movementRows: [
        {
          holderType: "investor",
          holderId: "i-aan",
          saldoAwal: 1_000_000,
          setoran: 0,
          dividen: 0,
          withdrawal: 0,
          adjustment: -50_000,
        },
      ],
    });
    expect(r.investors[0]?.saldoAkhir).toBe(950_000);
    expect(r.investors[0]?.adjustment).toBe(-50_000);
  });

  it("totals sum across investor + pengelola", () => {
    const r = buildCapitalChangesReport({
      ...PERIOD,
      investorRows: INVESTORS,
      pengelolaRows: PENGELOLA,
      movementRows: [
        {
          holderType: "investor",
          holderId: "i-aan",
          saldoAwal: 300_000,
          setoran: 100_000,
          dividen: 50_000,
          withdrawal: 0,
          adjustment: 0,
        },
        {
          holderType: "investor",
          holderId: "i-aina",
          saldoAwal: 500_000,
          setoran: 0,
          dividen: 80_000,
          withdrawal: 30_000,
          adjustment: 0,
        },
        {
          holderType: "pengelola",
          holderId: "p-anisa",
          saldoAwal: 1_700_000,
          setoran: 0,
          dividen: 200_000,
          withdrawal: 0,
          adjustment: 0,
        },
      ],
    });
    expect(r.totals.saldoAwalInvestor).toBe(800_000);
    expect(r.totals.saldoAwalPengelola).toBe(1_700_000);
    expect(r.totals.setoranTotal).toBe(100_000);
    expect(r.totals.dividenTotal).toBe(330_000);
    expect(r.totals.withdrawalTotal).toBe(30_000);
    expect(r.totals.saldoAkhirInvestor).toBe(450_000 + 550_000);
    expect(r.totals.saldoAkhirPengelola).toBe(1_900_000);
  });

  it("movement untuk holder yang tidak ada di holders → di-ignore (no orphan row)", () => {
    const r = buildCapitalChangesReport({
      ...PERIOD,
      investorRows: [INVESTORS[0]!],
      pengelolaRows: [],
      movementRows: [
        {
          holderType: "investor",
          holderId: "i-aan",
          saldoAwal: 100_000,
          setoran: 0,
          dividen: 0,
          withdrawal: 0,
          adjustment: 0,
        },
        {
          /* orphan — investor sudah deleted, tidak ada di INVESTORS list */
          holderType: "investor",
          holderId: "i-ghost",
          saldoAwal: 999_999,
          setoran: 0,
          dividen: 0,
          withdrawal: 0,
          adjustment: 0,
        },
      ],
    });
    /* Output cuma 1 row (i-aan); i-ghost di-skip karena tidak ada di investorRows. */
    expect(r.investors).toHaveLength(1);
    expect(r.investors[0]?.holderId).toBe("i-aan");
    expect(r.investors[0]?.saldoAwal).toBe(100_000);
  });

  it("periodStart/End passed through verbatim", () => {
    const r = buildCapitalChangesReport({
      periodStart: "2026-03-15",
      periodEnd: "2026-06-30",
      investorRows: [],
      pengelolaRows: [],
      movementRows: [],
    });
    expect(r.periodStart).toBe("2026-03-15");
    expect(r.periodEnd).toBe("2026-06-30");
  });
});
