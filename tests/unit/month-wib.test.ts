import { describe, expect, it } from "vitest";
import {
  currentMonthWib,
  isFutureMonth,
  isValidMonth,
  monthRange,
  shiftMonth,
} from "@/lib/month-wib";

describe("currentMonthWib", () => {
  it("memakai kalender WIB, bukan UTC", () => {
    // 31 Agustus 2026 pukul 18:00 UTC = 1 September 2026 pukul 01:00 WIB.
    // Kalau dihitung pakai UTC, owner masih melihat Agustus padahal di
    // Jakarta sudah berganti bulan.
    expect(currentMonthWib(new Date("2026-08-31T18:00:00Z"))).toBe("2026-09");
    expect(currentMonthWib(new Date("2026-08-31T16:00:00Z"))).toBe("2026-08");
  });
});

describe("shiftMonth", () => {
  it("mundur & maju dalam tahun yang sama", () => {
    expect(shiftMonth("2026-09", -1)).toBe("2026-08");
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    expect(shiftMonth("2026-09", -3)).toBe("2026-06");
  });

  it("lintas tahun", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-06", -12)).toBe("2025-06");
  });

  it("bulan tidak valid dikembalikan apa adanya", () => {
    expect(shiftMonth("ngawur", -1)).toBe("ngawur");
    expect(shiftMonth("2026-13", -1)).toBe("2026-13");
  });
});

describe("monthRange", () => {
  it("bulan 31 hari", () => {
    expect(monthRange("2026-08")).toEqual({
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      label: "Agustus 2026",
    });
  });

  it("bulan 30 hari", () => {
    expect(monthRange("2026-09").toDate).toBe("2026-09-30");
  });

  it("Februari biasa vs kabisat", () => {
    expect(monthRange("2026-02").toDate).toBe("2026-02-28");
    expect(monthRange("2028-02").toDate).toBe("2028-02-29");
  });

  it("label Bahasa Indonesia", () => {
    expect(monthRange("2026-01").label).toBe("Januari 2026");
    expect(monthRange("2026-12").label).toBe("Desember 2026");
  });
});

describe("isFutureMonth", () => {
  it("menolak bulan di depan", () => {
    expect(isFutureMonth("2026-10", "2026-09")).toBe(true);
    expect(isFutureMonth("2027-01", "2026-12")).toBe(true);
  });

  it("bulan berjalan & lampau boleh", () => {
    expect(isFutureMonth("2026-09", "2026-09")).toBe(false);
    expect(isFutureMonth("2026-08", "2026-09")).toBe(false);
  });
});

describe("isValidMonth", () => {
  it("hanya menerima YYYY-MM yang masuk akal", () => {
    expect(isValidMonth("2026-09")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-9")).toBe(false);
    expect(isValidMonth("2026-09-01")).toBe(false);
  });
});
