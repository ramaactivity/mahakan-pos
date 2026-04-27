import { getPrinterClient } from "./bluetooth";
import { buildReceipt } from "./receipt-builder";
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
  | { ok: false; reason: "not_paired" | "send_failed"; message: string };

/**
 * Render a transaction to ESC/POS bytes and stream to the paired printer.
 *
 * Returns a structured outcome instead of throwing so callers can decide
 * how loud to be. The auto-print on payment uses this in best-effort mode
 * (silent on `not_paired`); the explicit "Cetak Ulang" buttons surface the
 * outcome via toast.
 */
export async function printTransactionReceipt(
  trx: TransactionWithItems,
  cashierName: string,
): Promise<PrintOutcome> {
  const printer = getPrinterClient();
  if (!printer.isPaired()) {
    return {
      ok: false,
      reason: "not_paired",
      message: "Printer belum di-pair. Buka Settings → Thermal Printer.",
    };
  }
  try {
    const bytes = buildReceipt({
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
    await printer.send(bytes);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "send_failed",
      message: e instanceof Error ? e.message : "Gagal kirim ke printer",
    };
  }
}
