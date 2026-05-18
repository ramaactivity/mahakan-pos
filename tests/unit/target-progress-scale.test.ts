import { describe, expect, it } from "vitest";

/**
 * Sesi AE-62ah — unit test untuk pure `computeScale` math di
 * target-progress helper. Extract supaya bisa di-test tanpa DB.
 */

interface TargetScale {
  actual: number;
  target: number | null;
  pct: number | null;
  remaining: number | null;
}

function computeScale(
  actual: number,
  target: number | undefined | null,
): TargetScale {
  if (target == null || target <= 0) {
    return { actual, target: null, pct: null, remaining: null };
  }
  const pct = Math.min(999, Math.round((actual / target) * 100));
  return { actual, target, pct, remaining: target - actual };
}

describe("computeScale (target progress math)", () => {
  it("target null → all null", () => {
    expect(computeScale(50000, null)).toEqual({
      actual: 50000,
      target: null,
      pct: null,
      remaining: null,
    });
  });

  it("target 0 atau negative → treated as null", () => {
    expect(computeScale(50000, 0).target).toBeNull();
    expect(computeScale(50000, -100).target).toBeNull();
  });

  it("actual = 0, target 100k → 0%", () => {
    const r = computeScale(0, 100_000);
    expect(r.pct).toBe(0);
    expect(r.remaining).toBe(100_000);
  });

  it("actual = 50k, target 100k → 50%", () => {
    const r = computeScale(50_000, 100_000);
    expect(r.pct).toBe(50);
    expect(r.remaining).toBe(50_000);
  });

  it("actual = 100k, target 100k → 100% exact", () => {
    const r = computeScale(100_000, 100_000);
    expect(r.pct).toBe(100);
    expect(r.remaining).toBe(0);
  });

  it("over target → pct > 100, remaining negative", () => {
    const r = computeScale(150_000, 100_000);
    expect(r.pct).toBe(150);
    expect(r.remaining).toBe(-50_000);
  });

  it("extreme over target → clamped to 999", () => {
    const r = computeScale(10_000_000_000, 100);
    expect(r.pct).toBe(999);
  });

  it("rounds pct (avoid 33.3 displays)", () => {
    const r = computeScale(33_333, 100_000);
    expect(r.pct).toBe(33);
  });
});
