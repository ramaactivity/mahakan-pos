/**
 * Audit POS E2E 2026-06-12 — Ringkasan Tutup Shift.
 *
 * Pure text builder untuk laporan tutup shift (kirim WA owner / salin).
 * Sebelumnya tidak ada export ringkasan sama sekali — jejak cuma lewat
 * jurnal + audit log + notif variance ≥ 50rb. Dipakai CloseShiftModal
 * (step sukses) dan bisa dipakai ulang backoffice nanti.
 *
 * Pure: tidak akses Date.now/DB — semua dari row shift (post-close) +
 * ShiftSummary hasil closeShift. Format WA: *bold* per section.
 */

import { formatRupiah } from "@/lib/format";
import type { Shift, ShiftSummary } from "./types";

function fmtTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

export function buildShiftCloseSummaryText(args: {
  shift: Shift;
  summary: ShiftSummary;
  cashierName: string;
  outletName?: string | null;
}): string {
  const { shift, summary, cashierName } = args;
  const variance = shift.variance ?? 0;
  const varianceLabel =
    variance === 0
      ? "Rp 0 (pas) ✅"
      : `${variance > 0 ? "+" : "-"}${formatRupiah(Math.abs(variance))} ${
          variance > 0 ? "(lebih) ⚠️" : "(kurang) ⚠️"
        }`;

  const lines: string[] = [];
  lines.push(`*TUTUP SHIFT ${args.outletName?.toUpperCase() ?? "MAHAKAN"}*`);
  lines.push(`Kasir: ${cashierName}`);
  lines.push(
    `${fmtDate(shift.openedAt)} · ${fmtTime(shift.openedAt)}–${fmtTime(shift.closedAt)} WIB`,
  );
  lines.push("");
  lines.push("*KAS DRAWER*");
  lines.push(`Kas awal: ${formatRupiah(shift.openingCash)}`);
  lines.push(`Penjualan tunai: ${formatRupiah(summary.paid.cash)}`);
  if (summary.refunded.count > 0) {
    lines.push(`Refund: -${formatRupiah(summary.refunded.totalAmount)}`);
  }
  if (summary.pettyExpenseCash > 0) {
    lines.push(`Kas keluar: -${formatRupiah(summary.pettyExpenseCash)}`);
  }
  if (summary.pettyIncomeCash > 0) {
    lines.push(`Kas masuk: +${formatRupiah(summary.pettyIncomeCash)}`);
  }
  lines.push(`Kas seharusnya: ${formatRupiah(summary.expectedCash)}`);
  lines.push(`Kas dihitung: ${formatRupiah(shift.actualCash ?? 0)}`);
  lines.push(`Selisih: ${varianceLabel}`);

  const settlements: string[] = [];
  if (shift.qrisSettlement != null)
    settlements.push(`QRIS: ${formatRupiah(shift.qrisSettlement)}`);
  if (shift.edcSettlement != null)
    settlements.push(`EDC: ${formatRupiah(shift.edcSettlement)}`);
  if (shift.gofoodSettlement != null)
    settlements.push(`GoFood: ${formatRupiah(shift.gofoodSettlement)}`);
  if (shift.grabfoodSettlement != null)
    settlements.push(`GrabFood: ${formatRupiah(shift.grabfoodSettlement)}`);
  if (shift.shopeefoodSettlement != null)
    settlements.push(`ShopeeFood: ${formatRupiah(shift.shopeefoodSettlement)}`);
  if (settlements.length > 0) {
    lines.push("");
    lines.push("*NON-TUNAI (settlement)*");
    lines.push(...settlements);
  }

  lines.push("");
  lines.push("*TRANSAKSI*");
  const trxParts = [`${summary.paid.count} lunas`];
  if (summary.voided.count > 0)
    trxParts.push(
      `${summary.voided.count} void (${formatRupiah(summary.voided.totalAmount)})`,
    );
  if (summary.refunded.count > 0)
    trxParts.push(
      `${summary.refunded.count} refund (${formatRupiah(summary.refunded.totalAmount)})`,
    );
  lines.push(trxParts.join(" · "));

  if (summary.depositId) {
    lines.push("");
    lines.push("*SETORAN*");
    lines.push("Setoran tercatat — menunggu verifikasi owner.");
  } else if (summary.depositError) {
    lines.push("");
    lines.push("*SETORAN*");
    lines.push(
      `⚠️ Setoran BELUM tercatat (${summary.depositError.message}) — input manual di Setoran Tunai.`,
    );
  }

  if (shift.notes) {
    lines.push("");
    lines.push(`Catatan: ${shift.notes}`);
  }
  if (shift.handoverMessage) {
    lines.push(`Pesan shift berikut: ${shift.handoverMessage}`);
  }

  return lines.join("\n");
}

/** "0812..." / "+62812..." → "62812..." untuk path wa.me. */
export function normalizePhoneForWa(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}
