import { describe, expect, it } from "vitest";
import {
  buildOpnameUnitContext,
  computeOpnameQtyFromSplit,
  convertPurchaseQty,
  normalizeUnitLabel,
  scaleCostOnUnitChange,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-43 — unit conversion fix di Catat Pembelian.
 * Test cases mirror skenario UAT di plan file (gula gr master + Kg/Pack/Pcs input).
 */
describe("convertPurchaseQty", () => {
  it("no-op kalau fromUnit null", () => {
    const res = convertPurchaseQty({
      qty: 2,
      fromUnit: null,
      masterUnit: "gr",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qtyMaster).toBe(2);
      expect(res.costFactor).toBe(1);
      expect(res.mode).toBe("noop");
    }
  });

  it("no-op kalau fromUnit === masterUnit (case-insensitive)", () => {
    const res = convertPurchaseQty({
      qty: 500,
      fromUnit: "GR",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qtyMaster).toBe(500);
      expect(res.mode).toBe("noop");
    }
  });

  it("convert mass↔mass (Kg → gr)", () => {
    const res = convertPurchaseQty({
      qty: 2,
      fromUnit: "Kg",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qtyMaster).toBe(2000);
      expect(res.costFactor).toBe(1000);
      expect(res.mode).toBe("same-dimension");
    }
  });

  it("convert mass↔mass dengan decimal qty (0.5 Kg → 500 gr)", () => {
    const res = convertPurchaseQty({
      qty: 0.5,
      fromUnit: "Kg",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qtyMaster).toBe(500);
    }
  });

  it("convert volume↔volume (L → ml)", () => {
    const res = convertPurchaseQty({
      qty: 1.5,
      fromUnit: "L",
      masterUnit: "ml",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qtyMaster).toBe(1500);
    }
  });

  it("convert discrete → continuous via pack (Pack → gr)", () => {
    const res = convertPurchaseQty({
      qty: 2,
      fromUnit: "Pack",
      masterUnit: "gr",
      pack: { packSize: 1000, packUnit: "gr" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qtyMaster).toBe(2000);
      expect(res.mode).toBe("via-pack");
      expect(res.explain).toContain("Pack");
    }
  });

  it("convert discrete → continuous via pack dengan pack unit beda master (Pack → ml via L)", () => {
    const res = convertPurchaseQty({
      qty: 3,
      fromUnit: "Pack",
      masterUnit: "ml",
      pack: { packSize: 2, packUnit: "L" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 3 Pack × 2 L/Pack = 6 L = 6000 ml
      expect(res.qtyMaster).toBe(6000);
    }
  });

  it("reject PACK_UNKNOWN kalau discrete → continuous tanpa pack info", () => {
    const res = convertPurchaseQty({
      qty: 2,
      fromUnit: "Pack",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("PACK_UNKNOWN");
      expect(res.message).toContain("Market List");
    }
  });

  it("reject DIMENSION_MISMATCH kalau Pcs → gr tanpa pack", () => {
    // Pcs adalah "count" dimension (kalau di table), gr adalah "mass".
    // Tanpa pack info, tidak compatible.
    const res = convertPurchaseQty({
      qty: 5,
      fromUnit: "Pcs",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // Tergantung dimensi: kalau Pcs di-classify count + gr mass, dimensi
      // beda → DIMENSION_MISMATCH. Kalau Pcs discrete → PACK_UNKNOWN.
      expect(["DIMENSION_MISMATCH", "PACK_UNKNOWN"]).toContain(res.error);
    }
  });

  it("reject INVALID_QTY kalau qty negatif", () => {
    const res = convertPurchaseQty({
      qty: -1,
      fromUnit: "Kg",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("INVALID_QTY");
    }
  });

  it("reject INVALID_QTY kalau qty 0", () => {
    const res = convertPurchaseQty({
      qty: 0,
      fromUnit: "Kg",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(false);
  });

  it("reject UNKNOWN_UNIT kalau fromUnit ngaco", () => {
    const res = convertPurchaseQty({
      qty: 1,
      fromUnit: "Zorgblats",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("UNKNOWN_UNIT");
    }
  });

  it("costFactor untuk no-op = 1 (untuk backward-compat scaling)", () => {
    const res = convertPurchaseQty({
      qty: 100,
      fromUnit: "gr",
      masterUnit: "gr",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Per AE-43: cost master = unitCost / costFactor.
      // costFactor=1 → cost master = unitCost raw. Backward-compat.
      expect(res.costFactor).toBe(1);
    }
  });

  it("costFactor untuk mass conversion = 1000× (Kg → gr)", () => {
    const res = convertPurchaseQty({
      qty: 2,
      fromUnit: "Kg",
      masterUnit: "gr",
      pack: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Rp 50.000/Kg → Rp 50/gr (50.000 / 1000)
      const masterCost = Math.round(50000 / res.costFactor);
      expect(masterCost).toBe(50);
    }
  });

  /* Sesi AE-62af — ingredient-scoped pack conversions */
  describe("ingredientPacks fallback", () => {
    it("Lychee Kaleng: 1 packs = 20 pcs (master pcs)", () => {
      const res = convertPurchaseQty({
        qty: 2,
        fromUnit: "packs",
        masterUnit: "pcs",
        pack: null,
        ingredientPacks: [{ unitLabel: "packs", qtyPerBase: 20 }],
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.qtyMaster).toBe(40);
        expect(res.mode).toBe("via-pack");
      }
    });

    it("case-insensitive label match", () => {
      const res = convertPurchaseQty({
        qty: 1,
        fromUnit: "PACKS",
        masterUnit: "pcs",
        pack: null,
        ingredientPacks: [{ unitLabel: "packs", qtyPerBase: 20 }],
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.qtyMaster).toBe(20);
    });

    it("ingredientPacks prioritas atas supplier pack (lebih spesifik per-bahan)", () => {
      const res = convertPurchaseQty({
        qty: 1,
        fromUnit: "packs",
        masterUnit: "pcs",
        // supplier kasih 10/pack, ingredient kasih 20/packs — ingredient menang
        pack: { packSize: 10, packUnit: "pcs" },
        ingredientPacks: [{ unitLabel: "packs", qtyPerBase: 20 }],
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.qtyMaster).toBe(20);
    });

    it("fallback ke supplier pack kalau ingredientPacks tidak match label", () => {
      const res = convertPurchaseQty({
        qty: 1,
        fromUnit: "Pack",
        masterUnit: "gr",
        pack: { packSize: 1000, packUnit: "gr" },
        ingredientPacks: [{ unitLabel: "dus", qtyPerBase: 24 }],
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.qtyMaster).toBe(1000);
    });

    it("PACK_UNKNOWN kalau tidak ada match di mana-mana", () => {
      const res = convertPurchaseQty({
        qty: 1,
        fromUnit: "packs",
        masterUnit: "pcs",
        pack: null,
        ingredientPacks: [{ unitLabel: "dus", qtyPerBase: 24 }],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("PACK_UNKNOWN");
    });
  });
});

/**
 * Sesi AE-63 phase6 — staff gudang request: input belanja kayak Sheets,
 * timbangan 250gr + harga Rp 10rb/Kg → otomatis hitung perkilo. Form
 * Catat Pembelian sekarang auto-scale harga saat user ganti dropdown unit.
 * scaleCostOnUnitChange = pure helper untuk logic ini.
 */
describe("scaleCostOnUnitChange", () => {
  it("scale Rp 10.000/Kg → Rp 10/gr saat user ganti Kg ke gr", () => {
    const r = scaleCostOnUnitChange({
      oldUnit: "Kg",
      newUnit: "gr",
      oldCost: 10000,
    });
    expect(r).toBe(10);
  });

  it("scale Rp 10/gr → Rp 10.000/Kg saat user ganti gr ke Kg", () => {
    const r = scaleCostOnUnitChange({
      oldUnit: "gr",
      newUnit: "Kg",
      oldCost: 10,
    });
    expect(r).toBe(10000);
  });

  it("scale Rp 50.000/L → Rp 50/ml saat ganti L ke ml", () => {
    const r = scaleCostOnUnitChange({
      oldUnit: "L",
      newUnit: "ml",
      oldCost: 50000,
    });
    expect(r).toBe(50);
  });

  it("scale Rp 12.000/Lusin → Rp 1.000/Pcs saat ganti Lusin ke Pcs", () => {
    const r = scaleCostOnUnitChange({
      oldUnit: "Lusin",
      newUnit: "Pcs",
      oldCost: 12000,
    });
    expect(r).toBe(1000);
  });

  it("null kalau unit sama (no change)", () => {
    expect(
      scaleCostOnUnitChange({ oldUnit: "Kg", newUnit: "Kg", oldCost: 10000 }),
    ).toBeNull();
  });

  it("null kalau oldUnit kosong (first selection)", () => {
    expect(
      scaleCostOnUnitChange({ oldUnit: "", newUnit: "Kg", oldCost: 10000 }),
    ).toBeNull();
  });

  it("null kalau cross-dimension (gr ↔ ml)", () => {
    expect(
      scaleCostOnUnitChange({ oldUnit: "gr", newUnit: "ml", oldCost: 50 }),
    ).toBeNull();
  });

  it("null kalau discrete unit (Pack ↔ Btl)", () => {
    expect(
      scaleCostOnUnitChange({ oldUnit: "Pack", newUnit: "Btl", oldCost: 5000 }),
    ).toBeNull();
  });

  it("null kalau cost 0 atau negative (nothing to scale)", () => {
    expect(
      scaleCostOnUnitChange({ oldUnit: "Kg", newUnit: "gr", oldCost: 0 }),
    ).toBeNull();
    expect(
      scaleCostOnUnitChange({ oldUnit: "Kg", newUnit: "gr", oldCost: -100 }),
    ).toBeNull();
  });

  it("case-insensitive unit names (KG ↔ kg)", () => {
    const r = scaleCostOnUnitChange({
      oldUnit: "KG",
      newUnit: "gr",
      oldCost: 8000,
    });
    expect(r).toBe(8);
  });

  it("fractional result tetap return (caller decide Math.round)", () => {
    /* 333 Rp/Kg ÷ 1000 = 0.333 Rp/gr. Caller responsibility round. */
    const r = scaleCostOnUnitChange({
      oldUnit: "Kg",
      newUnit: "gr",
      oldCost: 333,
    });
    expect(r).toBeCloseTo(0.333, 5);
  });
});

/* Sesi AE-147 — Opname unit context (purchase + recipe + pack alts). */
describe("buildOpnameUnitContext", () => {
  it("recipe-only fallback (no purchase tier, no pack alt)", () => {
    const ctx = buildOpnameUnitContext({ recipeUnit: "g" });
    expect(ctx.defaultUnit).toBe("g");
    expect(ctx.purchaseUnit).toBeNull();
    expect(ctx.supportsSplitInput).toBe(false);
    /* Should include same-dimension legacy units (Kg). */
    expect(ctx.options.some((o) => o.value === "Kg")).toBe(true);
  });

  it("includes purchase tier sebagai default", () => {
    const ctx = buildOpnameUnitContext({
      recipeUnit: "pcs",
      unitBelanja: "pack",
      unitBelanjaPerCogs: 5,
    });
    expect(ctx.defaultUnit).toBe("pack");
    expect(ctx.purchaseUnit).toBe("pack");
    expect(ctx.options[0].value).toBe("pack");
    expect(ctx.options[0].hint).toContain("5 pcs");
    expect(ctx.multipliers.get("pack")).toBe(5);
    expect(ctx.multipliers.get("pcs")).toBe(1);
    expect(ctx.supportsSplitInput).toBe(true);
  });

  it("identity purchase (kg+kg, per=1) → no separate option", () => {
    const ctx = buildOpnameUnitContext({
      recipeUnit: "kg",
      unitBelanja: "kg",
      unitBelanjaPerCogs: 1,
    });
    /* Purchase unit === recipe unit → tidak listed terpisah. */
    expect(ctx.purchaseUnit).toBeNull();
    expect(ctx.defaultUnit).toBe("kg");
  });

  it("pack alternatives merged + dedup", () => {
    const ctx = buildOpnameUnitContext({
      recipeUnit: "pcs",
      unitBelanja: "pack",
      unitBelanjaPerCogs: 5,
      packConversions: [
        { unitLabel: "Karton", qtyPerBase: 60 },
        { unitLabel: "pack", qtyPerBase: 99 }, // dedup vs purchase (by label)
      ],
    });
    const labels = ctx.options.map((o) => o.value);
    expect(labels).toContain("Karton");
    /* "pack" dedup'd — multiplier dari purchase (5) menang. */
    expect(ctx.multipliers.get("pack")).toBe(5);
    expect(ctx.multipliers.get("Karton")).toBe(60);
  });

  /* Sesi AE-148 — multiplier-based dedup. Owner case: Beans Houseblend
   * unitBelanja="kg" multiplier 1000 + packConversions=[Packs/1000]. Same
   * multiplier → drop pack-alt supaya picker tidak duplikat. */
  it("dedup pack-alt by same multiplier as purchase", () => {
    const ctx = buildOpnameUnitContext({
      recipeUnit: "g",
      unitBelanja: "kg",
      unitBelanjaPerCogs: 1000,
      packConversions: [
        { unitLabel: "Packs", qtyPerBase: 1000 }, // dedup by multiplier
        { unitLabel: "Karton", qtyPerBase: 5000 }, // beda multiplier, kept
      ],
    });
    const packAltOptions = ctx.options.filter((o) => o.source === "pack-alt");
    expect(packAltOptions).toHaveLength(1);
    expect(packAltOptions[0].value).toBe("Karton");
  });

  /* Sesi AE-148 — dedup case-insensitive + plural variant. */
  it("dedup pack vs Packs vs PACK (case + plural)", () => {
    const ctx = buildOpnameUnitContext({
      recipeUnit: "g",
      unitBelanja: "kg",
      unitBelanjaPerCogs: 1000,
      packConversions: [
        { unitLabel: "Packs", qtyPerBase: 1000 }, // plural+case variant of pack
        { unitLabel: "PACK", qtyPerBase: 1000 }, // case variant
        { unitLabel: "pack", qtyPerBase: 500 },
      ],
    });
    /* Hanya 1 entry "pack/Pack/Packs/PACK" should survive — first wins. */
    const packVariants = ctx.options.filter((o) =>
      ["pack", "packs", "Pack", "PACK", "Packs"].includes(o.value),
    );
    expect(packVariants.length).toBe(1);
  });

  it("normalizeUnitLabel kasus umum + canonical SI", () => {
    /* Plural + case: pack family. */
    expect(normalizeUnitLabel("pack")).toBe("pack");
    expect(normalizeUnitLabel("Pack")).toBe("pack");
    expect(normalizeUnitLabel("PACKS")).toBe("pack");
    expect(normalizeUnitLabel(" Packs ")).toBe("pack");
    /* Canonical SI volume — preserve uppercase L. */
    expect(normalizeUnitLabel("L")).toBe("L");
    expect(normalizeUnitLabel("l")).toBe("L");
    expect(normalizeUnitLabel("Liter")).toBe("L");
    expect(normalizeUnitLabel("liter")).toBe("L");
    /* Canonical mass + count. */
    expect(normalizeUnitLabel("ml")).toBe("ml");
    expect(normalizeUnitLabel("ML")).toBe("ml");
    expect(normalizeUnitLabel("kg")).toBe("kg");
    expect(normalizeUnitLabel("Kg")).toBe("kg");
    /* "gr"/"gram" alias → canonical "g". */
    expect(normalizeUnitLabel("gr")).toBe("g");
    expect(normalizeUnitLabel("gram")).toBe("g");
    expect(normalizeUnitLabel("g")).toBe("g");
    /* "Pcs"/"pc" → canonical "pcs". */
    expect(normalizeUnitLabel("Pcs")).toBe("pcs");
    expect(normalizeUnitLabel("pc")).toBe("pcs");
    /* 3-char non-canonical preserved. */
    expect(normalizeUnitLabel("gas")).toBe("gas");
    expect(normalizeUnitLabel("set")).toBe("set");
    /* 4+ char custom: lowercase + strip s. */
    expect(normalizeUnitLabel("kalengs")).toBe("kaleng");
    expect(normalizeUnitLabel("Kaleng")).toBe("kaleng");
  });
});

describe("computeOpnameQtyFromSplit", () => {
  const ctxYakult = buildOpnameUnitContext({
    recipeUnit: "pcs",
    unitBelanja: "pack",
    unitBelanjaPerCogs: 5,
  });

  it("3 pack + 2 pcs = 17 pcs", () => {
    const r = computeOpnameQtyFromSplit({
      primaryQty: 3,
      primaryUnit: "pack",
      looseQtyRecipe: 2,
      context: ctxYakult,
    });
    expect(r).toBe(17);
  });

  it("primary only (3 pack) = 15 pcs", () => {
    const r = computeOpnameQtyFromSplit({
      primaryQty: 3,
      primaryUnit: "pack",
      looseQtyRecipe: null,
      context: ctxYakult,
    });
    expect(r).toBe(15);
  });

  it("loose only (7 pcs) = 7 pcs", () => {
    const r = computeOpnameQtyFromSplit({
      primaryQty: null,
      primaryUnit: "pack",
      looseQtyRecipe: 7,
      context: ctxYakult,
    });
    expect(r).toBe(7);
  });

  it("both null → null (uncounted)", () => {
    const r = computeOpnameQtyFromSplit({
      primaryQty: null,
      primaryUnit: "pack",
      looseQtyRecipe: null,
      context: ctxYakult,
    });
    expect(r).toBeNull();
  });

  it("decimal kg input: 1.5 kg → 1500 g", () => {
    const ctxBeans = buildOpnameUnitContext({
      recipeUnit: "g",
      unitBelanja: "kg",
      unitBelanjaPerCogs: 1000,
    });
    const r = computeOpnameQtyFromSplit({
      primaryQty: 1.5,
      primaryUnit: "kg",
      looseQtyRecipe: null,
      context: ctxBeans,
    });
    expect(r).toBe(1500);
  });

  it("unknown unit → null", () => {
    const r = computeOpnameQtyFromSplit({
      primaryQty: 3,
      primaryUnit: "wat",
      looseQtyRecipe: null,
      context: ctxYakult,
    });
    expect(r).toBeNull();
  });
});
