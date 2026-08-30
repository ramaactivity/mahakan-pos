/**
 * Sesi AE-223 — susun data struk tutup shift dari hasil closeShift.
 *
 * Dipisah dari CloseShiftModal supaya bisa diuji tanpa React/printer, dan
 * supaya cetak-ulang (tombol) dan cetak-otomatis (saat tutup) memakai sumber
 * angka yang PERSIS sama — kalau dua jalur ini menyusun datanya sendiri-sendiri,
 * lembar kedua bisa beda isi dari lembar pertama tanpa ada yang sadar.
 */

import type { ShiftCloseReceiptData } from "@/lib/printer/shift-close-builder";
import type { Shift, ShiftSummary } from "./types";

export function buildShiftCloseReceiptData(args: {
  shift: Shift;
  summary: ShiftSummary;
  cashierName: string;
  outletName: string;
  outletAddress: string | null;
  /** Nominal setoran ke owner yang kasir isi di modal tutup shift. Tidak ada
   * di ShiftSummary (hanya id/error-nya), jadi dioper dari layar. */
  depositAmount?: number | null;
  depositDestination?: string | null;
  reprint?: boolean;
}): ShiftCloseReceiptData {
  const { shift, summary } = args;
  return {
    outletName: args.outletName,
    outletAddress: args.outletAddress,
    cashierName: args.cashierName,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    shiftLabel: shift.id.slice(0, 8).toUpperCase(),

    incomeCash: summary.paid.cash,
    channels: [
      {
        label: "QRIS",
        amount: summary.paid.qris,
        reported: shift.qrisSettlement,
      },
      /* paid.cardBca menampung SEMUA kartu (BCA/BNI/Mandiri/BRI/lain), jadi
       * labelnya "EDC" saja — menulis "EDC BCA" akan salah begitu ada kartu
       * bank lain masuk. */
      {
        label: "EDC / Kartu",
        amount: summary.paid.cardBca,
        reported: shift.edcSettlement,
      },
    ],
    otherSettlements: [
      { label: "GoFood", amount: shift.gofoodSettlement ?? 0 },
      { label: "GrabFood", amount: shift.grabfoodSettlement ?? 0 },
      { label: "ShopeeFood", amount: shift.shopeefoodSettlement ?? 0 },
    ],

    openingCash: shift.openingCash,
    pettyExpenseCash: summary.pettyExpenseCash,
    pettyIncomeCash: summary.pettyIncomeCash,
    refundedAmount: summary.refunded.totalAmount,
    expectedCash: summary.expectedCash,
    actualCash: shift.actualCash ?? 0,

    paidCount: summary.paid.count,
    voidedCount: summary.voided.count,
    voidedAmount: summary.voided.totalAmount,
    refundedCount: summary.refunded.count,

    depositAmount: args.depositAmount ?? null,
    depositDestination: args.depositDestination ?? null,

    notes: shift.notes,
    handoverMessage: shift.handoverMessage,
    reprint: args.reprint ?? false,
  };
}
