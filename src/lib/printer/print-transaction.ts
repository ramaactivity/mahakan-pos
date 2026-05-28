import { getPrinterClient } from "./bluetooth";
import { concat } from "./esc-pos";
import { buildReceipt } from "./receipt-builder";
import { categoryToStation } from "./station-mapping";
import { buildPrepTicket } from "./ticket-builder";
import type { TransactionWithItems } from "@/features/transactions";

const DEFAULT_FOOTER_TEXT = "Terima kasih, sampai jumpa!";

export interface ReceiptConfig {
  outletName: string;
  outletAddress: string | null;
  outletPhone: string | null;
  /** Optional 1-3 lines printed above the outlet name (promo banners). */
  headerLines?: string[];
  /** Footer text — default "Terima kasih, sampai jumpa!". */
  footerText?: string;
  /** Optional 1-3 free-form lines printed after the footer. */
  extraFooterLines?: string[];
  /** Optional WiFi info printed in the footer area. */
  wifiSsid?: string;
  wifiPassword?: string;
}

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
  config: ReceiptConfig,
): Uint8Array {
  return buildReceipt({
    outletName: config.outletName,
    outletAddress: config.outletAddress,
    outletPhone: config.outletPhone,
    transactionNumber: trx.transactionNumber,
    pagerNumber: trx.pagerNumber,
    orderType: trx.orderType,
    createdAt: trx.createdAt,
    cashierName,
    customerName: trx.customerName,
    note: trx.note ?? null,
    memberPhone: trx.member?.phone ?? null,
    memberTotalPoints: trx.member?.totalPoints ?? null,
    pointsEarned: trx.loyaltyPointsEarned ?? null,
    pointsRedeemed: trx.loyaltyPointsRedeemed ?? null,
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
    /* Sesi AE-156d — Pass splits ke receipt builder supaya breakdown
     * render kalau paymentMethod="split". TransactionWithItems include
     * splits dari fetchTransactionById. */
    splits:
      trx.paymentMethod === "split" && trx.splits
        ? trx.splits.map((s) => ({
            paymentMethod: s.paymentMethod as
              | "cash"
              | "qris"
              | "card_bca"
              | "card_bni"
              | "card_mandiri"
              | "card_bri"
              | "card_other",
            amount: s.amount,
            cashReceived: s.cashReceived,
            cashChange: s.cashChange,
          }))
        : undefined,
    status: trx.status,
    footerText: config.footerText ?? null,
    headerLines: config.headerLines,
    wifiSsid: config.wifiSsid,
    wifiPassword: config.wifiPassword,
    extraFooterLines: config.extraFooterLines,
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
      customerName: trx.customerName,
      note: trx.note ?? null,
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
  config: ReceiptConfig,
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
      stream.push(buildCustomerBytes(trx, cashierName, config));
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

/** Convert outlet DB row into ReceiptConfig consumed by printTickets. */
export function outletToReceiptConfig(outlet: {
  name: string;
  address: string | null;
  phone: string | null;
  settings?:
    | {
        receipt?: {
          footerText?: string;
          headerLines?: string[];
          wifiSsid?: string;
          wifiPassword?: string;
          extraFooterLines?: string[];
        };
      }
    | null;
}): ReceiptConfig {
  const r = outlet.settings?.receipt ?? {};
  return {
    outletName: outlet.name,
    outletAddress: outlet.address,
    outletPhone: outlet.phone,
    headerLines: r.headerLines ?? [],
    footerText: r.footerText ?? DEFAULT_FOOTER_TEXT,
    extraFooterLines: r.extraFooterLines ?? [],
    wifiSsid: r.wifiSsid,
    wifiPassword: r.wifiPassword,
  };
}
