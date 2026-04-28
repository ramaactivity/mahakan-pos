import { getPrinterClient } from "./bluetooth";
import { concat } from "./esc-pos";
import { buildReceipt } from "./receipt-builder";
import { categoryToStation } from "./station-mapping";
import { buildPrepTicket } from "./ticket-builder";
import type { TransactionWithItems } from "@/features/transactions";

/**
 * Outlet metadata for the receipt header. Sourced from PRD §12 — should
 * eventually be read from `outlets.settings` instead of hardcoded so Owner
 * edits via Settings UI take effect on receipts. Tracked as Phase 2 polish.
 */
const OUTLET_META = {
  name: "Mahakan Coffee & Space",
  address: "Puncak Rd KM 22, Cisarua, Bogor Regency, West Java 16750",
  phone: "0838-1977-5665",
  footer: "Terima kasih, sampai jumpa!",
} as const;

export type PrintOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "not_paired" | "send_failed" | "no_match";
      message: string;
    };

export type TicketSection = "customer" | "kitchen" | "bar";

export interface StationCoverage {
  hasKitchen: boolean;
  hasBar: boolean;
}

/**
 * Inspect transaction items to figure out which prep-station tickets are
 * applicable. Used by UI to enable/disable per-station print buttons.
 */
export function getStationCoverage(
  trx: TransactionWithItems,
): StationCoverage {
  let hasKitchen = false;
  let hasBar = false;
  for (const item of trx.items) {
    const station = categoryToStation(item.itemCategoryName);
    if (station === "kitchen") hasKitchen = true;
    else if (station === "bar") hasBar = true;
  }
  return { hasKitchen, hasBar };
}

function buildCustomerBytes(
  trx: TransactionWithItems,
  cashierName: string,
): Uint8Array {
  return buildReceipt({
    outletName: OUTLET_META.name,
    outletAddress: OUTLET_META.address,
    outletPhone: OUTLET_META.phone,
    transactionNumber: trx.transactionNumber,
    pagerNumber: trx.pagerNumber,
    orderType: trx.orderType,
    createdAt: trx.createdAt,
    cashierName,
    items: trx.items.map((item) => ({
      name: item.itemName,
      variant: item.variant,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      modifiersPriceDelta: item.modifiersPriceDelta,
      subtotal: item.subtotal,
      note: item.note,
      openPriceNote: item.openPriceNote,
      modifiers: item.modifiers.map((m) => ({
        modifierSlug: m.modifierSlug,
        selectedValue: m.selectedValue,
        priceDelta: m.priceDelta,
      })),
    })),
    subtotal: trx.subtotal,
    discountAmount: trx.discountAmount,
    discountReason: trx.discountReason,
    total: trx.total,
    paymentMethod: trx.paymentMethod,
    cashReceived: trx.cashReceived,
    cashChange: trx.cashChange,
    status: trx.status,
    footerText: OUTLET_META.footer,
  });
}

function buildPrepBytes(
  trx: TransactionWithItems,
  cashierName: string,
  station: "kitchen" | "bar",
): Uint8Array | null {
  return buildPrepTicket(
    {
      transactionNumber: trx.transactionNumber,
      pagerNumber: trx.pagerNumber,
      orderType: trx.orderType,
      createdAt: trx.createdAt,
      cashierName,
      items: trx.items.map((item) => ({
        name: item.itemName,
        variant: item.variant,
        quantity: item.quantity,
        note: item.note,
        openPriceNote: item.openPriceNote,
        categoryName: item.itemCategoryName,
        modifiers: item.modifiers.map((m) => ({
          modifierSlug: m.modifierSlug,
          selectedValue: m.selectedValue,
        })),
      })),
    },
    station,
  );
}

/**
 * Render selected ticket sections and stream to the paired printer.
 *
 * Splits per-section so the cashier prints only what they need at the moment:
 * - Customer receipt = struk hand-off to customer
 * - Kitchen ticket = food prep, given to chef
 * - Bar ticket = drink prep, given to barista
 *
 * Auto-print on payment uses ["customer"] only — prep tickets must be
 * triggered explicitly via the Pesanan queue or PaidPanel buttons. This
 * separation matches kasir workflow where customer receipt is needed
 * immediately for tear-and-give but prep tickets fire when the kasir is
 * ready to call out the order to staff.
 */
export async function printTickets(
  trx: TransactionWithItems,
  cashierName: string,
  sections: TicketSection[],
): Promise<PrintOutcome> {
  if (sections.length === 0) {
    return {
      ok: false,
      reason: "no_match",
      message: "Tidak ada tiket dipilih",
    };
  }
  const printer = getPrinterClient();
  if (!printer.isPaired()) {
    return {
      ok: false,
      reason: "not_paired",
      message: "Printer belum di-pair. Buka Settings → Thermal Printer.",
    };
  }
  try {
    const stream: Uint8Array[] = [];

    if (sections.includes("kitchen")) {
      const bytes = buildPrepBytes(trx, cashierName, "kitchen");
      if (bytes) stream.push(bytes);
    }
    if (sections.includes("bar")) {
      const bytes = buildPrepBytes(trx, cashierName, "bar");
      if (bytes) stream.push(bytes);
    }
    if (sections.includes("customer")) {
      stream.push(buildCustomerBytes(trx, cashierName));
    }

    if (stream.length === 0) {
      return {
        ok: false,
        reason: "no_match",
        message: "Transaksi ini tidak punya item untuk station yang dipilih",
      };
    }

    await printer.send(concat(...stream));
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "send_failed",
      message: e instanceof Error ? e.message : "Gagal kirim ke printer",
    };
  }
}

/**
 * Backwards-compat wrapper. Existing call sites that haven't migrated to
 * `printTickets()` yet still pull all three sections like before.
 * @deprecated Use `printTickets(trx, cashierName, sections)` directly.
 */
export async function printTransactionReceipt(
  trx: TransactionWithItems,
  cashierName: string,
): Promise<PrintOutcome> {
  return printTickets(trx, cashierName, ["customer", "kitchen", "bar"]);
}
