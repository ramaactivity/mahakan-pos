import { describe, expect, it } from "vitest";
import { computePrLineDefault } from "@/features/admin/sections/inventory/purchases/purchase-line-helpers";

/**
 * Sesi AE-173 — default baris "Tarik ke Pembelian" dari PR.
 *
 * Bug yang diperbaiki: PR di-rekam staff dalam satuan COGS (gram), tapi owner
 * belanja + ngisi harga dalam satuan belanja (Kg). Default lama: unit=gram,
 * harga=per-kg → qty(gram) × harga(per-kg) = total meledak (5.726 g × Rp
 * 50.000 = Rp 286 juta). Default baru: konversi ke satuan belanja.
 */
describe("computePrLineDefault", () => {
  it("ingredient dgn tier belanja (Kg=1000 g): default ke Kg + konversi qty + scale harga", () => {
    // Ayam Fillet: PR minta 5726 g, master cost 50 Rp/g, belanja 1 Kg = 1000 g.
    const d = computePrLineDefault({
      outstandingQty: 5726,
      costPerUnit: 50,
      suggestedUnitCost: 50_000,
      masterUnit: "g",
      prUnit: "g",
      belanjaUnit: "Kg",
      belanjaPerCogs: 1000,
    });
    expect(d.unit).toBe("Kg");
    expect(d.qty).toBeCloseTo(5.726, 6);
    expect(d.unitCost).toBe(50_000); // 50 Rp/g × 1000 = 50.000 Rp/Kg
    // total = 5.726 Kg × 50.000 = 286.300 (bukan 286.300.000)
    expect(Math.round(d.qty * d.unitCost)).toBe(286_300);
  });

  it("tanpa tier belanja: pakai satuan COGS apa adanya (perilaku lama, tetap benar)", () => {
    const d = computePrLineDefault({
      outstandingQty: 5726,
      costPerUnit: 50,
      suggestedUnitCost: 50_000,
      masterUnit: "g",
      prUnit: "g",
      belanjaUnit: null,
      belanjaPerCogs: null,
    });
    expect(d.unit).toBe("g");
    expect(d.qty).toBe(5726);
    expect(d.unitCost).toBe(50); // master cost per gram dipakai, BUKAN supplier 50rb
    expect(Math.round(d.qty * d.unitCost)).toBe(286_300);
  });

  it("satuan COGS = satuan belanja (pcs): tak ada konversi", () => {
    // Sosis: 32 pcs, cost 28.000/pcs, tak ada tier belanja.
    const d = computePrLineDefault({
      outstandingQty: 32,
      costPerUnit: 28_000,
      suggestedUnitCost: 28_000,
      masterUnit: "pcs",
      prUnit: "pcs",
      belanjaUnit: null,
      belanjaPerCogs: null,
    });
    expect(d.unit).toBe("pcs");
    expect(d.qty).toBe(32);
    expect(d.unitCost).toBe(28_000);
    expect(Math.round(d.qty * d.unitCost)).toBe(896_000);
  });

  it("master cost 0: fallback ke suggested supplier cost", () => {
    const d = computePrLineDefault({
      outstandingQty: 5726,
      costPerUnit: 0,
      suggestedUnitCost: 50_000,
      masterUnit: "g",
      prUnit: "g",
      belanjaUnit: "Kg",
      belanjaPerCogs: 1000,
    });
    expect(d.unit).toBe("Kg");
    expect(d.qty).toBeCloseTo(5.726, 6);
    expect(d.unitCost).toBe(50_000);
  });

  it("master cost 0 + suggested null: unitCost 0 (owner isi manual)", () => {
    const d = computePrLineDefault({
      outstandingQty: 100,
      costPerUnit: 0,
      suggestedUnitCost: null,
      masterUnit: "g",
      prUnit: "g",
      belanjaUnit: "Kg",
      belanjaPerCogs: 1000,
    });
    expect(d.unitCost).toBe(0);
    expect(d.qty).toBeCloseTo(0.1, 6);
  });

  it("perCogs invalid (0 / negatif / NaN): tier belanja diabaikan", () => {
    for (const bad of [0, -5, NaN]) {
      const d = computePrLineDefault({
        outstandingQty: 500,
        costPerUnit: 20,
        suggestedUnitCost: null,
        masterUnit: "g",
        prUnit: "g",
        belanjaUnit: "Kg",
        belanjaPerCogs: bad,
      });
      expect(d.unit).toBe("g");
      expect(d.qty).toBe(500);
      expect(d.unitCost).toBe(20);
    }
  });

  it("belanjaUnit null tapi perCogs ada: tetap diabaikan (butuh dua-duanya)", () => {
    const d = computePrLineDefault({
      outstandingQty: 500,
      costPerUnit: 20,
      suggestedUnitCost: null,
      masterUnit: "g",
      prUnit: "g",
      belanjaUnit: null,
      belanjaPerCogs: 1000,
    });
    expect(d.unit).toBe("g");
    expect(d.qty).toBe(500);
  });

  it("prUnit kosong: fallback ke masterUnit", () => {
    const d = computePrLineDefault({
      outstandingQty: 10,
      costPerUnit: 100,
      suggestedUnitCost: null,
      masterUnit: "L",
      prUnit: "",
      belanjaUnit: null,
      belanjaPerCogs: null,
    });
    expect(d.unit).toBe("L");
  });
});
