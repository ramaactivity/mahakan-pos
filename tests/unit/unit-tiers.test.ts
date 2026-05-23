import { describe, it, expect } from "vitest";
import {
  cogsToBelanja,
  cogsToTracking,
  belanjaToCogs,
  effectiveBelanjaUnit,
  effectiveTrackingUnit,
  formatStockDisplay,
  trackingToCogs,
  type IngredientUnitTiers,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-130 — multi-unit tier helpers (Anisa feedback).
 * Susu: COGS=ml, Tracking=Kotak (1 Kotak=1000 ml), Belanja=L (1 L=1000 ml).
 */
const susu: IngredientUnitTiers = {
  cogsUnit: "ml",
  trackingUnit: "Kotak",
  trackingPerCogs: 1000,
  belanjaUnit: "L",
  belanjaPerCogs: 1000,
};

/** Beras: COGS=g, Tracking=L (label-only, identity 1:1), Belanja=Kg (1 Kg=1000 g). */
const beras: IngredientUnitTiers = {
  cogsUnit: "g",
  trackingUnit: "L",
  trackingPerCogs: null, // identity rename
  belanjaUnit: "Kg",
  belanjaPerCogs: 1000,
};

/** Plain ingredient (no tiers, fallback semua ke COGS). */
const plain: IngredientUnitTiers = {
  cogsUnit: "pcs",
  trackingUnit: null,
  trackingPerCogs: null,
  belanjaUnit: null,
  belanjaPerCogs: null,
};

describe("effective unit labels", () => {
  it("returns tracking label when set", () => {
    expect(effectiveTrackingUnit(susu)).toBe("Kotak");
  });
  it("falls back to COGS when tracking empty", () => {
    expect(effectiveTrackingUnit(plain)).toBe("pcs");
  });
  it("trims whitespace tracking labels", () => {
    expect(
      effectiveTrackingUnit({ cogsUnit: "ml", trackingUnit: "  " }),
    ).toBe("ml");
  });
  it("belanja label fallback works the same way", () => {
    expect(effectiveBelanjaUnit(plain)).toBe("pcs");
    expect(effectiveBelanjaUnit(susu)).toBe("L");
  });
});

describe("cogs <-> tracking conversion", () => {
  it("cogsToTracking divides by per_cogs", () => {
    expect(cogsToTracking(2000, susu)).toBe(2); // 2000 ml = 2 Kotak
  });
  it("trackingToCogs multiplies", () => {
    expect(trackingToCogs(3, susu)).toBe(3000);
  });
  it("identity tier passes through (label-only rename)", () => {
    expect(cogsToTracking(500, beras)).toBe(500);
    expect(trackingToCogs(500, beras)).toBe(500);
  });
  it("disabled tier returns input as-is", () => {
    expect(cogsToTracking(100, plain)).toBe(100);
    expect(trackingToCogs(100, plain)).toBe(100);
  });
});

describe("cogs <-> belanja conversion", () => {
  it("belanjaToCogs scales up", () => {
    expect(belanjaToCogs(0.5, susu)).toBe(500); // 0.5 L = 500 ml
  });
  it("cogsToBelanja scales down", () => {
    expect(cogsToBelanja(2500, beras)).toBe(2.5); // 2500 g = 2.5 Kg
  });
  it("disabled belanja passes through", () => {
    expect(belanjaToCogs(7, plain)).toBe(7);
    expect(cogsToBelanja(7, plain)).toBe(7);
  });
});

describe("string per_cogs coercion (Drizzle numeric -> string)", () => {
  it("accepts decimal string per_cogs", () => {
    const tiers: IngredientUnitTiers = {
      cogsUnit: "ml",
      trackingUnit: "Kotak",
      trackingPerCogs: "1000.0000",
    };
    expect(cogsToTracking(2000, tiers)).toBe(2);
  });
  it("rejects zero/negative per_cogs (treated as identity safeguard)", () => {
    const tiers: IngredientUnitTiers = {
      cogsUnit: "ml",
      trackingUnit: "Kotak",
      trackingPerCogs: 0,
    };
    expect(cogsToTracking(2000, tiers)).toBe(2000);
  });
});

describe("formatStockDisplay", () => {
  it("formats with tracking unit when active", () => {
    expect(formatStockDisplay(2500, susu)).toBe("2,5 Kotak");
  });
  it("falls back to COGS unit when tracking disabled", () => {
    expect(formatStockDisplay(50, plain)).toBe("50 pcs");
  });
  it("includes COGS breakdown when requested", () => {
    expect(
      formatStockDisplay(2500, susu, { showCogsBreakdown: true }),
    ).toBe("2,5 Kotak (2.500 ml)");
  });
  it("respects identity tier (label rename without scaling)", () => {
    expect(formatStockDisplay(1234, beras)).toBe("1.234 L");
  });
});
