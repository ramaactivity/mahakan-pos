import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDaysJakarta,
  jakartaDateOf,
  monthEndJakarta,
  monthStartJakarta,
  todayJakarta,
} from "@/lib/tz";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Sesi AE-191 — jam rawan 00:00–06:59 WIB.
 *
 * Di jendela ini UTC masih hari kemarin. Ini yang bikin jurnal mendarat di
 * tanggal salah lalu "hilang" dari filter tanggal hari ini.
 */
describe("jakartaDateOf — jam rawan 00:00–06:59 WIB", () => {
  it("00:30 WIB tetap hari yang sama, bukan mundur ke kemarin", () => {
    const d = new Date("2026-08-07T00:30:00+07:00");
    expect(jakartaDateOf(d)).toBe("2026-08-07");
    // Bukti pola lama memang salah:
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-06");
  });

  it("06:59 WIB — batas terakhir jendela rawan", () => {
    expect(jakartaDateOf(new Date("2026-08-07T06:59:59+07:00"))).toBe(
      "2026-08-07",
    );
  });

  it("07:00 WIB — di luar jendela rawan, dua-duanya sama", () => {
    const d = new Date("2026-08-07T07:00:00+07:00");
    expect(jakartaDateOf(d)).toBe("2026-08-07");
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-07");
  });

  it("pergantian BULAN: 1 Sep 02:00 WIB tidak mundur ke Agustus", () => {
    const d = new Date("2026-09-01T02:00:00+07:00");
    expect(jakartaDateOf(d)).toBe("2026-09-01");
    // Pola lama melempar jurnal ke periode akuntansi bulan sebelumnya:
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  it("pergantian TAHUN: 1 Jan 03:00 WIB tetap tahun baru", () => {
    expect(jakartaDateOf(new Date("2027-01-01T03:00:00+07:00"))).toBe(
      "2027-01-01",
    );
  });

  it("23:59 WIB masih hari itu", () => {
    expect(jakartaDateOf(new Date("2026-08-07T23:59:00+07:00"))).toBe(
      "2026-08-07",
    );
  });
});

describe("todayJakarta", () => {
  it("memakai kalender WIB walau jam mesin UTC", () => {
    vi.useFakeTimers();
    // 2026-08-06 19:00 UTC = 2026-08-07 02:00 WIB
    vi.setSystemTime(new Date("2026-08-06T19:00:00Z"));
    expect(todayJakarta()).toBe("2026-08-07");
  });
});

describe("addDaysJakarta", () => {
  it("mundur beberapa hari — dipakai chip '7 hari' (inklusif hari ini)", () => {
    expect(addDaysJakarta("2026-08-07", -6)).toBe("2026-08-01");
  });
  it("melintasi awal bulan", () => {
    expect(addDaysJakarta("2026-08-02", -3)).toBe("2026-07-30");
  });
  it("melintasi tahun kabisat", () => {
    expect(addDaysJakarta("2028-03-01", -1)).toBe("2028-02-29");
  });
  it("maju", () => {
    expect(addDaysJakarta("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("nol hari = tetap", () => {
    expect(addDaysJakarta("2026-08-07", 0)).toBe("2026-08-07");
  });
});

describe("monthStartJakarta / monthEndJakarta", () => {
  it("awal bulan", () => {
    expect(monthStartJakarta("2026-08-07")).toBe("2026-08-01");
  });
  it("akhir bulan 31 hari", () => {
    expect(monthEndJakarta("2026-08-07")).toBe("2026-08-31");
  });
  it("akhir bulan 30 hari", () => {
    expect(monthEndJakarta("2026-09-15")).toBe("2026-09-30");
  });
  it("Februari tahun biasa", () => {
    expect(monthEndJakarta("2026-02-10")).toBe("2026-02-28");
  });
  it("Februari tahun kabisat", () => {
    expect(monthEndJakarta("2028-02-10")).toBe("2028-02-29");
  });
  it("Desember tidak bocor ke tahun berikutnya", () => {
    expect(monthEndJakarta("2026-12-01")).toBe("2026-12-31");
  });
});

/**
 * Regresi langsung dari keluhan owner: chip filter tanggal di halaman Jurnal
 * memakai UTC, jadi kalau dibuka lewat tengah malam WIB batas `to`-nya masih
 * kemarin — jurnal hari itu tidak muncul sama sekali.
 */
describe("regresi: rentang filter Jurnal (chip tanggal)", () => {
  it("chip 'Hari ini' lewat tengah malam WIB mencakup hari itu sendiri", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T19:00:00Z")); // 02:00 WIB, 7 Agu
    const today = todayJakarta();
    const range = { from: addDaysJakarta(today, 0), to: today };
    expect(range).toEqual({ from: "2026-08-07", to: "2026-08-07" });
  });

  it("chip 'Bulan ini' mulai tanggal 1, bukan tanggal 31 bulan sebelumnya", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T19:00:00Z"));
    const today = todayJakarta();
    expect(monthStartJakarta(today)).toBe("2026-08-01");
  });
});
