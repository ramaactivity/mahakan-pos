import { describe, expect, it } from "vitest";
import {
  aggregateUnitRows,
  buildDesiredUnitList,
} from "@/features/inventory/ingredient-units";
import {
  packUnitsFromIngredient,
  parsePackUnitsForm,
  resolveQtyToMaster,
  type PackUnitsForm,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-175 — tabel ingredient_units ternormalisasi. Mapping rows ↔ shape
 * resolver, + round-trip editor, + skenario Chocolatos lewat resolver yang sama.
 */

describe("aggregateUnitRows (rows → shape resolver)", () => {
  it("default-buy → unitBelanja; semua → packConversions (Chocolatos)", () => {
    const out = aggregateUnitRows([
      { label: "renceng", qtyPerBase: "280.0000", isDefaultBuy: true },
      { label: "sachet", qtyPerBase: 28, isDefaultBuy: false },
    ]);
    expect(out.unitBelanja).toBe("renceng");
    expect(out.unitBelanjaPerCogs).toBe(280);
    expect(out.packConversions).toEqual([
      { unitLabel: "renceng", qtyPerBase: 280 },
      { unitLabel: "sachet", qtyPerBase: 28 },
    ]);
  });

  it("tanpa default → unitBelanja null", () => {
    const out = aggregateUnitRows([
      { label: "Kg", qtyPerBase: 1000, isDefaultBuy: false },
    ]);
    expect(out.unitBelanja).toBeNull();
    expect(out.packConversions).toHaveLength(1);
  });

  it("skip qty invalid", () => {
    const out = aggregateUnitRows([
      { label: "x", qtyPerBase: 0, isDefaultBuy: false },
      { label: "y", qtyPerBase: 5, isDefaultBuy: false },
    ]);
    expect(out.packConversions).toEqual([{ unitLabel: "y", qtyPerBase: 5 }]);
  });
});

describe("buildDesiredUnitList (editor → rows)", () => {
  it("default + pack lain, dedup label", () => {
    const list = buildDesiredUnitList({
      unitBelanja: "renceng",
      unitBelanjaPerCogs: 280,
      packConversions: [
        { unitLabel: "Renceng", qtyPerBase: 280 }, // dup vs default → skip
        { unitLabel: "sachet", qtyPerBase: 28 },
      ],
    });
    expect(list).toEqual([
      { label: "renceng", qtyPerBase: 280, isDefaultBuy: true },
      { label: "sachet", qtyPerBase: 28, isDefaultBuy: false },
    ]);
  });

  it("tanpa default", () => {
    const list = buildDesiredUnitList({
      unitBelanja: null,
      unitBelanjaPerCogs: null,
      packConversions: [{ unitLabel: "Kg", qtyPerBase: 1000 }],
    });
    expect(list).toEqual([{ label: "Kg", qtyPerBase: 1000, isDefaultBuy: false }]);
  });
});

describe("round-trip: rows → loaded → form → parse → desired (idempoten)", () => {
  it("Chocolatos stabil", () => {
    const loaded = aggregateUnitRows([
      { label: "renceng", qtyPerBase: 280, isDefaultBuy: true },
      { label: "sachet", qtyPerBase: 28, isDefaultBuy: false },
    ]);
    const form: PackUnitsForm = packUnitsFromIngredient(loaded);
    expect(form.mainLabel).toBe("renceng");
    expect(form.packRows.map((r) => r.unitLabel)).toEqual(["sachet"]);
    const parsed = parsePackUnitsForm(form, "gr");
    const desired = buildDesiredUnitList(parsed);
    expect(desired).toEqual([
      { label: "renceng", qtyPerBase: 280, isDefaultBuy: true },
      { label: "sachet", qtyPerBase: 28, isDefaultBuy: false },
    ]);
  });
});

describe("resolver pakai output loader (Chocolatos)", () => {
  it("1 renceng → 280 gr → Rp75/gr", () => {
    const loaded = aggregateUnitRows([
      { label: "renceng", qtyPerBase: 280, isDefaultBuy: true },
      { label: "sachet", qtyPerBase: 28, isDefaultBuy: false },
    ]);
    const r = resolveQtyToMaster({
      qty: 1,
      fromUnit: "renceng",
      masterUnit: "gr",
      ingredientPacks: loaded.packConversions,
      unitBelanja: loaded.unitBelanja,
      unitBelanjaPerCogs: loaded.unitBelanjaPerCogs,
    });
    expect(r.qtyMaster).toBe(280);
    expect(Math.round(21000 / r.qtyMaster!)).toBe(75);
  });
});
