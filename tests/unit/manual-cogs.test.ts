import { describe, it, expect } from "vitest";
import { resolveLineCogs } from "@/features/inventory/transaction-flow-pure";
import { computeGrossMarginPct } from "@/lib/money";

describe("resolveLineCogs (AE-173 — HPP manual menang)", () => {
  it("pakai manual cost × qty tanpa waste kalau manual diisi", () => {
    const r = resolveLineCogs({
      manualCostPerUnit: 12_000,
      recipeLineCogs: 9_999,
      quantity: 3,
    });
    expect(r.lineCogs).toBe(36_000);
    expect(r.usedManual).toBe(true);
  });

  it("manual cost 0 valid (item gratis) → cogs 0, tetap usedManual", () => {
    const r = resolveLineCogs({
      manualCostPerUnit: 0,
      recipeLineCogs: 5_000,
      quantity: 2,
    });
    expect(r.lineCogs).toBe(0);
    expect(r.usedManual).toBe(true);
  });

  it("fallback ke recipe cogs kalau manual null", () => {
    const r = resolveLineCogs({
      manualCostPerUnit: null,
      recipeLineCogs: 7_250,
      quantity: 4,
    });
    expect(r.lineCogs).toBe(7_250);
    expect(r.usedManual).toBe(false);
  });

  it("membulatkan manual cost × qty", () => {
    const r = resolveLineCogs({
      manualCostPerUnit: 3_333,
      recipeLineCogs: 0,
      quantity: 3,
    });
    expect(r.lineCogs).toBe(9_999);
    expect(r.usedManual).toBe(true);
  });

  it("manual cost negatif diabaikan → fallback recipe", () => {
    const r = resolveLineCogs({
      manualCostPerUnit: -1,
      recipeLineCogs: 1_000,
      quantity: 1,
    });
    expect(r.usedManual).toBe(false);
    expect(r.lineCogs).toBe(1_000);
  });
});

describe("computeGrossMarginPct (AE-173)", () => {
  it("cocok referensi: 35000 harga, 12000 cost → 65.7", () => {
    expect(computeGrossMarginPct(35_000, 12_000)).toBe(65.7);
  });

  it("60.0 untuk 45000/18000", () => {
    expect(computeGrossMarginPct(45_000, 18_000)).toBe(60);
  });

  it("75.0 untuk 8000/2000", () => {
    expect(computeGrossMarginPct(8_000, 2_000)).toBe(75);
  });

  it("null kalau cost belum diisi", () => {
    expect(computeGrossMarginPct(10_000, null)).toBeNull();
    expect(computeGrossMarginPct(10_000, undefined)).toBeNull();
  });

  it("null kalau harga <= 0 (open price)", () => {
    expect(computeGrossMarginPct(0, 5_000)).toBeNull();
    expect(computeGrossMarginPct(null, 5_000)).toBeNull();
  });

  it("margin negatif kalau cost > harga (rugi)", () => {
    expect(computeGrossMarginPct(10_000, 12_000)).toBe(-20);
  });
});
