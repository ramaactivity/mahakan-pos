import { describe, expect, it } from "vitest";

/**
 * Sesi AE-81 — Regression test untuk replace-semantic finalize fix.
 *
 * Bug yang berulang sebelumnya: kode finalize lama melakukan
 *   newStock = currentStockNow + (actual − expected_atSnapshot)
 *
 * Ketika POS sales / purchases mengubah currentStockNow di antara
 * snapshot dan finalize, formula ini double-count. Skenario reproducer:
 * snapshot 700, sales kuras stock jadi 40, staff hitung 230 fisik —
 * formula lama menghasilkan -430 (false NEGATIVE_STOCK error).
 *
 * Fix: pakai replace semantic — count IS truth.
 *   realDelta = actual − currentStockNow
 *   newStock = currentStockNow + realDelta = actual
 *
 * Test ini verifikasi pure math sebelum kena DB transaction.
 */

interface OpnameLineLike {
  expectedSnapshot: number;
  actual: number;
  currentNow: number;
  unitCost: number;
}

function computeRealDelta(l: OpnameLineLike): number {
  return l.actual - l.currentNow;
}

function computeNewStockProjected(l: OpnameLineLike): number {
  return l.currentNow + computeRealDelta(l);
}

function computeSnapshotDiff(l: OpnameLineLike): number {
  return l.actual - l.expectedSnapshot;
}

function isReplaceSafeFromNegative(l: OpnameLineLike): boolean {
  return computeNewStockProjected(l) >= 0;
}

describe("Opname replace-semantic (sesi AE-81 bug fix)", () => {
  it("Chocolatos repro: snapshot 700, current 40, count 230 — replace semantic = 230 (no error)", () => {
    const line: OpnameLineLike = {
      expectedSnapshot: 700,
      actual: 230,
      currentNow: 40,
      unitCost: 105,
    };
    /* OLD bug formula: 40 + (230 - 700) = -430 → NEGATIVE_STOCK */
    const oldFormula = line.currentNow + computeSnapshotDiff(line);
    expect(oldFormula).toBe(-430);

    /* NEW replace: realDelta = 230 - 40 = +190; new stock = 230 */
    expect(computeRealDelta(line)).toBe(190);
    expect(computeNewStockProjected(line)).toBe(230);
    expect(isReplaceSafeFromNegative(line)).toBe(true);
  });

  it("No drift case: snapshot == currentNow → realDelta equivalent to snapshotDiff", () => {
    const line: OpnameLineLike = {
      expectedSnapshot: 100,
      actual: 80,
      currentNow: 100,
      unitCost: 50,
    };
    expect(computeRealDelta(line)).toBe(-20);
    expect(computeSnapshotDiff(line)).toBe(-20);
    expect(computeNewStockProjected(line)).toBe(80);
  });

  it("Stock drifted up (purchase masuk): snapshot 100, current 150, count 130 — old formula over-adjusts", () => {
    const line: OpnameLineLike = {
      expectedSnapshot: 100,
      actual: 130,
      currentNow: 150,
      unitCost: 1000,
    };
    /* OLD: 150 + (130 - 100) = 180 — WRONG (purchase already counted, then snapshot diff added on top) */
    const oldFormula = line.currentNow + computeSnapshotDiff(line);
    expect(oldFormula).toBe(180);

    /* NEW: realDelta = 130 - 150 = -20 (need to reduce); new stock = 130 (truth) */
    expect(computeRealDelta(line)).toBe(-20);
    expect(computeNewStockProjected(line)).toBe(130);
  });

  it("Physical count zero (empty bin): stock force-reset to 0", () => {
    const line: OpnameLineLike = {
      expectedSnapshot: 50,
      actual: 0,
      currentNow: 30,
      unitCost: 200,
    };
    expect(computeRealDelta(line)).toBe(-30);
    expect(computeNewStockProjected(line)).toBe(0);
    expect(isReplaceSafeFromNegative(line)).toBe(true);
  });

  it("Negative-current case (oversold, decimal mirror): snapshot -50, current -100, count 200", () => {
    /* Real-world: stok minus karena oversold POS. Decimal mirror simpan
     * real negative; bigint clamped 0. Setelah opname benerin: stock = 200. */
    const line: OpnameLineLike = {
      expectedSnapshot: -50,
      actual: 200,
      currentNow: -100,
      unitCost: 500,
    };
    expect(computeRealDelta(line)).toBe(300);
    expect(computeNewStockProjected(line)).toBe(200);
    expect(isReplaceSafeFromNegative(line)).toBe(true);
  });

  it("Cost reporting: snapshot_diff masih bisa dipakai untuk laporan shrinkage period", () => {
    /* Snapshot diff = -470 (shortage selama opname window). Real delta
     * di-apply = -20 (drift sudah ke-cover sebagian oleh POS sales). */
    const line: OpnameLineLike = {
      expectedSnapshot: 700,
      actual: 230,
      currentNow: 250,
      unitCost: 100,
    };
    const snapshotShrinkage = computeSnapshotDiff(line) * line.unitCost;
    const realDeltaCost = computeRealDelta(line) * line.unitCost;
    expect(snapshotShrinkage).toBe(-47000); // total period loss
    expect(realDeltaCost).toBe(-2000); // immediate adjustment
    /* Journal hook AE-81 pakai realDeltaCost (match stock change),
     * laporan analytic still bisa derive snapshotShrinkage dari
     * stock_opname_lines kalau owner mau. */
  });
});
