import { describe, expect, it } from "vitest";
import { computeDiffStats } from "@/features/stock-opname/diff-stats";

describe("computeDiffStats", () => {
  it("returns zeros for empty input", () => {
    const s = computeDiffStats([]);
    expect(s).toEqual({
      countedLines: 0,
      totalLines: 0,
      uncountedLines: 0,
      matchingLines: 0,
      surplusLines: 0,
      shortageLines: 0,
      totalDiffQty: 0,
      totalAbsDiffQty: 0,
      totalDiffCost: 0,
      totalAbsDiffCost: 0,
    });
  });

  it("treats null actualQty as uncounted (not in any diff bucket)", () => {
    const s = computeDiffStats([
      { expectedQty: 100, actualQty: null, unitCostAtSnapshot: 50 },
      { expectedQty: 200, actualQty: null, unitCostAtSnapshot: 50 },
    ]);
    expect(s.totalLines).toBe(2);
    expect(s.countedLines).toBe(0);
    expect(s.uncountedLines).toBe(2);
    expect(s.matchingLines).toBe(0);
    expect(s.surplusLines).toBe(0);
    expect(s.shortageLines).toBe(0);
    expect(s.totalAbsDiffCost).toBe(0);
  });

  it("buckets matching/surplus/shortage correctly", () => {
    const s = computeDiffStats([
      { expectedQty: 100, actualQty: 100, unitCostAtSnapshot: 50 }, // match
      { expectedQty: 100, actualQty: 120, unitCostAtSnapshot: 50 }, // surplus +20
      { expectedQty: 100, actualQty: 80, unitCostAtSnapshot: 50 }, // shortage -20
    ]);
    expect(s.matchingLines).toBe(1);
    expect(s.surplusLines).toBe(1);
    expect(s.shortageLines).toBe(1);
    expect(s.countedLines).toBe(3);
    expect(s.totalDiffQty).toBe(0); // +20 + (-20) = 0
    expect(s.totalAbsDiffQty).toBe(40); // 0 + 20 + 20
    expect(s.totalDiffCost).toBe(0);
    expect(s.totalAbsDiffCost).toBe(2000); // 40 × 50
  });

  it("ignores unit cost on matching lines (no impact)", () => {
    const s = computeDiffStats([
      { expectedQty: 50, actualQty: 50, unitCostAtSnapshot: 9999 },
    ]);
    expect(s.totalAbsDiffCost).toBe(0);
    expect(s.matchingLines).toBe(1);
  });

  it("scales cost impact by per-line unit cost", () => {
    const s = computeDiffStats([
      { expectedQty: 0, actualQty: 5, unitCostAtSnapshot: 1000 }, // +5 × 1000 = +5000
      { expectedQty: 10, actualQty: 8, unitCostAtSnapshot: 200 }, // -2 × 200 = -400
    ]);
    expect(s.totalDiffCost).toBe(4600); // 5000 - 400
    expect(s.totalAbsDiffCost).toBe(5400);
    expect(s.surplusLines).toBe(1);
    expect(s.shortageLines).toBe(1);
  });

  // Sesi AE-62e — negative-stock case (oversold sebelum opname). Bigint
  // expected di-clamp ke 0 untuk pass ck_opname_lines_expected_nonneg,
  // real value disimpan di decimal. computeDiffStats harus prefer decimal
  // supaya preview diff cocok dengan apa yang finalize akan kerjakan.
  describe("negative-stock (decimal mirror)", () => {
    it("prefers expectedQtyDecimal over clamped bigint expectedQty", () => {
      const s = computeDiffStats([
        {
          // Bigint clamped ke 0, real value -198 (oversold)
          expectedQty: 0,
          expectedQtyDecimal: "-198.0000",
          actualQty: 0,
          actualQtyDecimal: "0.0000",
          unitCostAtSnapshot: 30,
        },
      ]);
      // Real diff: 0 - (-198) = +198 (adjust to bring stock back to 0)
      expect(s.totalDiffQty).toBe(198);
      expect(s.totalAbsDiffQty).toBe(198);
      expect(s.totalDiffCost).toBe(198 * 30);
      expect(s.surplusLines).toBe(1);
    });

    it("prefers actualQtyDecimal over bigint actualQty", () => {
      const s = computeDiffStats([
        {
          expectedQty: 100,
          expectedQtyDecimal: "100.0000",
          actualQty: 102, // rounded
          actualQtyDecimal: "102.5000", // decimal precision
          unitCostAtSnapshot: 50,
        },
      ]);
      expect(s.totalDiffQty).toBe(2.5);
      expect(s.totalAbsDiffCost).toBe(125);
    });

    it("falls back to bigint when decimal is null (legacy lines)", () => {
      const s = computeDiffStats([
        {
          expectedQty: 50,
          expectedQtyDecimal: null,
          actualQty: 60,
          actualQtyDecimal: null,
          unitCostAtSnapshot: 10,
        },
      ]);
      expect(s.totalDiffQty).toBe(10);
      expect(s.totalAbsDiffCost).toBe(100);
    });
  });

  it("handles a mix of counted and uncounted lines", () => {
    const s = computeDiffStats([
      { expectedQty: 100, actualQty: 100, unitCostAtSnapshot: 50 },
      { expectedQty: 100, actualQty: null, unitCostAtSnapshot: 50 },
      { expectedQty: 100, actualQty: 90, unitCostAtSnapshot: 50 },
    ]);
    expect(s.totalLines).toBe(3);
    expect(s.countedLines).toBe(2);
    expect(s.uncountedLines).toBe(1);
    expect(s.shortageLines).toBe(1);
    expect(s.matchingLines).toBe(1);
    expect(s.totalAbsDiffCost).toBe(500); // 10 × 50
  });

  /* Sesi AE-63 phase5 — regression untuk bug "Submit opname error: Operasi
   * database gagal". Pre-fix: 127 line dengan decimal qty diff (mis. 2.5 kg)
   * × bigint unitCost → totalAbsDiffCost terkumpul sebagai float
   * (e.g. 123456.789), saat di-tulis ke bigint column Postgres reject.
   *
   * compute-pure SENGAJA returns float (UI butuh precision untuk display).
   * DB write boundary di actions.ts (submit + finalize) yang harus
   * Math.round. Test ini memastikan compute helper masih return decimal
   * sebagaimana mestinya (jangan ke-fix di tempat salah). */
  describe("decimal precision preservation (UI accuracy)", () => {
    it("preserves fractional totalAbsDiffCost untuk display UI", () => {
      const s = computeDiffStats([
        {
          expectedQty: 0,
          expectedQtyDecimal: "100.0000",
          actualQty: 0,
          actualQtyDecimal: "97.5000",
          unitCostAtSnapshot: 333,
        },
      ]);
      /* 2.5 × 333 = 832.5 (float). Compute keep precision; action layer
       * yang round saat tulis ke bigint column. */
      expect(s.totalAbsDiffCost).toBe(832.5);
      expect(s.totalAbsDiffQty).toBe(2.5);
    });

    it("simulates 127-line submit scale: sum harus tetap finite (not NaN)", () => {
      const lines = Array.from({ length: 127 }, (_, i) => ({
        expectedQty: 100,
        expectedQtyDecimal: "100.0000",
        actualQty: 99,
        actualQtyDecimal: "99.3500", // 0.65 diff
        unitCostAtSnapshot: 1000 + i, // varying cost
      }));
      const s = computeDiffStats(lines);
      expect(Number.isFinite(s.totalAbsDiffCost)).toBe(true);
      expect(Number.isFinite(s.totalAbsDiffQty)).toBe(true);
      expect(s.countedLines).toBe(127);
      expect(s.shortageLines).toBe(127);
      /* Math.round( accumulated float ) harus integer (caller responsibility). */
      expect(Number.isInteger(Math.round(s.totalAbsDiffCost))).toBe(true);
      expect(Number.isInteger(Math.round(s.totalAbsDiffQty))).toBe(true);
    });
  });
});
