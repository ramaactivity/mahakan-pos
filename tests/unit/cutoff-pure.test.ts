import { describe, expect, it } from "vitest";
import {
  CUTOFF_OFF,
  clampFromDate,
  cutoffStartInstant,
  isPeriodAtOrAfterCutoff,
  parseBooksCutoff,
} from "@/features/cutoff/cutoff-pure";

/**
 * Sesi AE-207 — BATAS BUKU. Yang dijaga tes ini:
 *  1. Setelan rusak/separuh JANGAN pernah menyembunyikan data (fail-open).
 *  2. Laporan kumulatif (Neraca, `from=null`) HARUS ke-floor — ini inti
 *     "saldo bersih periode baru".
 *  3. Batas instant memakai tengah malam WIB, bukan UTC.
 */
describe("parseBooksCutoff — fail-open", () => {
  it("mengembalikan OFF untuk nilai yang bukan objek", () => {
    for (const bad of [null, undefined, "2026-07-01", 42, []]) {
      expect(parseBooksCutoff(bad)).toEqual(CUTOFF_OFF);
    }
  });

  it("mengembalikan OFF kalau `date` tidak ada atau formatnya salah", () => {
    expect(parseBooksCutoff({ opnameDate: "2026-06-01" })).toEqual(CUTOFF_OFF);
    expect(parseBooksCutoff({ date: "1 Juli 2026" })).toEqual(CUTOFF_OFF);
    expect(parseBooksCutoff({ date: "2026-7-1" })).toEqual(CUTOFF_OFF);
    expect(parseBooksCutoff({ date: null })).toEqual(CUTOFF_OFF);
  });

  it("opnameDate jatuh kembali ke date kalau kosong / tidak valid", () => {
    expect(parseBooksCutoff({ date: "2026-07-01" }).opnameDate).toBe(
      "2026-07-01",
    );
    expect(
      parseBooksCutoff({ date: "2026-07-01", opnameDate: "bukan tanggal" })
        .opnameDate,
    ).toBe("2026-07-01");
  });

  it("mempertahankan opnameDate yang lebih tua — sesi stok awal wajib tampil", () => {
    const c = parseBooksCutoff({
      date: "2026-07-01",
      opnameDate: "2026-06-01",
      note: "mulai bersih Juli",
      setAt: "2026-08-17T10:00:00.000Z",
    });
    expect(c.date).toBe("2026-07-01");
    expect(c.opnameDate).toBe("2026-06-01");
    expect(c.note).toBe("mulai bersih Juli");
    expect(c.setAt).toBe("2026-08-17T10:00:00.000Z");
  });
});

describe("clampFromDate", () => {
  it("cutoff mati → rentang asli tidak diubah", () => {
    expect(clampFromDate("2026-03-01", null)).toBe("2026-03-01");
    expect(clampFromDate(null, null)).toBeNull();
    expect(clampFromDate(undefined, null)).toBeNull();
  });

  it("laporan kumulatif (from=null) jadi mulai dari batas buku", () => {
    // Ini yang bikin Neraca berhenti menjumlah sejak Maret.
    expect(clampFromDate(null, "2026-07-01")).toBe("2026-07-01");
    expect(clampFromDate(undefined, "2026-07-01")).toBe("2026-07-01");
  });

  it("rentang yang lebih tua dinaikkan ke batas buku", () => {
    expect(clampFromDate("2026-03-13", "2026-07-01")).toBe("2026-07-01");
    expect(clampFromDate("2026-06-30", "2026-07-01")).toBe("2026-07-01");
  });

  it("rentang di dalam periode aktif dibiarkan apa adanya", () => {
    expect(clampFromDate("2026-07-01", "2026-07-01")).toBe("2026-07-01");
    expect(clampFromDate("2026-08-01", "2026-07-01")).toBe("2026-08-01");
  });
});

describe("cutoffStartInstant", () => {
  it("null kalau cutoff mati", () => {
    expect(cutoffStartInstant(null)).toBeNull();
  });

  it("tengah malam WIB = 17:00 UTC hari sebelumnya", () => {
    // Kalau ini kepakai `new Date("2026-07-01")` (UTC midnight), mutasi
    // 1 Juli 00:00–06:59 WIB akan ke-filter keluar dari daftar.
    expect(cutoffStartInstant("2026-07-01")?.toISOString()).toBe(
      "2026-06-30T17:00:00.000Z",
    );
  });

  it("mutasi 1 Juli 00:30 WIB lolos, 30 Juni 23:30 WIB tidak", () => {
    const floor = cutoffStartInstant("2026-07-01")!;
    expect(new Date("2026-07-01T00:30:00+07:00") >= floor).toBe(true);
    expect(new Date("2026-06-30T23:30:00+07:00") >= floor).toBe(false);
  });
});

describe("isPeriodAtOrAfterCutoff", () => {
  it("cutoff mati → semua periode lolos", () => {
    expect(isPeriodAtOrAfterCutoff(2026, 3, null)).toBe(true);
  });

  it("bulan sebelum batas ditolak, bulan batas & sesudahnya lolos", () => {
    expect(isPeriodAtOrAfterCutoff(2026, 6, "2026-07-01")).toBe(false);
    expect(isPeriodAtOrAfterCutoff(2026, 7, "2026-07-01")).toBe(true);
    expect(isPeriodAtOrAfterCutoff(2026, 8, "2026-07-01")).toBe(true);
  });

  it("lintas tahun dibandingkan benar (bukan bulan mentah)", () => {
    expect(isPeriodAtOrAfterCutoff(2025, 12, "2026-01-01")).toBe(false);
    expect(isPeriodAtOrAfterCutoff(2027, 1, "2026-07-01")).toBe(true);
  });
});
