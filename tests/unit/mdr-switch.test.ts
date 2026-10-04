import { describe, expect, it } from "vitest";
import { isAutoMdrEnabled, settlementFee } from "@/features/finance/mdr-pure";

/* Sesi AE-248 — owner mematikan potong MDR otomatis setelah rekonsiliasi
 * dengan m-banking. Yang gampang salah: defaultnya dibalik jadi `!== false`
 * di salah satu dari tiga tempat pembacanya — potongan muncul lagi hanya di
 * jalur itu, tanpa ada yang mengubah pengaturan. */
describe("isAutoMdrEnabled (AE-248)", () => {
  it("belum pernah diset = MATI", () => {
    expect(isAutoMdrEnabled(undefined)).toBe(false);
    expect(isAutoMdrEnabled(null)).toBe(false);
    expect(isAutoMdrEnabled({})).toBe(false);
  });

  it("hanya true yang menyalakan", () => {
    expect(isAutoMdrEnabled({ autoMdrEnabled: true })).toBe(true);
    expect(isAutoMdrEnabled({ autoMdrEnabled: false })).toBe(false);
  });
});

describe("settlementFee (AE-248)", () => {
  it("saklar mati → nol, berapa pun persentasenya", () => {
    expect(
      settlementFee({ autoMdrEnabled: false, pct: 0.7, gross: 1_000_000 }),
    ).toBe(0);
  });

  it("saklar nyala → potongan seperti dulu", () => {
    expect(
      settlementFee({ autoMdrEnabled: true, pct: 0.7, gross: 1_000_000 }),
    ).toBe(7_000);
  });

  it("dibulatkan ke rupiah bulat, bukan dibiarkan pecahan", () => {
    // 413.000 × 0,7% = 2.891 pas; 112.999 × 0,7% = 790,993 → 791
    expect(settlementFee({ autoMdrEnabled: true, pct: 0.7, gross: 413_000 })).toBe(2_891);
    expect(settlementFee({ autoMdrEnabled: true, pct: 0.7, gross: 112_999 })).toBe(791);
  });

  it("rate 0 atau gross 0 tidak menghasilkan potongan minus/NaN", () => {
    expect(settlementFee({ autoMdrEnabled: true, pct: 0, gross: 500_000 })).toBe(0);
    expect(settlementFee({ autoMdrEnabled: true, pct: 0.7, gross: 0 })).toBe(0);
  });
});
