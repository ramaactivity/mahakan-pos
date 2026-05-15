import { describe, it, expect } from "vitest";
import { formatPercent, truncate } from "@/lib/format";
import {
  currentJakartaMonth,
  formatIndonesianDate,
  formatIndonesianDateTime,
  formatIndonesianTime,
  formatTransactionDatePart,
  monthWibRangeUtc,
  toJakartaDate,
  toJakartaDateOnly,
} from "@/lib/date";
import {
  endOfWibDayUtc,
  formatTransactionNumber,
  startOfWibDayUtc,
  todayWibYmd,
} from "@/features/transactions/helpers";
import {
  endOfWibDateUtc,
  startOfWibDateUtc,
  todayWibIso,
} from "@/features/cash/helpers";

describe("format.ts", () => {
  describe("formatPercent", () => {
    it("renders integer percent", () => {
      expect(formatPercent(0)).toBe("0%");
      expect(formatPercent(10)).toBe("10%");
      expect(formatPercent(100)).toBe("100%");
    });

    it("rejects non-integer", () => {
      expect(() => formatPercent(1.5)).toThrow(/expected integer/);
    });
  });

  describe("truncate", () => {
    it("returns input when shorter than max", () => {
      expect(truncate("hi", 5)).toBe("hi");
      expect(truncate("12345", 5)).toBe("12345");
    });

    it("adds ellipsis when longer", () => {
      expect(truncate("123456", 5)).toBe("1234…");
      expect(truncate("Cappuccino Iced", 8)).toBe("Cappucc…");
    });
  });
});

describe("date.ts (WIB UTC+7)", () => {
  // 2026-04-25T07:00:00Z = 2026-04-25 14:00 WIB
  const SAMPLE_UTC = new Date("2026-04-25T07:00:00Z");

  it("toJakartaDate returns a Date object", () => {
    const d = toJakartaDate(SAMPLE_UTC);
    expect(d).toBeInstanceOf(Date);
    // Local-field interpretation depends on host TZ; the WIB invariants
    // are covered by the format-based tests below.
  });

  it("formatIndonesianDate is DD/MM/YYYY (WIB)", () => {
    expect(formatIndonesianDate(SAMPLE_UTC)).toBe("25/04/2026");
  });

  it("formatIndonesianDateTime adds WIB suffix", () => {
    expect(formatIndonesianDateTime(SAMPLE_UTC)).toBe("25/04/2026 14:00 WIB");
  });

  it("formatIndonesianTime is HH:mm WIB", () => {
    expect(formatIndonesianTime(SAMPLE_UTC)).toBe("14:00");
  });

  it("formatTransactionDatePart is YYYYMMDD WIB", () => {
    expect(formatTransactionDatePart(SAMPLE_UTC)).toBe("20260425");
  });

  it("toJakartaDateOnly is YYYY-MM-DD WIB", () => {
    expect(toJakartaDateOnly(SAMPLE_UTC)).toBe("2026-04-25");
  });

  it("WIB-day rollover at 00:00 WIB (= 17:00 UTC previous day)", () => {
    const justBeforeMidnight = new Date("2026-04-25T16:59:59Z"); // 23:59 WIB
    expect(toJakartaDateOnly(justBeforeMidnight)).toBe("2026-04-25");
    const atMidnight = new Date("2026-04-25T17:00:00Z"); // 00:00 WIB next day
    expect(toJakartaDateOnly(atMidnight)).toBe("2026-04-26");
  });

  it("accepts ISO string input", () => {
    expect(formatIndonesianDate("2026-04-25T07:00:00Z")).toBe("25/04/2026");
  });

  describe("monthWibRangeUtc (sesi AE-58)", () => {
    it("returns 1st and last day of regular month (May = 31 days)", () => {
      const r = monthWibRangeUtc("2026-05");
      expect(r.fromIso).toBe("2026-05-01");
      expect(r.toIso).toBe("2026-05-31");
    });

    it("returns Feb 28 for non-leap year", () => {
      const r = monthWibRangeUtc("2026-02");
      expect(r.fromIso).toBe("2026-02-01");
      expect(r.toIso).toBe("2026-02-28");
    });

    it("returns Feb 29 for leap year", () => {
      const r = monthWibRangeUtc("2024-02");
      expect(r.fromIso).toBe("2024-02-01");
      expect(r.toIso).toBe("2024-02-29");
    });

    it("returns Apr 30 (30-day month)", () => {
      const r = monthWibRangeUtc("2026-04");
      expect(r.toIso).toBe("2026-04-30");
    });

    it("throws on invalid format", () => {
      expect(() => monthWibRangeUtc("2026-5")).toThrow();
      expect(() => monthWibRangeUtc("2026-13")).toThrow();
      expect(() => monthWibRangeUtc("not-a-month")).toThrow();
    });
  });

  describe("currentJakartaMonth (sesi AE-58)", () => {
    it("returns YYYY-MM format string", () => {
      const result = currentJakartaMonth();
      expect(result).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    });
  });
});

describe("transactions/helpers.ts", () => {
  const REF = new Date("2026-04-25T07:00:00Z"); // 14:00 WIB → 20260425

  it("todayWibYmd reflects WIB day", () => {
    expect(todayWibYmd(REF)).toBe("20260425");
    // 16:59 UTC = 23:59 WIB same day
    expect(todayWibYmd(new Date("2026-04-25T16:59:00Z"))).toBe("20260425");
    // 17:00 UTC = 00:00 WIB next day
    expect(todayWibYmd(new Date("2026-04-25T17:00:00Z"))).toBe("20260426");
  });

  it("formatTransactionNumber zero-pads sequence to 4 digits", () => {
    expect(formatTransactionNumber("20260425", 1)).toBe("TRX-20260425-0001");
    expect(formatTransactionNumber("20260425", 42)).toBe("TRX-20260425-0042");
    expect(formatTransactionNumber("20260425", 9999)).toBe(
      "TRX-20260425-9999",
    );
  });

  it("startOfWibDayUtc is the UTC instant of 00:00 WIB on that day", () => {
    const start = startOfWibDayUtc(REF);
    // 00:00 WIB == 17:00 UTC the previous day
    expect(start.toISOString()).toBe("2026-04-24T17:00:00.000Z");
  });

  it("endOfWibDayUtc is exactly 24h after start", () => {
    const start = startOfWibDayUtc(REF);
    const end = endOfWibDayUtc(REF);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("cash/helpers.ts", () => {
  it("todayWibIso is YYYY-MM-DD in WIB", () => {
    expect(todayWibIso(new Date("2026-04-25T07:00:00Z"))).toBe("2026-04-25");
    expect(todayWibIso(new Date("2026-04-25T17:00:00Z"))).toBe("2026-04-26");
  });

  it("startOfWibDateUtc parses YYYY-MM-DD", () => {
    expect(startOfWibDateUtc("2026-04-25").toISOString()).toBe(
      "2026-04-24T17:00:00.000Z",
    );
  });

  it("endOfWibDateUtc is 24h later", () => {
    const start = startOfWibDateUtc("2026-04-25");
    const end = endOfWibDateUtc("2026-04-25");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
