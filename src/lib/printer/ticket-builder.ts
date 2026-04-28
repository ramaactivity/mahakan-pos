/**
 * Prep ticket builders (kitchen + bar). Filtered by station-mapping per item.
 * No prices — staff prep doesn't need money. Pure functions, no I/O.
 */
import { formatIndonesianDateTime } from "@/lib/date";
import {
  align,
  bold,
  centerLine,
  concat,
  cut,
  divider,
  feed,
  init,
  size,
  sizeReset,
  text,
} from "./esc-pos";
import { categoryToStation, type Station } from "./station-mapping";

const COLS = 32;

export interface PrepTicketItem {
  name: string;
  variant: "hot" | "iced" | null;
  quantity: number;
  note: string | null;
  openPriceNote: string | null;
  modifiers: Array<{ modifierSlug: string; selectedValue: string | null }>;
  categoryName: string;
}

export interface PrepTicketData {
  transactionNumber: string;
  pagerNumber: number;
  orderType: "dine_in" | "takeaway";
  createdAt: Date | string;
  cashierName: string;
  items: PrepTicketItem[];
}

const STATION_LABEL: Record<Station, string> = {
  kitchen: "TIKET DAPUR",
  bar: "TIKET BAR",
};

/**
 * Filter items belonging to a specific station and return the count.
 * Used to skip ticket emission when no items match.
 */
export function filterItemsForStation(
  items: PrepTicketItem[],
  station: Station,
): PrepTicketItem[] {
  return items.filter((it) => categoryToStation(it.categoryName) === station);
}

/**
 * Build a prep ticket bytestream for the given station. Returns null if no
 * items match (caller should skip printing). Always ends with a paper cut.
 */
export function buildPrepTicket(
  d: PrepTicketData,
  station: Station,
): Uint8Array | null {
  const filtered = filterItemsForStation(d.items, station);
  if (filtered.length === 0) return null;

  const parts: Uint8Array[] = [];
  parts.push(init());

  // Big bold station label, centered
  parts.push(align("center"));
  parts.push(bold(true));
  parts.push(size(2, 2));
  parts.push(text(`${STATION_LABEL[station]}\n`));
  parts.push(sizeReset());
  parts.push(bold(false));

  // Pager + order type — emphasised so prep staff can spot quickly
  parts.push(size(1, 2));
  parts.push(
    text(
      `Pager ${d.pagerNumber} | ${
        d.orderType === "dine_in" ? "Dine-in" : "Takeaway"
      }\n`,
    ),
  );
  parts.push(sizeReset());

  parts.push(align("left"));
  parts.push(divider("=", COLS));

  // Meta — transaction number + time + cashier
  parts.push(text(`No   : ${d.transactionNumber}\n`));
  parts.push(text(`Tgl  : ${formatIndonesianDateTime(d.createdAt)}\n`));
  parts.push(text(`Kasir: ${d.cashierName}\n`));
  parts.push(divider("-", COLS));

  // Items — emphasized item lines, quiet "- "-prefixed sub-lines.
  for (const item of filtered) {
    const variantLabel = item.variant
      ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
      : "";
    parts.push(bold(true));
    parts.push(text(`${item.quantity}x ${item.name}${variantLabel}\n`));
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
  }

  parts.push(divider("=", COLS));
  parts.push(align("center"));
  parts.push(centerLine(`Total ${filtered.length} item`, COLS));
  parts.push(align("left"));

  parts.push(feed(4));
  parts.push(cut(false));

  return concat(...parts);
}
