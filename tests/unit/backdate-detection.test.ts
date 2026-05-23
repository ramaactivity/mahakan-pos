import { describe, it, expect } from "vitest";
import {
  classifyPurchaseAgainstOpname,
  jakartaDateIso,
  shouldSkipStockUpdate,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-130 — Anti-double-count detection (Anisa feedback).
 *
 * Skenario realnya: Anisa hitung fisik tanggal 20 Mei jam 20:00 (=100,
 * sudah include belanja siang). Lalu input bon belanja tanggal 20 Mei
 * malam jam 22:00 → harus SKIP stock update (=ambiguous "same day").
 */

function jktTimestamp(iso: string, hours = 12): Date {
  // ISO YYYY-MM-DD interpreted as Jakarta business day; build UTC ts
  // matching that day at `hours` WIB.
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d, hours - 7, 0, 0));
}

describe("jakartaDateIso", () => {
  it("formats UTC ts as Jakarta YYYY-MM-DD", () => {
    // 2026-05-20 18:00 WIB = 2026-05-20 11:00 UTC
    const d = jktTimestamp("2026-05-20", 18);
    expect(jakartaDateIso(d)).toBe("2026-05-20");
  });
  it("handles UTC-to-Jakarta day boundary", () => {
    // 2026-05-21 06:00 WIB = 2026-05-20 23:00 UTC → Jakarta = 2026-05-21
    const d = new Date("2026-05-20T23:00:00Z");
    expect(jakartaDateIso(d)).toBe("2026-05-21");
  });
});

describe("classifyPurchaseAgainstOpname", () => {
  it("no_baseline when opname is null (fresh setup)", () => {
    expect(
      classifyPurchaseAgainstOpname({
        purchaseDateIso: "2026-05-20",
        lastOpnameFinalizedAt: null,
      }),
    ).toBe("no_baseline");
  });

  it("after when purchase is later than opname date", () => {
    expect(
      classifyPurchaseAgainstOpname({
        purchaseDateIso: "2026-05-21",
        lastOpnameFinalizedAt: jktTimestamp("2026-05-20", 18),
      }),
    ).toBe("after");
  });

  it("same when purchase same date as opname (ambiguous)", () => {
    expect(
      classifyPurchaseAgainstOpname({
        purchaseDateIso: "2026-05-20",
        lastOpnameFinalizedAt: jktTimestamp("2026-05-20", 20),
      }),
    ).toBe("same");
  });

  it("before when purchase predates opname date", () => {
    expect(
      classifyPurchaseAgainstOpname({
        purchaseDateIso: "2026-05-15",
        lastOpnameFinalizedAt: jktTimestamp("2026-05-20", 18),
      }),
    ).toBe("before");
  });

  it("uses Jakarta day boundary not UTC", () => {
    // Opname finalized at 2026-05-21 02:00 WIB = 2026-05-20 19:00 UTC
    // Purchase on 2026-05-20 should be "before" (Jakarta perspective)
    const opname = new Date("2026-05-20T19:00:00Z");
    expect(jakartaDateIso(opname)).toBe("2026-05-21");
    expect(
      classifyPurchaseAgainstOpname({
        purchaseDateIso: "2026-05-20",
        lastOpnameFinalizedAt: opname,
      }),
    ).toBe("before");
  });
});

describe("shouldSkipStockUpdate", () => {
  it("skip for before (definitely backdated)", () => {
    expect(shouldSkipStockUpdate("before")).toBe(true);
  });
  it("skip for same (ambiguous same-day)", () => {
    expect(shouldSkipStockUpdate("same")).toBe(true);
  });
  it("do not skip for after (normal additive)", () => {
    expect(shouldSkipStockUpdate("after")).toBe(false);
  });
  it("do not skip when no baseline (fresh setup, default to add)", () => {
    expect(shouldSkipStockUpdate("no_baseline")).toBe(false);
  });
});
