import { describe, it, expect } from "vitest";
import {
  compatibleUnitsFor,
  convertQtyWithIngredientPacks,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";

describe("convertQtyWithIngredientPacks — sesi AE-62y", () => {
  it("no-op: fromUnit === masterUnit", () => {
    const res = convertQtyWithIngredientPacks(1, "pcs", "pcs", null);
    expect(res.ok).toBe(true);
    expect(res.qtyMaster).toBe(1);
    expect(res.mode).toBe("noop");
  });

  it("same-dimension fallback: Kg → gr", () => {
    const res = convertQtyWithIngredientPacks(1.5, "Kg", "gr", null);
    expect(res.ok).toBe(true);
    expect(res.qtyMaster).toBe(1500);
    expect(res.mode).toBe("same-dimension");
  });

  it("ingredient pack: 1 packs = 20 pcs (Lychee Kaleng case)", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "packs", qtyPerBase: 20 },
    ];
    const res = convertQtyWithIngredientPacks(1, "packs", "pcs", packs);
    expect(res.ok).toBe(true);
    expect(res.qtyMaster).toBe(20);
    expect(res.mode).toBe("ingredient-pack");
    expect(res.explain).toContain("1 packs");
    expect(res.explain).toContain("20 pcs");
  });

  it("ingredient pack: 3 packs × 20 = 60 pcs", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "packs", qtyPerBase: 20 },
    ];
    const res = convertQtyWithIngredientPacks(3, "packs", "pcs", packs);
    expect(res.ok).toBe(true);
    expect(res.qtyMaster).toBe(60);
  });

  it("ingredient pack: case-insensitive label match", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "packs", qtyPerBase: 20 },
    ];
    const res = convertQtyWithIngredientPacks(2, "PACKS", "pcs", packs);
    expect(res.ok).toBe(true);
    expect(res.qtyMaster).toBe(40);
  });

  it("ingredient pack: prefer same-dimension over ingredient pack kalau dimensi cocok", () => {
    // gr → kg matches same-dimension (mass) via UNIT_TABLE. Pack should not fire.
    const packs: IngredientPackConversion[] = [
      { unitLabel: "gr", qtyPerBase: 0.5 }, // intentionally wrong, harus tidak dipakai
    ];
    const res = convertQtyWithIngredientPacks(2000, "gr", "Kg", packs);
    expect(res.ok).toBe(true);
    expect(res.qtyMaster).toBe(2);
    expect(res.mode).toBe("same-dimension");
  });

  it("unknown unit + no pack match → ok=false", () => {
    const res = convertQtyWithIngredientPacks(1, "foobar", "pcs", null);
    expect(res.ok).toBe(false);
    expect(res.qtyMaster).toBeNull();
    expect(res.mode).toBeNull();
  });

  it("invalid qty (NaN) → ok=false", () => {
    const res = convertQtyWithIngredientPacks(Number.NaN, "packs", "pcs", [
      { unitLabel: "packs", qtyPerBase: 20 },
    ]);
    expect(res.ok).toBe(false);
  });

  it("pack with zero qtyPerBase → skip (no convert)", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "packs", qtyPerBase: 0 },
    ];
    const res = convertQtyWithIngredientPacks(1, "packs", "pcs", packs);
    expect(res.ok).toBe(false);
  });

  it("multiple packs: lookup by exact label match", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "packs", qtyPerBase: 20 },
      { unitLabel: "karton", qtyPerBase: 240 },
    ];
    const r1 = convertQtyWithIngredientPacks(1, "karton", "pcs", packs);
    expect(r1.qtyMaster).toBe(240);
    const r2 = convertQtyWithIngredientPacks(2, "packs", "pcs", packs);
    expect(r2.qtyMaster).toBe(40);
  });

  it("decimal pack conversion: 0.5 packs × 20 = 10 pcs", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "packs", qtyPerBase: 20 },
    ];
    const res = convertQtyWithIngredientPacks(0.5, "packs", "pcs", packs);
    expect(res.ok).toBe(true);
    expect(res.qtyMaster).toBe(10);
  });
});

describe("compatibleUnitsFor with ingredient packs — sesi AE-62y", () => {
  it("count master + pack alternatives merged (count dim includes Lusin)", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "packs", qtyPerBase: 20 },
      { unitLabel: "karton", qtyPerBase: 240 },
    ];
    const opts = compatibleUnitsFor("pcs", packs);
    const labels = opts.map((o) => o.label);
    expect(labels).toContain("Pcs");
    expect(labels).toContain("Lusin");
    expect(labels).toContain("packs");
    expect(labels).toContain("karton");
    expect(labels.length).toBe(4);
  });

  it("truly discrete master (Btl) + pack alternatives", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "krat", qtyPerBase: 24 },
    ];
    const opts = compatibleUnitsFor("Btl", packs);
    const labels = opts.map((o) => o.label);
    expect(labels).toContain("Btl");
    expect(labels).toContain("krat");
    expect(labels.length).toBe(2);
  });

  it("mass master + pack: pack adds to base same-dimension options", () => {
    const packs: IngredientPackConversion[] = [
      { unitLabel: "dus", qtyPerBase: 1000 }, // dus = 1000 gr
    ];
    const opts = compatibleUnitsFor("gr", packs);
    const labels = opts.map((o) => o.label);
    expect(labels).toContain("gr");
    expect(labels).toContain("Kg");
    expect(labels).toContain("dus");
  });

  it("dedup case-insensitive: pack same label as master skipped", () => {
    // Pack "pcs" same as master "pcs" — should be deduped.
    const packs: IngredientPackConversion[] = [
      { unitLabel: "pcs", qtyPerBase: 1 },
    ];
    const opts = compatibleUnitsFor("pcs", packs);
    expect(opts.filter((o) => o.label.toLowerCase() === "pcs").length).toBe(1);
  });

  it("no packs given → count master default (Pcs + Lusin via UNIT_TABLE)", () => {
    const opts = compatibleUnitsFor("pcs");
    const labels = opts.map((o) => o.label);
    expect(labels).toContain("Pcs");
    expect(labels).toContain("Lusin");
    expect(opts.length).toBe(2);
  });
});
