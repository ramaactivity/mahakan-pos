import { describe, it, expect } from "vitest";
import { computeDoubleShiftBonus } from "@/features/payroll/payroll-compute-pure";

describe("computeDoubleShiftBonus — sesi AE-62ac", () => {
  it("null config → no bonus, 0 days flagged", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [480, 600, 900],
      config: null,
      baseDailyAmount: 100_000,
    });
    expect(r.totalBonus).toBe(0);
    expect(r.daysFlagged).toBe(0);
  });

  it("fixed bonus: 1 weekend double-shift day → 100k", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [480, 480, 900], // 3 hari normal + 1 hari 15 jam
      config: { minMinutes: 600, bonusType: "fixed", bonusValue: 100_000 },
      baseDailyAmount: 0,
    });
    expect(r.totalBonus).toBe(100_000);
    expect(r.daysFlagged).toBe(1);
    expect(r.perDayBonus).toEqual([0, 0, 100_000]);
  });

  it("fixed bonus: 4 weekend double-shifts dalam sebulan → 400k", () => {
    const r = computeDoubleShiftBonus({
      // 4 hari weekend full-shift (15 jam = 900 min) + 22 hari weekday normal
      workMinutesPerDay: [
        ...Array(22).fill(480),
        900,
        900,
        900,
        900,
      ],
      config: { minMinutes: 600, bonusType: "fixed", bonusValue: 100_000 },
      baseDailyAmount: 0,
    });
    expect(r.totalBonus).toBe(400_000);
    expect(r.daysFlagged).toBe(4);
  });

  it("multiplier bonus 1.5×: 1 double-shift day → 0.5 × baseDaily extra", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [900],
      config: { minMinutes: 600, bonusType: "multiplier", bonusValue: 1.5 },
      baseDailyAmount: 200_000,
    });
    // 200k × 0.5 = 100k extra
    expect(r.totalBonus).toBe(100_000);
    expect(r.daysFlagged).toBe(1);
  });

  it("multiplier 2× → 100% extra atas base", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [900, 900],
      config: { minMinutes: 600, bonusType: "multiplier", bonusValue: 2 },
      baseDailyAmount: 150_000,
    });
    // 2 × (150k × 1) = 300k extra
    expect(r.totalBonus).toBe(300_000);
    expect(r.daysFlagged).toBe(2);
  });

  it("workMin tepat di threshold (= minMinutes) → counted as double", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [600],
      config: { minMinutes: 600, bonusType: "fixed", bonusValue: 50_000 },
      baseDailyAmount: 0,
    });
    expect(r.daysFlagged).toBe(1);
  });

  it("workMin 1 min below threshold → not counted", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [599],
      config: { minMinutes: 600, bonusType: "fixed", bonusValue: 50_000 },
      baseDailyAmount: 0,
    });
    expect(r.daysFlagged).toBe(0);
    expect(r.totalBonus).toBe(0);
  });

  it("multiplier 1.0 → no extra (degenerate but valid)", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [900],
      config: { minMinutes: 600, bonusType: "multiplier", bonusValue: 1.0 },
      baseDailyAmount: 200_000,
    });
    // bonusValue=1 → no extra. But still passes value > 0 check; multiplier mode (1-1)=0.
    expect(r.totalBonus).toBe(0);
    expect(r.daysFlagged).toBe(1); // tetap flagged sebagai double-shift day
  });

  it("invalid config (zero minMinutes) → no bonus, no crash", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [900],
      config: { minMinutes: 0, bonusType: "fixed", bonusValue: 100_000 },
      baseDailyAmount: 0,
    });
    expect(r.totalBonus).toBe(0);
  });

  it("invalid config (negative bonus) → no bonus", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [900],
      config: { minMinutes: 600, bonusType: "fixed", bonusValue: -100 },
      baseDailyAmount: 0,
    });
    expect(r.totalBonus).toBe(0);
  });

  it("Mahakan realistic: bartender 2 weekend × full-shift 15h + 20 weekday 8h", () => {
    const r = computeDoubleShiftBonus({
      workMinutesPerDay: [...Array(20).fill(480), 900, 900],
      config: { minMinutes: 600, bonusType: "fixed", bonusValue: 100_000 },
      baseDailyAmount: 0,
    });
    expect(r.totalBonus).toBe(200_000);
    expect(r.daysFlagged).toBe(2);
  });
});
