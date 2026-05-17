/**
 * Sesi AE-56 — Pure helpers untuk Rekonsiliasi audit (cash 3-way + anomaly
 * detector). No DB / framework deps — testable isolation. Dipakai di
 * finance/queries.ts saat compute report + di ReconciliationView untuk
 * derived computation.
 */
import type {
  AggregatorChannel,
  ReconciliationAnomaly,
  SettlementReconciliationRow,
} from "./types";

/* ---------------- Cash 3-way reconciliation ---------------- */

export interface CashReconciliationInput {
  /** SUM transactions cash (paid + partially_refunded), net of refundedAmount. */
  posCashSales: number;
  /** SUM kasir-reported cash sales dari shift close — derived dari
   *  (actualCash - openingCash + refundedCash - paidQris - paidCard) atau dari
   *  field cashSalesReported kalau ada. */
  reportedCash: number;
  /** SUM cash_deposits.amount status='verified' di range. */
  bankSettledCash: number;
}

export interface CashReconciliationResult {
  posCashSales: number;
  reportedCash: number;
  bankSettledCash: number;
  /** posCashSales - reportedCash (positive = POS lebih banyak dari yang kasir lapor). */
  variancePosVsReported: number;
  /** reportedCash - bankSettledCash (positive = kasir lapor lebih dari yang masuk bank). */
  varianceReportedVsBank: number;
  /** posCashSales - bankSettledCash (overall leak end-to-end). */
  varianceEndToEnd: number;
}

export function computeCashReconciliation(
  input: CashReconciliationInput,
): CashReconciliationResult {
  const { posCashSales, reportedCash, bankSettledCash } = input;
  return {
    posCashSales,
    reportedCash,
    bankSettledCash,
    variancePosVsReported: posCashSales - reportedCash,
    varianceReportedVsBank: reportedCash - bankSettledCash,
    varianceEndToEnd: posCashSales - bankSettledCash,
  };
}

/* ---------------- Anomaly detector ---------------- */

export interface AnomalyDetectorOptions {
  /** % selisih threshold (default 10). */
  largeVariancePctThreshold?: number;
  /** Rupiah selisih threshold absolut (default 50_000). */
  largeVarianceAbsThreshold?: number;
  /** Range days untuk "settlement missing" — kalau aggregator gross
   *  ada tapi reported = 0 di range > N hari → flag. Default 1. */
  settlementMissingDays?: number;
  /** Cash leak threshold: |variancePosVsReported| atau |varianceReportedVsBank|
   *  > N → flag. Default 50_000. */
  cashLeakThreshold?: number;
  /** Sesi AE-62h — negative cash detection tolerance (default 0).
   * Sebelumnya hardcoded 1000 → 1k bypass per setoran. Sekarang configurable
   * via outlet.settings.finance.reconciliationTolerance (default 0 = strict).
   * Disetel > 0 hanya untuk outlet dengan history rounding noise yang
   * di-acknowledge owner. */
  negativeCashTolerance?: number;
}

const DEFAULTS: Required<AnomalyDetectorOptions> = {
  largeVariancePctThreshold: 10,
  largeVarianceAbsThreshold: 50_000,
  settlementMissingDays: 1,
  cashLeakThreshold: 50_000,
  negativeCashTolerance: 0,
};

const CHANNEL_LABEL_ID: Record<AggregatorChannel, string> = {
  cash: "Cash",
  edc_bca: "EDC BCA",
  qris: "QRIS",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
};

function formatRupiahShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  }
  if (abs >= 1_000) {
    return `${sign}Rp ${Math.round(abs / 1_000)}rb`;
  }
  return `${sign}Rp ${abs}`;
}

export function detectReconciliationAnomalies(
  rows: SettlementReconciliationRow[],
  options: AnomalyDetectorOptions = {},
): ReconciliationAnomaly[] {
  const opts = { ...DEFAULTS, ...options };
  const anomalies: ReconciliationAnomaly[] = [];

  for (const row of rows) {
    const channelLabel = CHANNEL_LABEL_ID[row.channel];

    // Negative cash (data inconsistency)
    // Sesi AE-62h — pakai opts.negativeCashTolerance (default 0 = strict)
    // instead of hardcoded 1000 (1k bypass per setoran).
    if (row.channel === "cash" && row.bankSettled > row.reportedFromShifts + opts.negativeCashTolerance && row.reportedFromShifts > 0) {
      anomalies.push({
        type: "negative_cash",
        severity: "danger",
        channel: row.channel,
        message: `Setoran bank ${channelLabel} (${formatRupiahShort(row.bankSettled)}) melebihi kasir lapor (${formatRupiahShort(row.reportedFromShifts)}) — data tidak konsisten`,
      });
    }

    // Cash leak (3-way variance besar)
    if (row.channel === "cash") {
      const posVsReported = row.varianceCashPosVsReported ?? 0;
      const reportedVsBank = row.varianceCashReportedVsBank ?? 0;
      if (Math.abs(posVsReported) > opts.cashLeakThreshold) {
        anomalies.push({
          type: "cash_leak",
          severity: "danger",
          channel: row.channel,
          message: `Selisih Penjualan Tunai POS vs Kasir Lapor: ${formatRupiahShort(posVsReported)} — risiko kebocoran kas di drawer`,
        });
      }
      if (Math.abs(reportedVsBank) > opts.cashLeakThreshold) {
        anomalies.push({
          type: "cash_leak",
          severity: "warning",
          channel: row.channel,
          message: `Selisih Kasir Lapor vs Setoran Bank: ${formatRupiahShort(reportedVsBank)} — cash mungkin belum disetor atau hilang sebelum bank`,
        });
      }
    }

    // Settlement missing (aggregator > 0 but reported = 0)
    if (
      row.channel !== "cash" &&
      row.aggregatorGross > 0 &&
      row.reportedFromShifts === 0
    ) {
      anomalies.push({
        type: "settlement_missing",
        severity: "warning",
        channel: row.channel,
        message: `${channelLabel}: Aggregator ${formatRupiahShort(row.aggregatorGross)} masuk, tapi kasir belum lapor settlement`,
      });
    }

    // Large variance (POS vs Aggregator)
    if (row.channel !== "cash" && row.aggregatorGross > 0) {
      const variance = row.variancePosVsAggregator ?? 0;
      const pctDiff = (Math.abs(variance) / row.aggregatorGross) * 100;
      const passesPctCheck = pctDiff > opts.largeVariancePctThreshold;
      const passesAbsCheck =
        Math.abs(variance) > opts.largeVarianceAbsThreshold;
      if (passesPctCheck && passesAbsCheck) {
        anomalies.push({
          type: "large_variance",
          severity: "warning",
          channel: row.channel,
          message: `${channelLabel}: Selisih POS vs Aggregator ${formatRupiahShort(variance)} (${pctDiff.toFixed(1)}% di atas threshold)`,
        });
      }
    }
  }

  return anomalies;
}

/* ---------------- Header totals ---------------- */

export function computeReconciliationTotals(
  rows: SettlementReconciliationRow[],
): { totalReceived: number; totalVariance: number; accuracyPct: number } {
  let totalReceived = 0;
  let totalVariance = 0;
  for (const row of rows) {
    totalReceived += row.posActual;
    if (row.channel === "cash") {
      totalVariance += Math.abs(row.varianceCashPosVsReported ?? 0);
      totalVariance += Math.abs(row.varianceCashReportedVsBank ?? 0);
    } else {
      totalVariance += Math.abs(row.variancePosVsAggregator ?? 0);
    }
  }
  const accuracy =
    totalReceived > 0
      ? Math.max(0, Math.min(100, 100 - (totalVariance / totalReceived) * 100))
      : 100;
  return {
    totalReceived,
    totalVariance,
    accuracyPct: Math.round(accuracy * 10) / 10,
  };
}
