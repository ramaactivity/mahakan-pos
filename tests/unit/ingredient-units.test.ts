import { describe, expect, it } from "vitest";
import {
  aggregateUnitRows,
  buildDesiredUnitList,
} from "@/features/inventory/ingredient-units";
import {
  packUnitsFromIngredient,
  parsePackUnitsForm,
  resolveQtyToMaster,
  resolveLadderToBase,
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

describe("resolveLadderToBase (rantai bertingkat)", () => {
  it("renceng→sachet→gr: 1 renceng = 10 sachet, 1 sachet = 28 gr → 280", () => {
    const m = resolveLadderToBase(
      [
        { label: "renceng", qtyPerRef: 10, refUnitLabel: "sachet" },
        { label: "sachet", qtyPerRef: 28, refUnitLabel: null },
      ],
      "gr",
    );
    expect(m.get("sachet")).toBe(28);
    expect(m.get("renceng")).toBe(280);
  });
  it("langsung ke base", () => {
    const m = resolveLadderToBase([{ label: "Kg", qtyPerRef: 1000, refUnitLabel: null }], "gr");
    expect(m.get("kg")).toBe(1000);
  });
  it("3 tingkat", () => {
    const m = resolveLadderToBase(
      [
        { label: "dus", qtyPerRef: 4, refUnitLabel: "renceng" },
        { label: "renceng", qtyPerRef: 10, refUnitLabel: "sachet" },
        { label: "sachet", qtyPerRef: 28, refUnitLabel: null },
      ],
      "gr",
    );
    expect(m.get("dus")).toBe(1120);
  });
  it("ref tak ada → throw", () => {
    expect(() =>
      resolveLadderToBase([{ label: "renceng", qtyPerRef: 10, refUnitLabel: "sachet" }], "gr"),
    ).toThrow();
  });
  it("cycle → throw", () => {
    expect(() =>
      resolveLadderToBase(
        [
          { label: "a", qtyPerRef: 2, refUnitLabel: "b" },
          { label: "b", qtyPerRef: 2, refUnitLabel: "a" },
        ],
        "gr",
      ),
    ).toThrow();
  });
});
