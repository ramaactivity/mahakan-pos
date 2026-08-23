import { describe, expect, it } from "vitest";
import {
  accumulatedDepreciationThrough,
  addMonthsIso,
  monthlyDepreciationFor,
  monthsBetweenIso,
  pendingDepreciationMonths,
  type DepreciationSchedule,
} from "@/features/accounting/fixed-asset-schedule";

/**
 * Sesi AE-214 — yang dijaga tes ini:
 *
 *   1. Aset yang TIDAK pernah dinilai ulang harus menghasilkan angka yang
 *      persis sama dengan rumus lama. Fitur baru tidak boleh menggeser
 *      penyusutan aset yang sudah berjalan.
 *   2. Aset yang sudah dinilai ulang disusutkan dari NILAI BARU dibagi SISA
 *      umur — bukan dari harga perolehan.
 *   3. Bulan sebelum basis tidak pernah dihitung ulang.
 */

const LEGACY: DepreciationSchedule = {
  acquiredDate: "2026-01-10",
  cost: 12_000_000,
  salvageValue: 0,
  usefulLifeMonths: 24,
  basisAmount: null,
  basisMonth: null,
  basisAccumulated: 0,
  basisRemainingMonths: null,
};

describe("helper tanggal", () => {
  it("menghitung selisih bulan lintas tahun", () => {
    expect(monthsBetweenIso("2026-01-01", "2026-01-01")).toBe(0);
    expect(monthsBetweenIso("2026-01-01", "2026-08-01")).toBe(7);
    expect(monthsBetweenIso("2025-11-01", "2026-02-01")).toBe(3);
  });

  it("menambah bulan lintas tahun", () => {
    expect(addMonthsIso("2026-08-01", 1)).toBe("2026-09-01");
    expect(addMonthsIso("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonthsIso("2026-01-01", -1)).toBe("2025-12-01");
  });
});

describe("aset tanpa penilaian ulang — perilaku lama harus utuh", () => {
  it("penyusutan bulanan = cost / umur", () => {
    expect(monthlyDepreciationFor(LEGACY, "2026-01-01")).toBe(500_000);
    expect(monthlyDepreciationFor(LEGACY, "2026-08-01")).toBe(500_000);
  });

  it("berhenti setelah umur manfaat habis", () => {
    expect(monthlyDepreciationFor(LEGACY, "2027-12-01")).toBe(500_000); // bulan ke-24
    expect(monthlyDepreciationFor(LEGACY, "2028-01-01")).toBe(0); // bulan ke-25
  });

  it("akumulasi = jumlah bulan yang sudah diposting", () => {
    expect(accumulatedDepreciationThrough(LEGACY, null)).toBe(0);
    expect(accumulatedDepreciationThrough(LEGACY, "2026-03-01")).toBe(1_500_000);
    expect(accumulatedDepreciationThrough(LEGACY, "2027-12-01")).toBe(12_000_000);
  });
});

describe("aset yang sudah dinilai ulang", () => {
  /* Nilai tercatat jadi Rp 8.000.000 mulai September 2026, sisa umur 16 bulan.
   * Akumulasi sebelum basis dibekukan Rp 4.000.000 (jalur penurunan nilai). */
  const REVALUED: DepreciationSchedule = {
    ...LEGACY,
    basisAmount: 8_000_000,
    basisMonth: "2026-09-01",
    basisAccumulated: 4_000_000,
    basisRemainingMonths: 16,
  };

  it("penyusutan memakai nilai baru dibagi SISA umur", () => {
    expect(monthlyDepreciationFor(REVALUED, "2026-09-01")).toBe(500_000);
    expect(monthlyDepreciationFor(REVALUED, "2027-01-01")).toBe(500_000);
  });

  it("bulan SEBELUM basis tidak dihitung ulang (0, bukan rumus lama)", () => {
    expect(monthlyDepreciationFor(REVALUED, "2026-08-01")).toBe(0);
    expect(monthlyDepreciationFor(REVALUED, "2026-01-01")).toBe(0);
  });

  it("berhenti setelah sisa umur habis", () => {
    /* basis 16 bulan dari Sep 2026 → bulan ke-16 = Des 2027. */
    expect(monthlyDepreciationFor(REVALUED, "2027-12-01")).toBe(500_000);
    expect(monthlyDepreciationFor(REVALUED, "2028-01-01")).toBe(0);
  });

  it("akumulasi = beku sebelum basis + yang berjalan sesudahnya", () => {
    expect(accumulatedDepreciationThrough(REVALUED, "2026-08-01")).toBe(
      4_000_000,
    );
    expect(accumulatedDepreciationThrough(REVALUED, "2026-10-01")).toBe(
      4_000_000 + 1_000_000,
    );
    expect(accumulatedDepreciationThrough(REVALUED, null)).toBe(4_000_000);
  });

  it("revaluasi (akumulasi dieliminasi) mulai dari nol", () => {
    const eliminated: DepreciationSchedule = {
      ...REVALUED,
      basisAccumulated: 0,
    };
    expect(accumulatedDepreciationThrough(eliminated, "2026-10-01")).toBe(
      1_000_000,
    );
  });

  it("nilai baru di bawah nilai sisa = berhenti disusutkan", () => {
    const belowSalvage: DepreciationSchedule = {
      ...REVALUED,
      salvageValue: 9_000_000,
    };
    expect(monthlyDepreciationFor(belowSalvage, "2026-09-01")).toBe(0);
  });
});

describe("pendingDepreciationMonths — rem penilaian ulang", () => {
  it("mendaftar bulan yang belum diposting sampai bulan efektif", () => {
    const pending = pendingDepreciationMonths(LEGACY, "2026-04-01", "2026-01-01");
    expect(pending).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("kosong kalau penyusutan sudah sampai bulan efektif", () => {
    expect(pendingDepreciationMonths(LEGACY, "2026-04-01", "2026-04-01")).toEqual(
      [],
    );
    expect(pendingDepreciationMonths(LEGACY, "2026-04-01", "2026-05-01")).toEqual(
      [],
    );
  });

  it("aset yang belum pernah disusutkan dihitung dari bulan perolehan", () => {
    expect(pendingDepreciationMonths(LEGACY, "2026-02-01", null)).toEqual([
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("tidak menuntut bulan di luar umur manfaat", () => {
    /* Umur habis Des 2027; minta sampai Mar 2028 → hanya sampai Des 2027. */
    const pending = pendingDepreciationMonths(LEGACY, "2028-03-01", "2027-10-01");
    expect(pending).toEqual(["2027-11-01", "2027-12-01"]);
  });
});
