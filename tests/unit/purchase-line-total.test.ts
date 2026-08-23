import { describe, expect, it } from "vitest";
import {
  isLineTotalConsistent,
  lineTotalTolerance,
  resolveLineTotal,
} from "@/features/purchases/line-total";

/**
 * Sesi AE-216 — TOTAL PEMBELIAN DIHITUNG DARI TOTAL BAYAR.
 *
 * Kejadian nyata (nota belanja pasar 20 Agustus 2026, dilaporkan owner):
 * sistem menampilkan Rp 226.880 padahal kolom Total Bayar berjumlah
 * Rp 227.000. Sebabnya total dihitung ulang `qty × harga`, sedangkan harga
 * satuan wajib rupiah BULAT — sisa pembulatannya terbuang tiap baris.
 *
 * Yang dikunci di sini: uang yang dicatat = uang yang benar-benar dibayar.
 */

/** Baris asli dari nota owner. */
const NOTA = [
  { nama: "Bawang Merah", qty: 530, unitCost: 30, totalCost: 16_000 },
  { nama: "Timun", qty: 570, unitCost: 14, totalCost: 8_000 },
  { nama: "Sosis", qty: 1, unitCost: 27_000, totalCost: 27_000 },
  // Tiga baris ini staff mengetik HARGA satuan, totalnya turunan (pas).
  { nama: "Susu Evaporasi FN", qty: 3, unitCost: 19_000, totalCost: 57_000 },
  { nama: "Creamer", qty: 1, unitCost: 42_000, totalCost: 42_000 },
  { nama: "Mentega", qty: 1, unitCost: 32_000, totalCost: 32_000 },
  { nama: "Minyak Goreng", qty: 2, unitCost: 22_500, totalCost: 45_000 },
];

describe("resolveLineTotal — uang baris ikut Total Bayar (AE-216)", () => {
  it("nota owner berjumlah 227.000, BUKAN 226.880 hasil qty × harga", () => {
    const dariTotalBayar = NOTA.reduce((s, r) => s + resolveLineTotal(r), 0);
    const caraLama = NOTA.reduce(
      (s, r) => s + Math.round(r.qty * r.unitCost),
      0,
    );
    expect(dariTotalBayar).toBe(227_000);
    // Angka persis yang dikeluhkan owner — dikunci supaya tidak balik lagi.
    expect(caraLama).toBe(226_880);
  });

  it("baris yang pembagiannya tidak pas tetap utuh nilainya", () => {
    // 530 gr seharga Rp 16.000 → harga bulat Rp 30/gr → 530 × 30 = 15.900.
    expect(resolveLineTotal(NOTA[0])).toBe(16_000);
    expect(Math.round(NOTA[0].qty * NOTA[0].unitCost)).toBe(15_900);
  });

  it("tanpa totalCost (staff mengetik harga satuan) → perilaku LAMA", () => {
    expect(resolveLineTotal({ qty: 3, unitCost: 19_000 })).toBe(57_000);
    expect(resolveLineTotal({ qty: 2, unitCost: 22_500, totalCost: null })).toBe(
      45_000,
    );
  });

  it("totalCost cacat (negatif / bukan angka) jatuh ke qty × harga", () => {
    expect(resolveLineTotal({ qty: 2, unitCost: 100, totalCost: -5 })).toBe(200);
    expect(resolveLineTotal({ qty: 2, unitCost: 100, totalCost: NaN })).toBe(
      200,
    );
  });

  it("totalCost nol yang disengaja (barang gratis) dihormati", () => {
    expect(resolveLineTotal({ qty: 5, unitCost: 0, totalCost: 0 })).toBe(0);
  });
});

describe("isLineTotalConsistent — rem angka nyasar (AE-216)", () => {
  it("semua baris nota owner lolos", () => {
    for (const r of NOTA) {
      expect(isLineTotalConsistent(r), r.nama).toBe(true);
    }
  });

  it("selisih pembulatan yang wajar diterima", () => {
    // qty besar → sisa pembulatan boleh lebih besar (maksimal ~qty/2).
    expect(
      isLineTotalConsistent({ qty: 530, unitCost: 30, totalCost: 16_000 }),
    ).toBe(true);
    expect(lineTotalTolerance(530)).toBe(266);
  });

  it("TOLAK total yang tidak berpasangan — kelebihan satu nol", () => {
    // Staff salah ketik 160.000 untuk 530 gr @ Rp 30.
    expect(
      isLineTotalConsistent({ qty: 530, unitCost: 30, totalCost: 160_000 }),
    ).toBe(false);
  });

  it("TOLAK total negatif", () => {
    expect(
      isLineTotalConsistent({ qty: 1, unitCost: 100, totalCost: -1 }),
    ).toBe(false);
  });

  it("tanpa totalCost selalu lolos (klien lama tidak ikut terblokir)", () => {
    expect(isLineTotalConsistent({ qty: 1, unitCost: 100 })).toBe(true);
    expect(
      isLineTotalConsistent({ qty: 1, unitCost: 100, totalCost: null }),
    ).toBe(true);
  });

  it("qty pecahan tetap punya toleransi minimal 1 rupiah", () => {
    expect(lineTotalTolerance(0.25)).toBe(2);
    expect(
      isLineTotalConsistent({ qty: 0.25, unitCost: 40_000, totalCost: 10_000 }),
    ).toBe(true);
  });
});
