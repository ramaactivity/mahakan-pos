import type { PaymentMethod } from "@/features/transactions";

/**
 * Centralized human-readable label for each payment method. Use across UI,
 * receipts, PDF exports, settlement reports — single source of truth so
 * adding a new EDC variant is a one-line change here.
 */
export function paymentMethodLabel(m: PaymentMethod): string {
  switch (m) {
    case "cash":
      return "Tunai";
    case "qris":
      return "QRIS";
    case "card_bca":
      return "Kartu BCA";
    case "card_bni":
      return "Kartu BNI";
    case "card_mandiri":
      return "Kartu Mandiri";
    case "card_bri":
      return "Kartu BRI";
    case "card_other":
      return "Kartu Lainnya";
    case "split":
      return "Split";
  }
}

/**
 * Short label for the printed receipt — uppercase + concise. Used by
 * `receipt-builder.ts` on the "BAYAR :" line.
 */
export function paymentMethodReceiptLabel(m: PaymentMethod): string {
  switch (m) {
    case "cash":
      return "TUNAI";
    case "qris":
      return "QRIS";
    case "card_bca":
      return "KARTU BCA";
    case "card_bni":
      return "KARTU BNI";
    case "card_mandiri":
      return "KARTU MANDIRI";
    case "card_bri":
      return "KARTU BRI";
    case "card_other":
      return "KARTU LAINNYA";
    case "split":
      return "SPLIT (multi-payer)";
  }
}

/**
 * Settlement-channel label used in DailySettlementView. EDC variants
 * collapse into "EDC <bank>" since the settlement view bucket merchandise
 * by payout channel.
 */
export function paymentMethodSettlementLabel(m: PaymentMethod): string {
  switch (m) {
    case "cash":
      return "Cash Drawer";
    case "qris":
      return "QRIS";
    case "card_bca":
      return "EDC BCA";
    case "card_bni":
      return "EDC BNI";
    case "card_mandiri":
      return "EDC Mandiri";
    case "card_bri":
      return "EDC BRI";
    case "card_other":
      return "EDC Lainnya";
    case "split":
      return "Split";
  }
}
