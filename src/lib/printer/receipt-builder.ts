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
  /** Optional 1-3 lines printed above the outlet name (promo banners). */
  headerLines?: string[];
  /** Optional WiFi credentials printed in the footer area. */
  wifiSsid?: string;
  wifiPassword?: string;
  /** Optional 1-3 free-form lines printed after the footer text. */
  extraFooterLines?: string[];
}

export function buildReceipt(d: ReceiptData): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(init());

  // Optional header lines (e.g., promo banners) — printed centered above
  // the outlet name. Owner edits via Settings → Edit Struk modal.
  if (d.headerLines && d.headerLines.length > 0) {
    parts.push(align("center"));
    for (const line of d.headerLines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) parts.push(centerLine(trimmed, COLS));
    }
    parts.push(text("\n"));
  }

  // Header — outlet name centered, bold, 2x tall (1x wide so 22+ char names
  // don't auto-wrap mid-word at 32-col native width).
  parts.push(align("center"));
  parts.push(bold(true));
  parts.push(size(1, 2));
  parts.push(text(`${d.outletName}\n`));
  parts.push(sizeReset());
  parts.push(bold(false));
  if (d.outletAddress) {
    for (const line of wrapAddress(d.outletAddress)) {
      parts.push(centerLine(line, COLS));
    }
  }
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
  parts.push(text(`No   : ${d.transactionNumber}\n`));
  parts.push(text(`Tgl  : ${formatIndonesianDateTime(d.createdAt)}\n`));
  parts.push(
    text(
      `Pager ${d.pagerNumber} | ${
        d.orderType === "dine_in" ? "Dine-in" : "Takeaway"
      }\n`,
    ),
  );
  parts.push(text(`Kasir: ${d.cashierName}\n`));
  parts.push(divider("-", COLS));

  // Items — bold name on own line, mods/notes indented with "- ", price line
  // dual-aligned (unit×qty left, subtotal right).
  for (const item of d.items) {
    const variantLabel = item.variant
      ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
      : "";
    const itemHeader = `${item.quantity}x ${item.name}${variantLabel}`;
    parts.push(bold(true));
    parts.push(text(`${itemHeader}\n`));
    parts.push(bold(false));

    if (item.modifiers.length > 0) {
      const mods = item.modifiers
        .map((m) => m.selectedValue ?? m.modifierSlug)
        .join(", ");
      parts.push(text(`  - ${mods}\n`));
    }
    if (item.openPriceNote) {
      parts.push(text(`  - ${item.openPriceNote}\n`));
    }
    if (item.note) {
      parts.push(text(`  - catatan: ${item.note}\n`));
    }

    const unitWithMod = item.unitPrice + item.modifiersPriceDelta;
    const detailLeft = `  @${formatRupiah(unitWithMod)} x ${item.quantity}`;
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

  // Payment — bold so labels stand out at a glance, uppercase for visual weight.
  parts.push(divider("-", COLS));
  parts.push(bold(true));
  if (d.paymentMethod === "cash") {
    parts.push(
      dualLine("TUNAI", formatRupiah(d.cashReceived ?? 0), COLS),
    );
    parts.push(
      dualLine("KEMBALI", formatRupiah(d.cashChange ?? 0), COLS),
    );
  } else if (d.paymentMethod === "qris") {
    parts.push(text("BAYAR : QRIS\n"));
  } else {
    parts.push(text("BAYAR : KARTU BCA\n"));
  }
  parts.push(bold(false));

  // Footer block — divider, footer text, optional WiFi info, optional extra
  // free-form lines. Skip whole block if nothing to print.
  const hasFooterText = d.footerText && d.footerText.trim().length > 0;
  const hasWifi = d.wifiSsid && d.wifiSsid.trim().length > 0;
  const extraLines =
    d.extraFooterLines?.filter((l) => l.trim().length > 0) ?? [];

  if (hasFooterText || hasWifi || extraLines.length > 0) {
    parts.push(divider("=", COLS));
    parts.push(align("center"));
    if (hasFooterText) {
      parts.push(centerLine(d.footerText!, COLS));
    }
    if (hasWifi) {
      parts.push(text("\n"));
      parts.push(centerLine("WiFi", COLS));
      parts.push(centerLine(`SSID: ${d.wifiSsid}`, COLS));
      if (d.wifiPassword && d.wifiPassword.trim().length > 0) {
        parts.push(centerLine(`Password: ${d.wifiPassword}`, COLS));
      }
    }
    if (extraLines.length > 0) {
      parts.push(text("\n"));
      for (const line of extraLines) {
        parts.push(centerLine(line.trim(), COLS));
      }
    }
    parts.push(align("left"));
  }

  parts.push(feed(4));
  parts.push(cut(false));

  return concat(...parts);
}

function wrapAddress(addr: string): string[] {
  // 58mm printer renders ~32 chars per line. Split address onto ≤2 lines at
  // the comma nearest the midpoint so neither line overflows mid-word.
  if (addr.length <= 32) return [addr];
  const half = Math.floor(addr.length / 2);
  const splitAt = addr.indexOf(",", half - 5);
  if (splitAt > 0 && splitAt < 32) {
    return [addr.slice(0, splitAt).trim(), addr.slice(splitAt + 1).trim().slice(0, 32)];
  }
  // Fallback: hard split at 32 chars boundary.
  return [addr.slice(0, 32).trim(), addr.slice(32, 64).trim()];
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 2)}..` : s;
}
