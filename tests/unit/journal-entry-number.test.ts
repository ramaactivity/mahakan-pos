import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({}));

const { formatJournalEntryNumber, isDifferentPeriod, journalSeqLockKey } =
  await import("@/features/accounting/posting");

/**
 * Sesi AE-185 — nomor jurnal memuat periodenya (JE-YYYYMM-NNNN). Sejak tanggal
 * jurnal bisa dikoreksi tanpa reverse, entry yang pindah bulan HARUS
 * diterbitkan ulang nomornya — kalau tidak, nomornya berbohong soal periode.
 * Format + kunci antrean dipakai bersama oleh recordJournal dan
 * updateJournalEntryDate, jadi keduanya diuji di sini.
 */
describe("formatJournalEntryNumber", () => {
  it("bulan dan urutan dipadkan (JE-YYYYMM-NNNN)", () => {
    expect(formatJournalEntryNumber(2026, 7, 1)).toBe("JE-202607-0001");
    expect(formatJournalEntryNumber(2026, 12, 42)).toBe("JE-202612-0042");
  });

  it("bulan satu digit tetap dua digit", () => {
    expect(formatJournalEntryNumber(2026, 1, 7)).toBe("JE-202601-0007");
    expect(formatJournalEntryNumber(2026, 9, 100)).toBe("JE-202609-0100");
  });

  it("urutan lebih dari 4 digit tidak dipotong", () => {
    expect(formatJournalEntryNumber(2026, 7, 12345)).toBe("JE-202607-12345");
  });
});

describe("isDifferentPeriod", () => {
  it("beda bulan → true (nomor harus diterbitkan ulang)", () => {
    expect(isDifferentPeriod("2026-07-31", "2026-08-01")).toBe(true);
    expect(isDifferentPeriod("2026-12-31", "2027-01-01")).toBe(true);
  });

  it("bulan sama → false (nomor dipertahankan)", () => {
    expect(isDifferentPeriod("2026-07-01", "2026-07-31")).toBe(false);
    expect(isDifferentPeriod("2026-07-15", "2026-07-15")).toBe(false);
  });

  it("beda tahun bulan sama tetap dihitung beda periode", () => {
    expect(isDifferentPeriod("2025-07-10", "2026-07-10")).toBe(true);
  });
});

describe("journalSeqLockKey", () => {
  it("kunci unik per outlet + periode", () => {
    expect(journalSeqLockKey("out-1", 2026, 7)).toBe("je-seq-out-1-2026-07");
    /* Outlet beda tidak boleh saling mengunci. */
    expect(journalSeqLockKey("out-2", 2026, 7)).not.toBe(
      journalSeqLockKey("out-1", 2026, 7),
    );
    /* Periode beda di outlet sama juga tidak boleh saling mengunci. */
    expect(journalSeqLockKey("out-1", 2026, 8)).not.toBe(
      journalSeqLockKey("out-1", 2026, 7),
    );
  });

  it("bulan dipadkan supaya kunci Juli tidak bentrok dengan Juli tahun lain", () => {
    expect(journalSeqLockKey("out-1", 2026, 1)).toBe("je-seq-out-1-2026-01");
  });
});
