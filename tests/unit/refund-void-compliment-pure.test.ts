import { describe, expect, it } from "vitest";
import {
  appendIntegrityMismatchAnomaly,
  computeRvcTotals,
  detectRvcAnomalies,
  inventoryWarningMicrocopy,
} from "@/features/reports/refund-void-compliment-pure";
import type { RefundVoidComplimentEvent } from "@/features/reports/types";

function ev(
  overrides: Partial<RefundVoidComplimentEvent>,
): RefundVoidComplimentEvent {
  return {
    eventId: overrides.eventId ?? `ev-${Math.random().toString(36).slice(2, 8)}`,
    kind: overrides.kind ?? "refund_full",
    transactionId: overrides.transactionId ?? "trx-1",
    transactionNumber: overrides.transactionNumber ?? "TRX-001",
    occurredAt: overrides.occurredAt ?? "2026-05-15T10:00:00Z",
    cashierName: "cashierName" in overrides ? overrides.cashierName! : "Parhan",
    customerName: overrides.customerName ?? null,
    approverName: overrides.approverName ?? "Owner",
    reason: overrides.reason ?? "Customer complaint",
    amountImpact: overrides.amountImpact ?? 50_000,
    cogsImpact: overrides.cogsImpact ?? 0,
    itemCount: overrides.itemCount ?? 1,
  };
}

describe("computeRvcTotals", () => {
  it("returns all zeros for empty array", () => {
    const t = computeRvcTotals([]);
    expect(t.grandEventCount).toBe(0);
    expect(t.grandAmount).toBe(0);
    expect(t.refundFullCount).toBe(0);
    expect(t.complimentCogsImpact).toBe(0);
  });

  it("aggregates mixed kinds correctly", () => {
    const t = computeRvcTotals([
      ev({ kind: "refund_full", amountImpact: 100_000 }),
      ev({ kind: "refund_partial", amountImpact: 30_000 }),
      ev({ kind: "void", amountImpact: 50_000 }),
      ev({ kind: "compliment", amountImpact: 25_000, cogsImpact: 8_000 }),
    ]);
    expect(t.grandEventCount).toBe(4);
    expect(t.grandAmount).toBe(205_000);
    expect(t.refundFullAmount).toBe(100_000);
    expect(t.refundPartialAmount).toBe(30_000);
    expect(t.voidAmount).toBe(50_000);
    expect(t.complimentAmount).toBe(25_000);
    expect(t.complimentCogsImpact).toBe(8_000);
  });

  it("sums multiple events of same kind", () => {
    const t = computeRvcTotals([
      ev({ kind: "void", amountImpact: 10_000 }),
      ev({ kind: "void", amountImpact: 20_000 }),
      ev({ kind: "void", amountImpact: 5_000 }),
    ]);
    expect(t.voidCount).toBe(3);
    expect(t.voidAmount).toBe(35_000);
  });
});

describe("detectRvcAnomalies", () => {
  it("empty array returns no anomalies", () => {
    expect(detectRvcAnomalies([])).toEqual([]);
  });

  it("flags frequent_refund_kasir when kasir >= 5 refund per day", () => {
    const events = Array.from({ length: 5 }).map((_, i) =>
      ev({
        eventId: `r${i}`,
        kind: "refund_full",
        cashierName: "Parhan",
        occurredAt: "2026-05-15T10:00:00Z",
      }),
    );
    const result = detectRvcAnomalies(events);
    expect(result.some((a) => a.type === "frequent_refund_kasir")).toBe(true);
  });

  it("does not flag if 4 refunds in 1 day (below threshold)", () => {
    const events = Array.from({ length: 4 }).map((_, i) =>
      ev({
        eventId: `r${i}`,
        kind: "refund_full",
        cashierName: "Parhan",
        occurredAt: "2026-05-15T10:00:00Z",
      }),
    );
    const result = detectRvcAnomalies(events);
    expect(result.filter((a) => a.type === "frequent_refund_kasir")).toHaveLength(
      0,
    );
  });

  it("separates count by date (5 refunds across 2 days = no flag)", () => {
    const events = [
      ev({ kind: "refund_full", cashierName: "P", occurredAt: "2026-05-15T01:00:00Z" }),
      ev({ kind: "refund_full", cashierName: "P", occurredAt: "2026-05-15T02:00:00Z" }),
      ev({ kind: "refund_full", cashierName: "P", occurredAt: "2026-05-16T01:00:00Z" }),
      ev({ kind: "refund_full", cashierName: "P", occurredAt: "2026-05-16T02:00:00Z" }),
      ev({ kind: "refund_full", cashierName: "P", occurredAt: "2026-05-16T03:00:00Z" }),
    ];
    const result = detectRvcAnomalies(events);
    expect(result.filter((a) => a.type === "frequent_refund_kasir")).toHaveLength(
      0,
    );
  });

  it("flags compliment_burst at threshold", () => {
    const events = Array.from({ length: 10 }).map((_, i) =>
      ev({ eventId: `c${i}`, kind: "compliment" }),
    );
    const result = detectRvcAnomalies(events);
    expect(result.some((a) => a.type === "compliment_burst")).toBe(true);
  });

  it("respects custom thresholds", () => {
    const events = Array.from({ length: 3 }).map((_, i) =>
      ev({
        eventId: `r${i}`,
        kind: "refund_full",
        cashierName: "X",
        occurredAt: "2026-05-15T10:00:00Z",
      }),
    );
    const result = detectRvcAnomalies(events, { refundPerKasirPerDay: 3 });
    expect(result.some((a) => a.type === "frequent_refund_kasir")).toBe(true);
  });
});

describe("appendIntegrityMismatchAnomaly", () => {
  it("returns base array unchanged when no mismatches", () => {
    const base = [
      { type: "compliment_burst", severity: "info", message: "x" },
    ] as const;
    const result = appendIntegrityMismatchAnomaly([...base], []);
    expect(result).toHaveLength(1);
  });

  it("appends integrity_mismatch when transactions list non-empty", () => {
    const result = appendIntegrityMismatchAnomaly([], ["TRX-100", "TRX-101"]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("integrity_mismatch");
    expect(result[0].severity).toBe("danger");
    expect(result[0].message).toContain("TRX-100");
  });

  it("truncates long mismatch list to first 3 in message", () => {
    const result = appendIntegrityMismatchAnomaly(
      [],
      ["T1", "T2", "T3", "T4", "T5"],
    );
    expect(result[0].message).toContain("...");
  });
});

describe("inventoryWarningMicrocopy", () => {
  it("returns null for void (auto-restored)", () => {
    expect(inventoryWarningMicrocopy("void")).toBeNull();
  });

  it("returns null for refund_full (auto-restored)", () => {
    expect(inventoryWarningMicrocopy("refund_full")).toBeNull();
  });

  it("returns warning for refund_partial (no restore)", () => {
    expect(inventoryWarningMicrocopy("refund_partial")).toContain("manual");
  });

  it("returns note for compliment (COGS impact)", () => {
    expect(inventoryWarningMicrocopy("compliment")).toContain("COGS");
  });
});
