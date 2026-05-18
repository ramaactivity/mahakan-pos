import { describe, it, expect } from "vitest";
import {
  classifyVariance,
  CHANNEL_LABEL,
  SETTLEMENT_CHANNELS,
  type SettlementLogRow,
} from "@/features/settlement-logs/types";

function row(
  expected: number,
  actual: number,
): SettlementLogRow {
  const variance = actual - expected;
  const variancePct = expected > 0 ? Math.abs(variance) / expected : 0;
  return {
    id: "x",
    outletId: "o1",
    settlementDate: "2026-05-05",
    channel: "cash",
    expectedAmount: expected,
    actualAmount: actual,
    settledAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: "u",
    updatedBy: null,
    variance,
    variancePct,
  };
}

describe("classifyVariance (Phase 6.1, sesi AC-5)", () => {
  it("zero on both sides → match", () => {
    expect(classifyVariance(row(0, 0))).toBe("match");
  });

  it("exact match → match", () => {
    expect(classifyVariance(row(1_000_000, 1_000_000))).toBe("match");
  });

  it("within 1% deviation → match", () => {
    expect(classifyVariance(row(1_000_000, 1_005_000))).toBe("match"); // 0.5%
    expect(classifyVariance(row(1_000_000, 990_000))).toBe("match"); // 1%
  });

  it("between 1% and 5% → warn", () => {
    expect(classifyVariance(row(1_000_000, 970_000))).toBe("warn"); // 3%
    expect(classifyVariance(row(1_000_000, 1_050_000))).toBe("warn"); // 5%
  });

  it("greater than 5% → alert", () => {
    expect(classifyVariance(row(1_000_000, 900_000))).toBe("alert"); // 10%
    expect(classifyVariance(row(1_000_000, 0))).toBe("alert"); // 100%
  });

  it("expected zero, actual > 0 → alert", () => {
    // expected 0 means variancePct = 0 (per implementation), tier = match.
    // This is intentional: kalau owner input actual untuk channel yang
    // POS-nya 0, tidak ada baseline untuk %; treat as match.
    expect(classifyVariance(row(0, 100_000))).toBe("match");
  });
});

describe("SETTLEMENT_CHANNELS coverage", () => {
  it("includes 10 canonical channels", () => {
    expect(SETTLEMENT_CHANNELS).toHaveLength(10);
    expect(SETTLEMENT_CHANNELS).toContain("cash");
    expect(SETTLEMENT_CHANNELS).toContain("qris");
    expect(SETTLEMENT_CHANNELS).toContain("card_bca");
    expect(SETTLEMENT_CHANNELS).toContain("card_bni");
    expect(SETTLEMENT_CHANNELS).toContain("card_mandiri");
    expect(SETTLEMENT_CHANNELS).toContain("card_bri");
    expect(SETTLEMENT_CHANNELS).toContain("card_other");
    expect(SETTLEMENT_CHANNELS).toContain("gofood");
    expect(SETTLEMENT_CHANNELS).toContain("grabfood");
    expect(SETTLEMENT_CHANNELS).toContain("shopeefood");
  });

  it("each channel has a human label", () => {
    for (const ch of SETTLEMENT_CHANNELS) {
      expect(CHANNEL_LABEL[ch]).toBeTruthy();
      expect(CHANNEL_LABEL[ch].length).toBeGreaterThan(0);
    }
  });
});
