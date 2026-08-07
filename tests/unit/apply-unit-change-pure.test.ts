import { describe, expect, it } from "vitest";
import {
  applyQtyChange,
  applyTotalChange,
  applyUnitChange,
  applyUnitCostChange,
  type SmartMathRow,
} from "@/features/admin/sections/inventory/purchases/purchase-line-helpers";

/**
 * Sesi AE-173 — ganti satuan di form pembelian harus konversi QTY (bukan cuma
 * harga). Dulu: 5.726 Kg → ganti ke gr → qty tetap 5.726 → total Rp 326 (salah,
 * harusnya Rp 326.382). Sekarang qty ikut ×1000 + harga ÷1000 → total invariant.
 */
function row(o: Partial<SmartMathRow>): SmartMathRow {
  return {
    qty: o.qty ?? "5.726",
    unitCost: o.unitCost ?? "57000",
    total: o.total ?? "326382",
    inputMode: o.inputMode ?? "unit",
  };
}

describe("applyUnitChange", () => {
  it("Kg → gr (mode unit): qty ×1000, harga ÷1000, total tetap", () => {
    const r = applyUnitChange(row({}), "Kg", "gr");
    expect(r.qty).toBe("5726");
    expect(r.unitCost).toBe("57");
    expect(Number(r.total)).toBe(326382);
  });

  it("gr → Kg (mode unit): qty ÷1000, harga ×1000, total tetap", () => {
    const r = applyUnitChange(
      row({ qty: "5726", unitCost: "57", total: "326382" }),
      "gr",
      "Kg",
    );
    expect(r.qty).toBe("5.726");
    expect(r.unitCost).toBe("57000");
    expect(Number(r.total)).toBe(326382);
  });

  it("case-insensitive: 'kg' → 'gr' tetap konversi", () => {
    const r = applyUnitChange(row({}), "kg", "gr");
    expect(r.qty).toBe("5726");
    expect(r.unitCost).toBe("57");
  });

  it("mode total: total dikunci, harga = total ÷ qty-baru", () => {
    const r = applyUnitChange(
      row({ qty: "5.726", total: "326382", inputMode: "total" }),
      "Kg",
      "gr",
    );
    expect(r.qty).toBe("5726");
    expect(Number(r.total)).toBe(326382);
    expect(r.unitCost).toBe("57"); // 326382 / 5726 ≈ 57
  });

  it("beda dimensi / label custom (convertQty null): qty dibiarkan", () => {
    // Kg → botol tak bisa dikonversi → qty tetap.
    const r = applyUnitChange(row({ qty: "5.726" }), "Kg", "botol");
    expect(r.qty).toBe("5.726");
  });

  it("L → ml: qty ×1000", () => {
    const r = applyUnitChange(
      row({ qty: "2", unitCost: "12000", total: "24000" }),
      "L",
      "ml",
    );
    expect(r.qty).toBe("2000");
    expect(r.unitCost).toBe("12");
    expect(Number(r.total)).toBe(24000);
  });

  it("qty kosong/invalid: tak crash, label tetap ganti", () => {
    const r = applyUnitChange(row({ qty: "" }), "Kg", "gr");
    expect(r.qty).toBe("");
  });
});

/**
 * Sesi AE-188 — regresi: helper smart-math TIDAK boleh menyalin balik field
 * asing dari objek yang dioper.
 *
 * Bug yang dicegah: pemanggil lazim mengoper baris form utuh lalu menulis
 * `{...r, unit: baru, ...hasilHelper}`. Kalau helper mengembalikan `{...row}`,
 * `unit` LAMA ikut terbawa dan menimpa yang baru — ganti Kg→gr mengonversi
 * qty 5→5000 dan harga 50.000→50 tapi satuannya tersimpan Kg. Salah 1000×,
 * tanpa gejala di layar. Kontraknya: hanya 4 bidang smart-math yang keluar.
 */
describe("kontrak helper smart-math (anti field bocor)", () => {
  const KEYS = ["qty", "unitCost", "total", "inputMode"].sort();
  const kotor = {
    ...row({}),
    unit: "Kg",
    id: "baris-1",
    ingredientId: "bahan-1",
  } as unknown as SmartMathRow;

  it("applyUnitChange hanya mengembalikan 4 bidang", () => {
    expect(Object.keys(applyUnitChange(kotor, "Kg", "gr")).sort()).toEqual(KEYS);
  });

  it("applyQtyChange hanya mengembalikan 4 bidang", () => {
    expect(Object.keys(applyQtyChange(kotor, "2")).sort()).toEqual(KEYS);
    /* Cabang qty tidak valid punya jalur return sendiri — ikut dijaga. */
    expect(Object.keys(applyQtyChange(kotor, "")).sort()).toEqual(KEYS);
  });

  it("applyUnitCostChange hanya mengembalikan 4 bidang", () => {
    expect(Object.keys(applyUnitCostChange(kotor, "1000")).sort()).toEqual(KEYS);
  });

  it("applyTotalChange hanya mengembalikan 4 bidang", () => {
    expect(Object.keys(applyTotalChange(kotor, "10000")).sort()).toEqual(KEYS);
  });

  it("pola pemakaian di modal: satuan baru tidak tertimpa yang lama", () => {
    const baris = { ...kotor, unit: "Kg" };
    const hasil = {
      ...baris,
      ...applyUnitChange(baris, baris.unit as string, "gr"),
      unit: "gr",
    };
    expect(hasil.unit).toBe("gr");
    expect(hasil.qty).toBe("5726");
  });
});
