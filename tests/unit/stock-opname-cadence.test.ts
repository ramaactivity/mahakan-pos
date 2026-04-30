import { describe, expect, it } from "vitest";
import {
  jakartaMonthKey,
  jakartaMonthLabel,
} from "@/features/stock-opname/cadence";

describe("stock-opname cadence helpers", () => {
  it("returns YYYY-MM key in Asia/Jakarta", () => {
    // 2026-04-15 12:00 UTC = 2026-04-15 19:00 WIB (still April)
    const d = new Date("2026-04-15T12:00:00Z");
    expect(jakartaMonthKey(d)).toBe("2026-04");
  });

  it("rolls forward when UTC instant is late month but WIB is next month", () => {
    // 2026-04-30 18:00 UTC = 2026-05-01 01:00 WIB
    const d = new Date("2026-04-30T18:00:00Z");
    expect(jakartaMonthKey(d)).toBe("2026-05");
  });

  it("rolls back when UTC instant is early UTC but WIB is still prev day same month", () => {
    // 2026-05-01 02:00 UTC = 2026-05-01 09:00 WIB (still May)
    const d = new Date("2026-05-01T02:00:00Z");
    expect(jakartaMonthKey(d)).toBe("2026-05");
  });

  it("returns Indonesian month label", () => {
    expect(jakartaMonthLabel(new Date("2026-04-15T12:00:00Z"))).toBe(
      "April 2026",
    );
    expect(jakartaMonthLabel(new Date("2026-12-31T15:00:00Z"))).toBe(
      "Desember 2026",
    );
    expect(jakartaMonthLabel(new Date("2027-01-01T00:00:00Z"))).toBe(
      "Januari 2027",
    );
  });
});
