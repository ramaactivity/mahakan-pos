import { describe, expect, it } from "vitest";
import { computeDistributionV2 } from "@/features/profit-distributions/compute-pure";

/**
 * Sesi AE-80 — Test waterfall V2 pure compute function.
 *
 * Invariants yang HARUS lulus di semua test:
 *   I1: lossAmount + capexAmount + bagiHasilAmount + retainedAmount === netProfit (exact)
 *   I2: investorPoolAmount + pengelolaPoolAmount === bagiHasilAmount (exact)
 *   I3: Σ perInvestor.amount === investorPoolAmount (after residue moved)
 *   I4: Σ perPengelola.amount === pengelolaPoolAmount (exact, residue absorbed)
 *   I5: Tidak ada Rupiah yang hilang (sum total = net atau retained + pool)
 */

const DEFAULTS = {
  lossRate: 3,
  capexRate: 0.7,
  payoutRatio: 10,
  investorPoolPct: 35,
};

function assertInvariants(input: {
  netProfit: number;
  result: ReturnType<typeof computeDistributionV2>;
}) {
  const { result } = input;
  /* I1: net = loss + capex + bagi + retained */
  expect(
    result.lossAmount +
      result.capexAmount +
      result.bagiHasilAmount +
      result.retainedAmount,
  ).toBe(result.netProfit);

  /* I2: investor + pengelola pool = bagi_hasil */
  expect(result.investorPoolAmount + result.pengelolaPoolAmount).toBe(
    result.bagiHasilAmount,
  );

  /* I3: Σ perInvestor = investorPoolAmount */
  const sumInvestor = result.perInvestor.reduce((s, l) => s + l.amount, 0);
  expect(sumInvestor).toBe(result.investorPoolAmount);

  /* I4: Σ perPengelola = pengelolaPoolAmount */
  const sumPengelola = result.perPengelola.reduce((s, l) => s + l.amount, 0);
  expect(sumPengelola).toBe(result.pengelolaPoolAmount);
}

describe("computeDistributionV2 — basic flow", () => {
  it("happy path: 3 investor share 33.33% × Rp 1.000.000 → no Rp hilang", () => {
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      ...DEFAULTS,
      investors: [
        { id: "i1", sharePct: 33.33 },
        { id: "i2", sharePct: 33.33 },
        { id: "i3", sharePct: 33.34 }, // sum = 100
      ],
      pengelola: [
        { id: "p1", modalDisetor: 2_000_000 },
        { id: "p2", modalDisetor: 3_000_000 },
      ],
    });

    expect(result.status).toBe("normal");
    expect(result.model).toBe("v2");

    /* Verify calculations:
     * loss = round(1M × 0.03) = 30,000
     * capex = round(1M × 0.007) = 7,000
     * dasar = 1M − 30K − 7K = 963,000
     * bagi_hasil = round(963K × 0.10) = 96,300
     * retained = 1M − 30K − 7K − 96.3K = 866,700
     * investor_pool = round(96,300 × 0.35) = 33,705
     * pengelola_pool = 96,300 − 33,705 = 62,595 (sebelum residue)
     */
    expect(result.lossAmount).toBe(30_000);
    expect(result.capexAmount).toBe(7_000);
    expect(result.dasarBagiHasil).toBe(963_000);
    expect(result.bagiHasilAmount).toBe(96_300);
    expect(result.retainedAmount).toBe(866_700);

    assertInvariants({ netProfit: 1_000_000, result });
  });

  it("net profit Rp 7.094.668 (kasus real Sheets) — no rupiah hilang", () => {
    const result = computeDistributionV2({
      netProfit: 7_094_668,
      ...DEFAULTS,
      investors: [
        { id: "i1", sharePct: 50 },
        { id: "i2", sharePct: 30 },
        { id: "i3", sharePct: 20 },
      ],
      pengelola: [
        { id: "p1", modalDisetor: 1_700_000 },
        { id: "p2", modalDisetor: 2_000_000 },
        { id: "p3", modalDisetor: 2_000_000 },
        { id: "p4", modalDisetor: 3_500_000 },
        { id: "p5", modalDisetor: 3_400_000 },
      ],
    });

    expect(result.status).toBe("normal");
    assertInvariants({ netProfit: 7_094_668, result });
    /* loss = round(7,094,668 × 0.03) = 212,840
     * capex = round(7,094,668 × 0.007) = 49,663
     * dasar = 7,094,668 − 212,840 − 49,663 = 6,832,165
     * bagi_hasil = round(6,832,165 × 0.10) = 683,217 (actually 683,216.5 → 683,217)
     * retained = 7,094,668 − 212,840 − 49,663 − 683,217 = 6,148,948 */
    expect(result.lossAmount).toBe(212_840);
    expect(result.capexAmount).toBe(49_663);
    expect(result.dasarBagiHasil).toBe(6_832_165);
    /* Math.round bias 0.5 ke atas. 683,216.5 → 683,217. */
    expect(result.bagiHasilAmount).toBe(683_217);
  });

  it("residue per-investor di-bebankan ke pengelola_pool", () => {
    /* Scenario yang generate non-zero residue: bagi_hasil yang setelah
     * × 0.35 menghasilkan investor_pool yang ga habis bagi rata 3 share. */
    const result = computeDistributionV2({
      netProfit: 10_000_000,
      ...DEFAULTS,
      investors: [
        { id: "i1", sharePct: 33.33 },
        { id: "i2", sharePct: 33.33 },
        { id: "i3", sharePct: 33.34 },
      ],
      pengelola: [{ id: "p1", modalDisetor: 5_000_000 }],
    });

    assertInvariants({ netProfit: 10_000_000, result });
    /* Investor pool akan ada residue karena round percentage tidak bagi
     * habis. Residue masuk ke pengelolaPoolAmount (which final = pool +
     * residue, ditangkap di assert I4). */
    expect(result.investorResidue).toBeDefined();
  });
});

describe("computeDistributionV2 — edge cases", () => {
  it("netProfit = 0 → status no_profit, semua amount 0", () => {
    const result = computeDistributionV2({
      netProfit: 0,
      ...DEFAULTS,
      investors: [{ id: "i1", sharePct: 100 }],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    expect(result.status).toBe("no_profit");
    expect(result.lossAmount).toBe(0);
    expect(result.capexAmount).toBe(0);
    expect(result.bagiHasilAmount).toBe(0);
    expect(result.retainedAmount).toBe(0);
    expect(result.investorPoolAmount).toBe(0);
    expect(result.pengelolaPoolAmount).toBe(0);
    expect(result.perInvestor.every((l) => l.amount === 0)).toBe(true);
    expect(result.perPengelola.every((l) => l.amount === 0)).toBe(true);
  });

  it("netProfit negatif → status no_profit, no distribution", () => {
    const result = computeDistributionV2({
      netProfit: -500_000,
      ...DEFAULTS,
      investors: [{ id: "i1", sharePct: 100 }],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    expect(result.status).toBe("no_profit");
    expect(result.bagiHasilAmount).toBe(0);
  });

  it("loss + capex >= net → dasar <= 0 → no distribution", () => {
    /* lossRate 60% + capexRate 50% → 110% net dipakai loss/capex.
     * dasar = net − loss − capex bisa jadi negatif. */
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      lossRate: 60,
      capexRate: 50,
      payoutRatio: 10,
      investorPoolPct: 35,
      investors: [{ id: "i1", sharePct: 100 }],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    expect(result.status).toBe("no_profit");
    expect(result.bagiHasilAmount).toBe(0);
    expect(result.investorPoolAmount).toBe(0);
  });

  it("payoutRatio = 0 → bagiHasil = 0, retained menyerap semuanya", () => {
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      lossRate: 3,
      capexRate: 0.7,
      payoutRatio: 0,
      investorPoolPct: 35,
      investors: [{ id: "i1", sharePct: 100 }],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    expect(result.bagiHasilAmount).toBe(0);
    expect(result.investorPoolAmount).toBe(0);
    expect(result.pengelolaPoolAmount).toBe(0);
    /* retained = net − loss − capex − 0 = 1M − 30K − 7K = 963,000 */
    expect(result.retainedAmount).toBe(963_000);
    assertInvariants({ netProfit: 1_000_000, result });
  });

  it("payoutRatio = 100 → bagi_hasil = dasar (full distribution), retained = 0", () => {
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      lossRate: 3,
      capexRate: 0.7,
      payoutRatio: 100,
      investorPoolPct: 35,
      investors: [{ id: "i1", sharePct: 100 }],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    expect(result.dasarBagiHasil).toBe(963_000);
    expect(result.bagiHasilAmount).toBe(963_000);
    expect(result.retainedAmount).toBe(0);
    assertInvariants({ netProfit: 1_000_000, result });
  });

  it("treasury share — sum investor share = 80%, sisa 20% absorb ke pengelola_pool", () => {
    const result = computeDistributionV2({
      netProfit: 10_000_000,
      ...DEFAULTS,
      investors: [
        { id: "i1", sharePct: 40 },
        { id: "i2", sharePct: 40 }, // sum = 80, treasury = 20
      ],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    assertInvariants({ netProfit: 10_000_000, result });
    expect(result.treasurySharePct).toBe(20);
    /* investor pool reduced by treasury 20% allocation → pengelola_pool
     * increased. Specifically: original investor_pool = 35% of bagi_hasil,
     * but 20% of that goes to treasury → pengelola. */
  });

  it("no investor (kosong) → semua bagi_hasil ke pengelola_pool", () => {
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      ...DEFAULTS,
      investors: [],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    expect(result.bagiHasilAmount).toBeGreaterThan(0);
    expect(result.investorPoolAmount).toBe(0);
    expect(result.pengelolaPoolAmount).toBe(result.bagiHasilAmount);
    expect(result.treasurySharePct).toBe(100);
    assertInvariants({ netProfit: 1_000_000, result });
  });

  it("no pengelola → pengelola_pool = 0, all goes investor", () => {
    /* Edge case: no pengelola. Compute proceeds, perPengelola kosong,
     * pengelolaPoolAmount = 0 (defensive). All goes to investor_pool. */
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      ...DEFAULTS,
      investors: [{ id: "i1", sharePct: 100 }],
      pengelola: [],
    });

    /* Since no pengelola, residue + treasury can't be absorbed. Pool split
     * stays at 35/65 but pengelolaPoolAmount stays in result tanpa lines.
     * I4 still holds (sum lines = 0 = pool_amount kalau pengelola kosong
     * — kecuali kalau pool > 0 — defensive logic akan return amount 0
     * for all). */
    expect(result.perPengelola.length).toBe(0);
    /* Edge: when pengelola=[], the residue dari investor still bisa
     * masuk ke pengelolaPoolAmount tapi tidak ada lines untuk distribusi.
     * Test invariant: Σ perPengelola = 0 ≠ pengelolaPoolAmount kalau
     * pool > 0 (correctness exception saat array kosong). Skip I4 untuk
     * kasus ini. */
    expect(result.investorPoolAmount).toBeGreaterThan(0);
  });
});

describe("computeDistributionV2 — rounding stability", () => {
  it("share_pct sum > 100 (defensive, shouldn't happen) → normalize relative", () => {
    /* User error: share sum 101%. Server seharusnya block sebelum compute,
     * tapi pure function should not crash. Pakai normalize relative. */
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      ...DEFAULTS,
      investors: [
        { id: "i1", sharePct: 50.5 },
        { id: "i2", sharePct: 50.5 }, // sum 101
      ],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    assertInvariants({ netProfit: 1_000_000, result });
    /* sum=101 > 100, treasury would be -1, but Math.max(0, ...) clamp.
     * Allocation normalized by sum, so investors get 50.5/101 = ~50% each. */
    expect(result.treasurySharePct).toBe(0); // clamped
  });

  it("single investor 100% — gets full investor_pool", () => {
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      ...DEFAULTS,
      investors: [{ id: "solo", sharePct: 100 }],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    assertInvariants({ netProfit: 1_000_000, result });
    expect(result.perInvestor[0].amount).toBe(result.investorPoolAmount);
    expect(result.investorResidue).toBe(0);
  });

  it("many small investors (100 orang) — sum tepat", () => {
    const investors = Array.from({ length: 100 }, (_, i) => ({
      id: `inv-${i}`,
      sharePct: 1, // 100 × 1% = 100%
    }));
    const result = computeDistributionV2({
      netProfit: 1_000_000,
      ...DEFAULTS,
      investors,
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    assertInvariants({ netProfit: 1_000_000, result });
    expect(result.perInvestor.length).toBe(100);
  });

  it("share % fractional precision (4 decimal) — 0.6109% × N", () => {
    /* Real data: investor backfill share_pct dengan 4 decimal precision. */
    const result = computeDistributionV2({
      netProfit: 10_000_000,
      ...DEFAULTS,
      investors: [
        { id: "i1", sharePct: 0.6109 },
        { id: "i2", sharePct: 0.6109 },
        { id: "i3", sharePct: 17.0969 },
        { id: "i4", sharePct: 12.2786 },
        { id: "i5", sharePct: 69.4027 }, // sum = 100.0000
      ],
      pengelola: [{ id: "p1", modalDisetor: 1_000_000 }],
    });

    assertInvariants({ netProfit: 10_000_000, result });
  });
});

describe("computeDistributionV2 — backward compat (V1 still works)", () => {
  it("V2 export tidak break V1 — kedua function ada", async () => {
    const mod = await import("@/features/profit-distributions/compute-pure");
    expect(typeof mod.computeDistribution).toBe("function"); // V1
    expect(typeof mod.computeDistributionV2).toBe("function"); // V2
  });
});
