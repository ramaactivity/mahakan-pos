import { describe, expect, it } from "vitest";
import {
  computeCashReconciliation,
  computeReconciliationTotals,
  detectReconciliationAnomalies,
} from "@/features/finance/reconciliation-pure";
import type {
  ReconciliationStatus,
  SettlementReconciliationRow,
} from "@/features/finance/types";

function row(
  overrides: Partial<SettlementReconciliationRow>,
): SettlementReconciliationRow {
  return {
    channel: overrides.channel ?? "qris",
    reportedFromShifts: overrides.reportedFromShifts ?? 0,
    posActual: overrides.posActual ?? 0,
    aggregatorGross: overrides.aggregatorGross ?? 0,
    aggregatorFee: overrides.aggregatorFee ?? 0,
    aggregatorNet: overrides.aggregatorNet ?? 0,
    varianceShiftsVsAggregator: overrides.varianceShiftsVsAggregator ?? 0,
    variancePosVsAggregator: overrides.variancePosVsAggregator ?? null,
    bankSettled: overrides.bankSettled ?? 0,
    varianceCashPosVsReported: overrides.varianceCashPosVsReported ?? null,
    varianceCashReportedVsBank: overrides.varianceCashReportedVsBank ?? null,
    status: (overrides.status as ReconciliationStatus) ?? "open",
    note: overrides.note ?? null,
  };
}

describe("computeCashReconciliation", () => {
  it("zero input returns zero variances", () => {
    const r = computeCashReconciliation({
      posCashSales: 0,
      reportedCash: 0,
      bankSettledCash: 0,
    });
    expect(r.variancePosVsReported).toBe(0);
    expect(r.varianceReportedVsBank).toBe(0);
    expect(r.varianceEndToEnd).toBe(0);
  });

  it("POS > reported (kasir lapor kurang)", () => {
    const r = computeCashReconciliation({
      posCashSales: 605_000,
      reportedCash: 600_000,
      bankSettledCash: 600_000,
    });
    expect(r.variancePosVsReported).toBe(5_000);
    expect(r.varianceReportedVsBank).toBe(0);
    expect(r.varianceEndToEnd).toBe(5_000);
  });

  it("reported > bank (cash hilang sebelum setor)", () => {
    const r = computeCashReconciliation({
      posCashSales: 800_000,
      reportedCash: 800_000,
      bankSettledCash: 700_000,
    });
    expect(r.variancePosVsReported).toBe(0);
    expect(r.varianceReportedVsBank).toBe(100_000);
    expect(r.varianceEndToEnd).toBe(100_000);
  });

  it("multi-step leak: POS > reported AND reported > bank", () => {
    const r = computeCashReconciliation({
      posCashSales: 1_000_000,
      reportedCash: 900_000,
      bankSettledCash: 800_000,
    });
    expect(r.variancePosVsReported).toBe(100_000);
    expect(r.varianceReportedVsBank).toBe(100_000);
    expect(r.varianceEndToEnd).toBe(200_000);
  });
});

describe("detectReconciliationAnomalies", () => {
  it("empty rows returns no anomalies", () => {
    expect(detectReconciliationAnomalies([])).toEqual([]);
  });

  it("flags large variance POS vs Aggregator > 10% & > Rp 50k", () => {
    const anomalies = detectReconciliationAnomalies([
      row({
        channel: "qris",
        reportedFromShifts: 800_000, // avoid settlement_missing flag
        posActual: 1_000_000,
        aggregatorGross: 800_000,
        variancePosVsAggregator: 200_000, // 25% over
      }),
    ]);
    const flagged = anomalies.find((a) => a.type === "large_variance");
    expect(flagged).toBeDefined();
    expect(flagged!.channel).toBe("qris");
  });

  it("does NOT flag small variance (< Rp 50k abs)", () => {
    const anomalies = detectReconciliationAnomalies([
      row({
        channel: "qris",
        posActual: 1_000_000,
        aggregatorGross: 990_000,
        variancePosVsAggregator: 10_000, // 1% — under both thresholds
      }),
    ]);
    expect(anomalies.filter((a) => a.type === "large_variance")).toHaveLength(0);
  });

  it("flags settlement_missing when aggregator > 0 but reported = 0", () => {
    const anomalies = detectReconciliationAnomalies([
      row({
        channel: "gofood",
        aggregatorGross: 500_000,
        reportedFromShifts: 0,
      }),
    ]);
    const flagged = anomalies.find((a) => a.type === "settlement_missing");
    expect(flagged).toBeDefined();
    expect(flagged!.channel).toBe("gofood");
  });

  it("flags cash_leak when POS vs reported > threshold", () => {
    const anomalies = detectReconciliationAnomalies([
      row({
        channel: "cash",
        posActual: 600_000,
        reportedFromShifts: 500_000,
        varianceCashPosVsReported: 100_000,
        varianceCashReportedVsBank: 0,
      }),
    ]);
    const flagged = anomalies.find((a) => a.type === "cash_leak");
    expect(flagged).toBeDefined();
    expect(flagged!.severity).toBe("danger");
  });

  it("flags cash_leak when reported vs bank > threshold (lower severity)", () => {
    const anomalies = detectReconciliationAnomalies([
      row({
        channel: "cash",
        posActual: 600_000,
        reportedFromShifts: 600_000,
        bankSettled: 500_000,
        varianceCashPosVsReported: 0,
        varianceCashReportedVsBank: 100_000,
      }),
    ]);
    const flagged = anomalies.find((a) => a.type === "cash_leak");
    expect(flagged).toBeDefined();
    expect(flagged!.severity).toBe("warning");
  });

  it("respects custom thresholds (cashLeakThreshold)", () => {
    const anomalies = detectReconciliationAnomalies(
      [
        row({
          channel: "cash",
          varianceCashPosVsReported: 30_000,
        }),
      ],
      { cashLeakThreshold: 100_000 },
    );
    expect(anomalies.filter((a) => a.type === "cash_leak")).toHaveLength(0);
  });
});

describe("computeReconciliationTotals", () => {
  it("returns 100% accuracy for empty rows", () => {
    const r = computeReconciliationTotals([]);
    expect(r.totalReceived).toBe(0);
    expect(r.totalVariance).toBe(0);
    expect(r.accuracyPct).toBe(100);
  });

  it("sums posActual across channels", () => {
    const r = computeReconciliationTotals([
      row({ channel: "cash", posActual: 500_000 }),
      row({
        channel: "qris",
        posActual: 1_000_000,
        variancePosVsAggregator: 0,
      }),
    ]);
    expect(r.totalReceived).toBe(1_500_000);
  });

  it("100% accuracy when all variances zero", () => {
    const r = computeReconciliationTotals([
      row({
        channel: "qris",
        posActual: 1_000_000,
        aggregatorGross: 1_000_000,
        variancePosVsAggregator: 0,
      }),
    ]);
    expect(r.accuracyPct).toBe(100);
  });

  it("subtracts variance for cash channel (both POS-Reported + Reported-Bank)", () => {
    const r = computeReconciliationTotals([
      row({
        channel: "cash",
        posActual: 1_000_000,
        varianceCashPosVsReported: 50_000,
        varianceCashReportedVsBank: 50_000,
      }),
    ]);
    expect(r.totalReceived).toBe(1_000_000);
    expect(r.totalVariance).toBe(100_000);
    expect(r.accuracyPct).toBe(90);
  });
});
