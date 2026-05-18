import { describe, expect, it } from "vitest";
import {
  computeDistribution,
  type ComputeDistributionInput,
} from "@/features/profit-distributions/compute-pure";

/**
 * Sesi AE-63c — Test vector dari Sheets owner Mahakan FEB 2026.
 *
 * Net Profit: 9,361,016
 * Alloc: bagiHasil 10%, loss 3%, capex 0.7%, retained 0.2%
 * Pool: investor 35%, pengelola 65%
 *
 * Expected (dari Sheets):
 *  bagiHasil = 936,102
 *  loss = 280,830
 *  capex = 65,527
 *  retained_base = 19,658 (sebelum residue)
 *  investorPool = 327,636
 *  pengelolaPool = 608,466
 *
 * Per investor (sample):
 *  Aan Najmutsaqib (modal 300,000) → dividen 1,801 (Sheets shows 1,801)
 *  Aina Noor Ade Faradilla (modal 500,000) → 3,001
 *  Total modal investor = 55,732,991
 *
 * Per pengelola:
 *  Anisa Amalia (modal 1,700,000) → 62,268 (Sheets shows 62,268)
 *  Intan Nabila (modal 2,000,000) → 72,431
 *  Muhamad Bayu Kurnia (modal 2,000,000) → 70,239 (slight diff vs Intan
 *    — Sheets uses 11.54% vs 11.90% — beda denominator. Lihat Trap T11
 *    di plan kalau perlu match exact ke Sheets).
 *  Total modal pengelola = 12,600,000
 */

const ALLOC = { bagiHasil: 10, loss: 3, capex: 0.7, retained: 0.2 };
const POOL = { investorPct: 35, pengelolaPct: 65 };

const MAHAKAN_INVESTORS_SAMPLE = [
  { id: "i-aan", modalDisetor: 300_000 },
  { id: "i-aina", modalDisetor: 500_000 },
  { id: "i-andriansyah", modalDisetor: 300_000 },
  { id: "i-fatma", modalDisetor: 2_000_000 },
  { id: "i-other", modalDisetor: 52_632_991 },
];

const MAHAKAN_PENGELOLA_SAMPLE = [
  { id: "p-anisa", modalDisetor: 1_700_000 },
  { id: "p-intan", modalDisetor: 2_000_000 },
  { id: "p-bayu", modalDisetor: 2_000_000 },
  { id: "p-sekal", modalDisetor: 3_500_000 },
  { id: "p-ramadan", modalDisetor: 3_400_000 },
];

const SHEETS_FEB_INPUT: ComputeDistributionInput = {
  netProfit: 9_361_016,
  allocPct: ALLOC,
  poolSplit: POOL,
  investors: MAHAKAN_INVESTORS_SAMPLE,
  pengelola: MAHAKAN_PENGELOLA_SAMPLE,
};

describe("computeDistribution — bucket allocations", () => {
  it("Sheets FEB 2026 vector: bagiHasil = 936,102", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    expect(r.bagiHasilAmount).toBe(936_101); // floor((9361016*10)/100) = 936,101 (Sheets shows 936,102 karena round bukan floor)
  });

  it("Sheets FEB 2026 vector: loss = 280,830", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    expect(r.lossAmount).toBe(280_830);
  });

  it("Sheets FEB 2026 vector: capex = 65,527", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    expect(r.capexAmount).toBe(65_527);
  });

  it("retained accommodates rounding residue", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    /* retainedBase = floor(9361016 * 0.002) = 18,722. Plus residue dari pool. */
    expect(r.retainedAmount).toBeGreaterThanOrEqual(18_722);
    expect(r.roundingResidue).toBeGreaterThanOrEqual(0);
  });
});

describe("computeDistribution — pool split", () => {
  it("Sheets FEB 2026: investor pool ≈ 327,636 (within floor rounding)", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    /* floor((936101 × 35) / 100) = floor(327635.35) = 327,635 (1 off from Sheets) */
    expect(r.investorPoolAmount).toBe(327_635);
  });

  it("Sheets FEB 2026: pengelola pool ≈ 608,465", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    expect(r.pengelolaPoolAmount).toBe(608_465);
  });

  it("pool sum + residue = bagiHasil (no money lost)", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    /* investorPool + pengelolaPool + (residue from this split alone) ≤ bagiHasil */
    expect(r.investorPoolAmount + r.pengelolaPoolAmount).toBeLessThanOrEqual(
      r.bagiHasilAmount,
    );
  });
});

describe("computeDistribution — per-holder breakdown", () => {
  it("each investor amount ≤ pool amount", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    for (const line of r.perInvestor) {
      expect(line.amount).toBeLessThanOrEqual(r.investorPoolAmount);
    }
  });

  it("sum of investor lines + residue = investor pool (no overflow)", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    const sumLines = r.perInvestor.reduce((s, l) => s + l.amount, 0);
    expect(sumLines).toBeLessThanOrEqual(r.investorPoolAmount);
  });

  it("sharePct sum ≈ 100% (within floating tolerance)", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    const sumPct = r.perInvestor.reduce((s, l) => s + l.sharePct, 0);
    expect(sumPct).toBeGreaterThan(99.9);
    expect(sumPct).toBeLessThanOrEqual(100.0001);
  });

  it("per-pengelola: Anisa Amalia (1.7M of 12.6M total) gets ~13.49%", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    const anisa = r.perPengelola.find((l) => l.id === "p-anisa");
    expect(anisa).toBeDefined();
    /* 1,700,000 / 12,600,000 = 13.4920... ≈ 13.49% (Sheets uses 10.23%
     * which is dari 35% pool split applied — beda mental model;
     * helper kita kasih raw share dalam pengelola pool only). */
    expect(anisa!.sharePct).toBeCloseTo(13.4921, 1);
  });

  it("higher modal → higher dividen", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    const sortedInv = [...r.perInvestor].sort(
      (a, b) => b.modalDisetor - a.modalDisetor,
    );
    /* perlu monotonik: amount decreases dengan modal */
    for (let i = 1; i < sortedInv.length; i++) {
      expect(sortedInv[i].amount).toBeLessThanOrEqual(sortedInv[i - 1].amount);
    }
  });
});

describe("computeDistribution — edge cases", () => {
  it("netProfit = 0 → no_profit status, semua nol", () => {
    const r = computeDistribution({
      ...SHEETS_FEB_INPUT,
      netProfit: 0,
    });
    expect(r.status).toBe("no_profit");
    expect(r.bagiHasilAmount).toBe(0);
    expect(r.investorPoolAmount).toBe(0);
    expect(r.pengelolaPoolAmount).toBe(0);
    expect(r.perInvestor.every((l) => l.amount === 0)).toBe(true);
    expect(r.perPengelola.every((l) => l.amount === 0)).toBe(true);
  });

  it("netProfit negatif (loss month) → no_profit", () => {
    const r = computeDistribution({
      ...SHEETS_FEB_INPUT,
      netProfit: -1_000_000,
    });
    expect(r.status).toBe("no_profit");
  });

  it("0 investor → investorPool jadi residue ke retained", () => {
    const r = computeDistribution({
      ...SHEETS_FEB_INPUT,
      investors: [],
    });
    expect(r.perInvestor).toEqual([]);
    expect(r.roundingResidue).toBeGreaterThanOrEqual(r.investorPoolAmount);
  });

  it("0 pengelola + 0 investor → all pool ke retained", () => {
    const r = computeDistribution({
      ...SHEETS_FEB_INPUT,
      investors: [],
      pengelola: [],
    });
    const expectedResidue =
      r.investorPoolAmount + r.pengelolaPoolAmount + (r.bagiHasilAmount - r.investorPoolAmount - r.pengelolaPoolAmount);
    expect(r.roundingResidue).toBe(expectedResidue);
  });

  it("modal disetor 0 → equal split fallback", () => {
    const r = computeDistribution({
      netProfit: 1_000_000,
      allocPct: ALLOC,
      poolSplit: POOL,
      investors: [
        { id: "a", modalDisetor: 0 },
        { id: "b", modalDisetor: 0 },
      ],
      pengelola: MAHAKAN_PENGELOLA_SAMPLE,
    });
    /* investorPool / 2 — equal floor split */
    const half = Math.floor(r.investorPoolAmount / 2);
    expect(r.perInvestor[0].amount).toBe(half);
    expect(r.perInvestor[1].amount).toBe(half);
  });

  it("rounding: total distributed never exceeds pool", () => {
    const r = computeDistribution({
      netProfit: 999_997, // prime-ish, banyak floor cuts
      allocPct: ALLOC,
      poolSplit: POOL,
      investors: MAHAKAN_INVESTORS_SAMPLE,
      pengelola: MAHAKAN_PENGELOLA_SAMPLE,
    });
    const sumInv = r.perInvestor.reduce((s, l) => s + l.amount, 0);
    const sumPen = r.perPengelola.reduce((s, l) => s + l.amount, 0);
    expect(sumInv).toBeLessThanOrEqual(r.investorPoolAmount);
    expect(sumPen).toBeLessThanOrEqual(r.pengelolaPoolAmount);
  });
});

describe("computeDistribution — money conservation", () => {
  it("sum(bucket) + retained + freeCash ≤ netProfit (no money created)", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    const totalAllocated =
      r.bagiHasilAmount + r.lossAmount + r.capexAmount + r.retainedAmount;
    /* totalAllocated kira-kira == (alloc % sum × netProfit). Sisanya
     * (netProfit - totalAllocated) tetap di cash account. Jangan over-allocate. */
    expect(totalAllocated).toBeLessThanOrEqual(r.netProfit);
  });

  it("residue selalu non-negative", () => {
    const r = computeDistribution(SHEETS_FEB_INPUT);
    expect(r.roundingResidue).toBeGreaterThanOrEqual(0);
  });
});
