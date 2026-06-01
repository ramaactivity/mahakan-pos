import { describe, expect, it } from "vitest";
import {
  mergePackConversions,
  resolveQtyToMaster,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-174 — resolveQtyToMaster = sumber kebenaran tunggal konversi
 * satuan → satuan dasar (master). Dipakai Market List untuk effective cost,
 * konsisten dgn Opname + Pembelian.
 *
 * Skenario kunci: Chocolatos. master "gr", 1 renceng = 10 sachet = 280 gr,
 * 1 sachet = 28 gr. Beli Rp 21.000/renceng → Rp 75/gr.
 */
const CHOCO_PACKS = [
  { unitLabel: "renceng", qtyPerBase: 280 },
  { unitLabel: "sachet", qtyPerBase: 28 },
];

describe("resolveQtyToMaster", () => {
  it("no-op kalau fromUnit kosong/null", () => {
    const r = resolveQtyToMaster({ qty: 5, fromUnit: null, masterUnit: "gr" });
    expect(r.ok).toBe(true);
    expect(r.qtyMaster).toBe(5);
    expect(r.costFactor).toBe(1);
    expect(r.mode).toBe("noop");
  });

  it("no-op kalau fromUnit == masterUnit", () => {
    const r = resolveQtyToMaster({ qty: 3, fromUnit: "gr", masterUnit: "gr" });
    expect(r.qtyMaster).toBe(3);
    expect(r.mode).toBe("noop");
  });

  it("same-dimension: 1 Kg → 1000 gr (costFactor 1000)", () => {
    const r = resolveQtyToMaster({ qty: 1, fromUnit: "Kg", masterUnit: "gr" });
    expect(r.ok).toBe(true);
    expect(r.qtyMaster).toBe(1000);
    expect(r.costFactor).toBe(1000);
    expect(r.mode).toBe("same-dimension");
  });

  it("same-dimension: 2 L → 2000 ml", () => {
    const r = resolveQtyToMaster({ qty: 2, fromUnit: "L", masterUnit: "ml" });
    expect(r.qtyMaster).toBe(2000);
  });

  it("ingredient-pack: 1 renceng → 280 gr (Chocolatos)", () => {
    const r = resolveQtyToMaster({
      qty: 1,
      fromUnit: "renceng",
      masterUnit: "gr",
      ingredientPacks: CHOCO_PACKS,
    });
    expect(r.ok).toBe(true);
    expect(r.qtyMaster).toBe(280);
    expect(r.costFactor).toBe(280);
    expect(r.mode).toBe("ingredient-pack");
  });

  it("ingredient-pack: 1 sachet → 28 gr", () => {
    const r = resolveQtyToMaster({
      qty: 1,
      fromUnit: "sachet",
      masterUnit: "gr",
      ingredientPacks: CHOCO_PACKS,
    });
    expect(r.qtyMaster).toBe(28);
  });

  it("ingredient-pack case-insensitive: 'Renceng' tetap 280", () => {
    const r = resolveQtyToMaster({
      qty: 2,
      fromUnit: "Renceng",
      masterUnit: "gr",
      ingredientPacks: CHOCO_PACKS,
    });
    expect(r.qtyMaster).toBe(560);
  });

  it("unitBelanja tier sebagai synthetic pack (tanpa packConversions)", () => {
    const r = resolveQtyToMaster({
      qty: 1,
      fromUnit: "renceng",
      masterUnit: "gr",
      unitBelanja: "renceng",
      unitBelanjaPerCogs: 280,
    });
    expect(r.ok).toBe(true);
    expect(r.qtyMaster).toBe(280);
  });

  it("unitBelanjaPerCogs string (kolom numeric) tetap resolve", () => {
    const r = resolveQtyToMaster({
      qty: 1,
      fromUnit: "renceng",
      masterUnit: "gr",
      unitBelanja: "renceng",
      unitBelanjaPerCogs: "280.0000",
    });
    expect(r.qtyMaster).toBe(280);
  });

  it("packConversions menang atas unitBelanja saat label sama", () => {
    const r = resolveQtyToMaster({
      qty: 1,
      fromUnit: "renceng",
      masterUnit: "gr",
      ingredientPacks: [{ unitLabel: "renceng", qtyPerBase: 280 }],
      unitBelanja: "renceng",
      unitBelanjaPerCogs: 999, // harus diabaikan
    });
    expect(r.qtyMaster).toBe(280);
  });

  it("unresolvable: satuan custom tanpa pack → ok:false", () => {
    const r = resolveQtyToMaster({
      qty: 1,
      fromUnit: "botol",
      masterUnit: "gr",
    });
    expect(r.ok).toBe(false);
    expect(r.qtyMaster).toBeNull();
    expect(r.error).toBe("UNRESOLVABLE");
  });

  it("qty <= 0 → INVALID_QTY", () => {
    const r = resolveQtyToMaster({ qty: 0, fromUnit: "gr", masterUnit: "gr" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("INVALID_QTY");
  });

  /* Skenario end-to-end Market List effective cost (replika logika backend). */
  describe("Market List effective cost (Chocolatos)", () => {
    const effective = (unitCost: number, packSize: number, packUnit: string) => {
      const r = resolveQtyToMaster({
        qty: packSize,
        fromUnit: packUnit,
        masterUnit: "gr",
        ingredientPacks: CHOCO_PACKS,
      });
      if (!r.ok || !r.qtyMaster) return null;
      return Math.round(unitCost / r.qtyMaster);
    };

    it("beli 1 renceng Rp 21.000 → Rp 75/gr", () => {
      expect(effective(21000, 1, "renceng")).toBe(75);
    });

    it("beli 1 sachet Rp 2.100 → Rp 75/gr", () => {
      expect(effective(2100, 1, "sachet")).toBe(75);
    });

    it("beli langsung per gram (200 gr Rp 21.000) → Rp 105/gr", () => {
      expect(effective(21000, 200, "gr")).toBe(105);
    });
  });
});

describe("mergePackConversions", () => {
  it("primary menang atas fallback (dedup case-insensitive)", () => {
    const out = mergePackConversions(
      [{ unitLabel: "renceng", qtyPerBase: 280 }],
      [{ unitLabel: "Renceng", qtyPerBase: 200 }],
    );
    expect(out).toEqual([{ unitLabel: "renceng", qtyPerBase: 280 }]);
  });

  it("gabung label berbeda", () => {
    const out = mergePackConversions(
      [{ unitLabel: "renceng", qtyPerBase: 280 }],
      [{ unitLabel: "sachet", qtyPerBase: 28 }],
    );
    expect(out).toHaveLength(2);
  });

  it("skip label kosong", () => {
    const out = mergePackConversions(
      [{ unitLabel: "  ", qtyPerBase: 10 }],
      [{ unitLabel: "sachet", qtyPerBase: 28 }],
    );
    expect(out).toEqual([{ unitLabel: "sachet", qtyPerBase: 28 }]);
  });
});
