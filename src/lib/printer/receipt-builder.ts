/**
 * Build a printable receipt bytestream from a transaction snapshot.
 *
 * Pure function — takes plain data, returns Uint8Array ready for the
 * Bluetooth transport. No DB / no I/O.
 */

import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import {
  align,
  bold,
  centerLine,
  concat,
  cut,
  divider,
  dualLine,
  feed,
  init,
  size,
  sizeReset,
  text,
} from "./esc-pos";

const COLS = 32;

export interface ReceiptItemModifier {
  modifierSlug: string;
  selectedValue: string | null;
  priceDelta: number;
}

export interface ReceiptItem {
  name: string;
  variant: "hot" | "iced" | null;
  quantity: number;
  unitPrice: number;
  modifiersPriceDelta: number;
  subtotal: number;
  note: string | null;
  openPriceNote: string | null;
  modifiers: ReceiptItemModifier[];
}

export interface ReceiptData {
  outletName: string;
  outletAddress: string | null;
  outletPhone: string | null;
  transactionNumber: string;
  pagerNumber: number;
  orderType: "dine_in" | "takeaway";
  createdAt: Date | string;
  cashierName: string;
  items: ReceiptItem[];
  subtotal: number;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  paymentMethod: "cash" | "qris" | "card_bca";
  cashReceived: number | null;
  cashChange: number | null;
  status: "paid" | "voided" | "refunded";
  footerText: string | null;
}

export function buildReceipt(d: ReceiptData): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(init());

  // Header — outlet name (large, centered, bold)
  parts.push(align("center"));
  parts.push(bold(true));
  parts.push(size(2, 2));
  parts.push(text(`${d.outletName}\n`));
  parts.push(sizeReset());
  parts.push(bold(false));
  if (d.outletAddress) parts.push(centerLine(wrapAddress(d.outletAddress), COLS));
  if (d.outletPhone) parts.push(centerLine(d.outletPhone, COLS));

  parts.push(align("left"));
  parts.push(divider("=", COLS));

  // Status banner if not paid
  if (d.status !== "paid") {
    parts.push(align("center"));
    parts.push(bold(true));
    parts.push(text(`*** ${d.status.toUpperCase()} ***\n`));
    parts.push(bold(false));
    parts.push(align("left"));
    parts.push(divider("=", COLS));
  }

  // Transaction meta
  parts.push(text(`No  : ${d.transactionNumber}\n`));
  parts.push(text(`Tgl : ${formatIndonesianDateTime(d.createdAt)}\n`));
  parts.push(
    text(
      `Pager ${d.pagerNumber} · ${
        d.orderType === "dine_in" ? "Dine-in" : "Takeaway"
      }\n`,
    ),
  );
  parts.push(text(`Kasir: ${d.cashierName}\n`));
  parts.push(divider("-", COLS));

  // Items
  for (const item of d.items) {
    const variantLabel = item.variant
      ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
      : "";
    const itemHeader = `${item.quantity}x ${item.name}${variantLabel}`;
    parts.push(text(`${itemHeader}\n`));

    // Modifiers (sub-line, lighter visual)
    if (item.modifiers.length > 0) {
      const mods = item.modifiers
        .map((m) => m.selectedValue ?? m.modifierSlug)
        .join(" · ");
      parts.push(text(`  ${mods}\n`));
    }
    if (item.openPriceNote) {
      parts.push(text(`  ${item.openPriceNote}\n`));
    }
    if (item.note) {
      parts.push(text(`  catatan: ${item.note}\n`));
    }

    // Price line: unit × qty (+ mod) = subtotal, right-aligned
    const unitWithMod = item.unitPrice + item.modifiersPriceDelta;
    const detailLeft =
      `  ${formatRupiah(unitWithMod)} x ${item.quantity}`;
    parts.push(dualLine(detailLeft, formatRupiah(item.subtotal), COLS));
  }

  parts.push(divider("-", COLS));

  // Totals
  parts.push(dualLine("Subtotal", formatRupiah(d.subtotal), COLS));
  if (d.discountAmount > 0) {
    const discLabel = d.discountReason
      ? `Diskon (${truncate(d.discountReason, 18)})`
      : "Diskon";
    parts.push(dualLine(discLabel, `-${formatRupiah(d.discountAmount)}`, COLS));
  }
  parts.push(bold(true));
  parts.push(dualLine("TOTAL", formatRupiah(d.total), COLS));
  parts.push(bold(false));

  // Payment
  parts.push(divider("-", COLS));
  if (d.paymentMethod === "cash") {
    parts.push(
      dualLine("Tunai", formatRupiah(d.cashReceived ?? 0), COLS),
    );
    parts.push(
      dualLine("Kembali", formatRupiah(d.cashChange ?? 0), COLS),
    );
  } else if (d.paymentMethod === "qris") {
    parts.push(text("Bayar: QRIS\n"));
  } else {
    parts.push(text("Bayar: Kartu BCA\n"));
  }

  // Footer
  if (d.footerText) {
    parts.push(divider("=", COLS));
    parts.push(align("center"));
    parts.push(centerLine(d.footerText, COLS));
    parts.push(align("left"));
  }

  parts.push(feed(3));
  parts.push(cut(false));

  return concat(...parts);
}

function wrapAddress(addr: string): string {
  // 58mm printer renders ~32 chars; address often longer. Keep first ~60 chars,
  // splitting on commas if available so it doesn't truncate mid-word.
  if (addr.length <= 60) return addr;
  const parts = addr.split(",").map((p) => p.trim());
  return parts.slice(0, Math.max(1, parts.length - 1)).join(", ");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
