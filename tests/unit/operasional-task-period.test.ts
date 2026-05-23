import { describe, it, expect } from "vitest";
import {
  dailyKey,
  monthlyKey,
  weeklyKey,
  currentPeriodKey,
  formatPeriodLabel,
} from "@/features/operasional-tasks/period";

/**
 * Sesi AE-131 — Lock down period key arithmetic.
 *
 * Date strings memakai WIB (UTC+7). Cek:
 *  - daily key tetap stabil saat input adalah UTC midnight (boundary).
 *  - weekly key follow ISO-8601 (Mon-anchored).
 *  - format label Bahasa Indonesia.
 */

function utcDate(iso: string): Date {
  return new Date(iso);
}

describe("operasional period keys", () => {
  it("dailyKey: midnight UTC tidak lompat ke hari berikutnya WIB", () => {
    /* 2026-05-22 00:00 UTC = 2026-05-22 07:00 WIB. */
    expect(dailyKey(utcDate("2026-05-22T00:00:00Z"))).toBe("2026-05-22");
  });

  it("dailyKey: 17:00 UTC = 00:00 WIB → tanggal WIB next day", () => {
    /* 2026-05-22 17:00 UTC = 2026-05-23 00:00 WIB. */
    expect(dailyKey(utcDate("2026-05-22T17:00:00Z"))).toBe("2026-05-23");
  });

  it("monthlyKey", () => {
    expect(monthlyKey(utcDate("2026-05-15T05:00:00Z"))).toBe("2026-05");
    /* Akhir bulan WIB cross-over. 2026-05-31 23:00 WIB = 2026-05-31 16:00 UTC. */
    expect(monthlyKey(utcDate("2026-05-31T16:00:00Z"))).toBe("2026-05");
    /* 2026-05-31 17:30 UTC = 2026-06-01 00:30 WIB → Juni. */
    expect(monthlyKey(utcDate("2026-05-31T17:30:00Z"))).toBe("2026-06");
  });

  it("weeklyKey: ISO 8601 (Mon-anchored)", () => {
    /* 2026-01-01 = Thursday → ISO week 1 of 2026 (Mon 2025-12-29..Sun 2026-01-04). */
    expect(weeklyKey(utcDate("2026-01-01T06:00:00Z"))).toBe("2026-W01");
    /* 2026-05-22 = Friday → ISO week 21. */
    expect(weeklyKey(utcDate("2026-05-22T06:00:00Z"))).toBe("2026-W21");
    /* 2026-12-31 = Thursday → still in W53 of 2026. */
    expect(weeklyKey(utcDate("2026-12-31T06:00:00Z"))).toBe("2026-W53");
  });

  it("currentPeriodKey dispatch by frequency", () => {
    const d = utcDate("2026-05-22T06:00:00Z");
    expect(currentPeriodKey("daily", d)).toBe("2026-05-22");
    expect(currentPeriodKey("weekly", d)).toBe("2026-W21");
    expect(currentPeriodKey("monthly", d)).toBe("2026-05");
  });

  it("formatPeriodLabel daily", () => {
    expect(formatPeriodLabel("daily", "2026-05-22")).toBe(
      "Jumat, 22 Mei 2026",
    );
  });

  it("formatPeriodLabel monthly", () => {
    expect(formatPeriodLabel("monthly", "2026-05")).toBe("Mei 2026");
  });

  it("formatPeriodLabel weekly", () => {
    /* W21 of 2026: Mon 2026-05-18 → Sun 2026-05-24 (still in May). */
    expect(formatPeriodLabel("weekly", "2026-W21")).toBe(
      "Minggu 21, 2026 (18–24 Mei)",
    );
  });
});
