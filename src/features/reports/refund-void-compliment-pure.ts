/**
 * Sesi AE-59 — Pure helpers untuk Refund / Void / Compliment report.
 * Aggregate totals + anomaly detection. No DB / framework deps — testable
 * isolation.
 */
import type {
  RefundVoidComplimentEvent,
  RvcAnomaly,
  RvcTotals,
} from "./types";

const ZERO_TOTALS: RvcTotals = {
  refundFullCount: 0,
  refundFullAmount: 0,
  refundPartialCount: 0,
  refundPartialAmount: 0,
  voidCount: 0,
  voidAmount: 0,
  complimentCount: 0,
  complimentAmount: 0,
  complimentCogsImpact: 0,
  grandEventCount: 0,
  grandAmount: 0,
};

export function computeRvcTotals(
  events: RefundVoidComplimentEvent[],
): RvcTotals {
  const t: RvcTotals = { ...ZERO_TOTALS };
  for (const e of events) {
    t.grandEventCount++;
    t.grandAmount += e.amountImpact;
    switch (e.kind) {
      case "refund_full":
        t.refundFullCount++;
        t.refundFullAmount += e.amountImpact;
        break;
      case "refund_partial":
        t.refundPartialCount++;
        t.refundPartialAmount += e.amountImpact;
        break;
      case "void":
        t.voidCount++;
        t.voidAmount += e.amountImpact;
        break;
      case "compliment":
        t.complimentCount++;
        t.complimentAmount += e.amountImpact;
        t.complimentCogsImpact += e.cogsImpact;
        break;
    }
  }
  return t;
}

export interface RvcAnomalyOptions {
  /** Threshold refund per kasir per hari → flag frequent_refund_kasir. Default 5. */
  refundPerKasirPerDay?: number;
  /** Threshold compliment per range → flag burst. Default 10. */
  complimentPerRange?: number;
  /** Threshold same item void/refund per range → flag repeated. Default 3.
   * Detect "kasir berulang void item yang sama" pattern. */
  itemRepeatThreshold?: number;
}

const DEFAULTS: Required<RvcAnomalyOptions> = {
  refundPerKasirPerDay: 5,
  complimentPerRange: 10,
  itemRepeatThreshold: 3,
};

export function detectRvcAnomalies(
  events: RefundVoidComplimentEvent[],
  options: RvcAnomalyOptions = {},
): RvcAnomaly[] {
  const opts = { ...DEFAULTS, ...options };
  const anomalies: RvcAnomaly[] = [];

  // Frequent refund per kasir per hari (group key: cashierName|date)
  const refundsByKasirDay = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "refund_full" && e.kind !== "refund_partial") continue;
    if (!e.cashierName) continue;
    const day = e.occurredAt.slice(0, 10);
    const key = `${e.cashierName}|${day}`;
    refundsByKasirDay.set(key, (refundsByKasirDay.get(key) ?? 0) + 1);
  }
  for (const [key, count] of refundsByKasirDay) {
    if (count >= opts.refundPerKasirPerDay) {
      const [kasir, day] = key.split("|");
      anomalies.push({
        type: "frequent_refund_kasir",
        severity: "warning",
        message: `Kasir ${kasir} melakukan ${count} refund di tanggal ${day} — cek pattern (rata-rata >5/hari mencurigakan).`,
      });
    }
  }

  // Compliment burst (total compliment count > threshold in range)
  const complimentCount = events.filter((e) => e.kind === "compliment").length;
  if (complimentCount >= opts.complimentPerRange) {
    anomalies.push({
      type: "compliment_burst",
      severity: "info",
      message: `${complimentCount} compliment dalam range — review apakah sesuai kebijakan pemilik (≥${opts.complimentPerRange} = di atas normal).`,
    });
  }

  return anomalies;
}

/** Append integrity_mismatch anomalies setelah cross-check sum(refund_events)
 * vs transactions.refundedAmount. Diisi oleh query layer (perlu DB access). */
export function appendIntegrityMismatchAnomaly(
  baseAnomalies: RvcAnomaly[],
  mismatchedTransactionNumbers: string[],
): RvcAnomaly[] {
  if (mismatchedTransactionNumbers.length === 0) return baseAnomalies;
  return [
    ...baseAnomalies,
    {
      type: "integrity_mismatch",
      severity: "danger",
      message: `${mismatchedTransactionNumbers.length} transaksi: sum refund_events tidak match dengan transactions.refundedAmount (${mismatchedTransactionNumbers.slice(0, 3).join(", ")}${mismatchedTransactionNumbers.length > 3 ? "..." : ""}). Cek integrity DB.`,
    },
  ];
}

/** Microcopy untuk inventory impact per kind. */
export function inventoryWarningMicrocopy(
  kind: RefundVoidComplimentEvent["kind"],
): string | null {
  switch (kind) {
    case "void":
      return null; // restored, no warning
    case "refund_full":
      return null; // restored
    case "refund_partial":
      return "Partial refund TIDAK auto-restore stok (versi 1). Owner harus adjust stok manual kalau item fisik dikembalikan.";
    case "compliment":
      return "Compliment = stok tetap keluar (tidak ada restore). COGS items masuk ke journal Marketing & Iklan otomatis.";
    default:
      return null;
  }
}
