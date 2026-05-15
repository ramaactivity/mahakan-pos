/**
 * Sesi AE-59 — CSV builder untuk export Refund/Void/Compliment report.
 * Format flat: 1 row per event + footer grand total per kind.
 */
import Papa from "papaparse";
import type {
  RefundVoidComplimentEvent,
  RefundVoidComplimentKind,
  RvcTotals,
} from "@/features/reports";

const KIND_LABEL: Record<RefundVoidComplimentKind, string> = {
  refund_full: "Refund Full",
  refund_partial: "Refund Partial",
  void: "Void",
  compliment: "Compliment",
};

interface CsvRow {
  Waktu?: string;
  Jenis?: string;
  "No Trx"?: string;
  Kasir?: string;
  Customer?: string;
  "Total Impact"?: number | string;
  "COGS Impact"?: number | string;
  "Item Count"?: number | string;
  Approver?: string;
  Alasan?: string;
}

export function buildRvcCsv(
  events: RefundVoidComplimentEvent[],
  totals: RvcTotals,
  range: { from: string; to: string },
): string {
  const records: CsvRow[] = [];

  // Header info row
  records.push({
    Waktu: `Periode ${range.from} – ${range.to}`,
  });
  records.push({});

  // Data rows
  for (const ev of events) {
    records.push({
      Waktu: new Date(ev.occurredAt).toLocaleString("id-ID", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      Jenis: KIND_LABEL[ev.kind],
      "No Trx": ev.transactionNumber,
      Kasir: ev.cashierName ?? "—",
      Customer: ev.customerName ?? "—",
      "Total Impact": ev.amountImpact,
      "COGS Impact": ev.cogsImpact,
      "Item Count": ev.itemCount,
      Approver: ev.approverName ?? "—",
      Alasan: ev.reason ?? "—",
    });
  }

  // Empty separator
  records.push({});

  // Grand totals per kind
  records.push({ Waktu: "RINGKASAN PER JENIS" });
  records.push({
    Jenis: "Refund Full",
    "Item Count": totals.refundFullCount,
    "Total Impact": totals.refundFullAmount,
  });
  records.push({
    Jenis: "Refund Partial",
    "Item Count": totals.refundPartialCount,
    "Total Impact": totals.refundPartialAmount,
  });
  records.push({
    Jenis: "Void",
    "Item Count": totals.voidCount,
    "Total Impact": totals.voidAmount,
  });
  records.push({
    Jenis: "Compliment",
    "Item Count": totals.complimentCount,
    "Total Impact": totals.complimentAmount,
    "COGS Impact": totals.complimentCogsImpact,
  });
  records.push({});
  records.push({
    Jenis: "GRAND TOTAL",
    "Item Count": totals.grandEventCount,
    "Total Impact": totals.grandAmount,
  });

  return Papa.unparse(records, { newline: "\n" });
}
