/**
 * Sesi AE-223 — struk TUTUP SHIFT (closing).
 *
 * Owner directive 2026-08-30: kasir perlu bukti fisik saat tutup shift yang
 * memuat pemasukan per channel (Tunai / QRIS / EDC) — TANPA daftar menu yang
 * terjual. Daftar menu sengaja tidak dicetak: strukku jadi panjang, dan yang
 * dicek owner saat serah terima adalah uangnya, bukan itemnya.
 *
 * Pure function — data polos masuk, Uint8Array keluar. Tidak menyentuh DB
 * maupun printer; sama seperti receipt-builder.
 */

import { formatRupiah } from "@/lib/format";
import {
  align,
  bold,
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

export interface ShiftCloseChannel {
  label: string;
  /** Nilai yang tercatat di POS untuk channel ini. */
  amount: number;
  /** Nilai fisik/settlement yang dilaporkan kasir. null = tidak dilaporkan
   * (channel tidak dipakai shift ini) — barisnya tidak dicetak. */
  reported?: number | null;
}

export interface ShiftCloseReceiptData {
  outletName: string;
  outletAddress: string | null;
  cashierName: string;
  openedAt: Date | string;
  closedAt: Date | string | null;
  /** Nomor/urutan shift kalau ada; sekadar penanda di kepala struk. */
  shiftLabel?: string | null;

  /* ---- Pemasukan per channel ---- */
  /** Penjualan tunai menurut POS. */
  incomeCash: number;
  /** Channel non-tunai penjualan POS: QRIS dan EDC/kartu. */
  channels: ShiftCloseChannel[];
  /** Settlement aggregator (GoFood/GrabFood/ShopeeFood) yang dilaporkan
   * kasir. SENGAJA tidak ikut TOTAL INCOME: angka ini bukan transaksi POS
   * shift ini melainkan laporan pencairan, jadi menjumlahkannya akan
   * menghitung ganda dengan modul Online & Cashless. */
  otherSettlements?: Array<{ label: string; amount: number }>;

  /* ---- Kas laci ---- */
  openingCash: number;
  pettyExpenseCash: number;
  pettyIncomeCash: number;
  refundedAmount: number;
  expectedCash: number;
  actualCash: number;

  /* ---- Hitungan transaksi ---- */
  paidCount: number;
  voidedCount: number;
  voidedAmount: number;
  refundedCount: number;

  /** Setoran ke owner kalau kasir mengisinya saat tutup shift. */
  depositAmount?: number | null;
  depositDestination?: string | null;

  notes?: string | null;
  handoverMessage?: string | null;
  /** Penanda cetak ulang, supaya lembar kedua tidak dikira shift lain. */
  reprint?: boolean;
}

/* Printer termal memakai codepage 1-byte: karakter non-ASCII (em-dash,
 * middle dot, emoji dari catatan kasir) tercetak jadi sampah DAN menggeser
 * perataan kolom. Semua teks bebas dilewatkan sini dulu. */
function ascii(s: string): string {
  return (
    s
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00b7/g, "-")
      .replace(/[^\x20-\x7E\n]/g, "")
      /* Emoji yang dibuang meninggalkan spasi ganda di tengah kalimat. */
      .replace(/ {2,}/g, " ")
      .trim()
  );
}

function fmtDateTime(d: Date | string | null): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

function fmtTime(d: Date | string | null): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Total pemasukan = tunai + semua channel non-tunai yang terpakai.
 *
 * Diambil dari angka POS (`amount`), bukan angka lapor kasir, supaya total di
 * struk selalu cocok dengan yang tercatat sistem. Selisih lapor vs POS punya
 * barisnya sendiri di bagian channel.
 */
export function sumShiftIncome(d: {
  incomeCash: number;
  channels: ShiftCloseChannel[];
}): number {
  return d.channels.reduce((acc, c) => acc + c.amount, d.incomeCash);
}

export function buildShiftCloseReceipt(d: ShiftCloseReceiptData): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(init());

  // ---- Kepala ----
  parts.push(align("center"));
  parts.push(bold(true));
  parts.push(size(2, 2));
  parts.push(text("TUTUP SHIFT\n"));
  parts.push(sizeReset());
  parts.push(text(`${ascii(d.outletName)}\n`));
  parts.push(bold(false));
  if (d.outletAddress && d.outletAddress.trim().length > 0) {
    parts.push(text(`${ascii(d.outletAddress)}\n`));
  }
  if (d.reprint) {
    parts.push(text("** CETAK ULANG **\n"));
  }
  parts.push(align("left"));
  parts.push(divider("=", COLS));

  parts.push(text(`Kasir  : ${ascii(d.cashierName)}\n`));
  if (d.shiftLabel && d.shiftLabel.trim().length > 0) {
    parts.push(text(`Shift  : ${d.shiftLabel}\n`));
  }
  parts.push(text(`Buka   : ${fmtDateTime(d.openedAt)}\n`));
  /* Jam tutup dicetak jam saja kalau masih tanggal yang sama; shift yang
   * lewat tengah malam tetap dapat tanggal penuh supaya tidak menyesatkan. */
  const sameDay =
    d.closedAt !== null &&
    fmtDateTime(d.openedAt).slice(0, 11) ===
      fmtDateTime(d.closedAt).slice(0, 11);
  parts.push(
    text(
      `Tutup  : ${sameDay ? fmtTime(d.closedAt) : fmtDateTime(d.closedAt)}\n`,
    ),
  );

  // ---- Pemasukan ----
  parts.push(divider("=", COLS));
  parts.push(bold(true));
  parts.push(text("PEMASUKAN\n"));
  parts.push(bold(false));
  parts.push(dualLine("Tunai", formatRupiah(d.incomeCash), COLS));
  for (const c of d.channels) {
    parts.push(dualLine(c.label, formatRupiah(c.amount), COLS));
    /* Angka lapor kasir hanya dicetak kalau BEDA dari POS — kalau sama,
     * barisnya cuma mengulang dan bikin struk susah dibaca. */
    if (c.reported != null && c.reported !== c.amount) {
      const diff = c.reported - c.amount;
      parts.push(
        dualLine(
          `  lapor ${formatRupiah(c.reported)}`,
          `${diff > 0 ? "+" : "-"}${formatRupiah(Math.abs(diff))}`,
          COLS,
        ),
      );
    }
  }
  parts.push(divider("-", COLS));
  parts.push(bold(true));
  parts.push(dualLine("TOTAL INCOME", formatRupiah(sumShiftIncome(d)), COLS));
  parts.push(bold(false));

  const others = (d.otherSettlements ?? []).filter((o) => o.amount > 0);
  if (others.length > 0) {
    parts.push(text("\n"));
    parts.push(text("Settlement lain (lapor kasir):\n"));
    for (const o of others) {
      parts.push(dualLine(`  ${o.label}`, formatRupiah(o.amount), COLS));
    }
    parts.push(text("*di luar TOTAL INCOME\n"));
  }

  // ---- Kas laci ----
  parts.push(divider("=", COLS));
  parts.push(bold(true));
  parts.push(text("KAS LACI\n"));
  parts.push(bold(false));
  parts.push(dualLine("Kas awal", formatRupiah(d.openingCash), COLS));
  parts.push(dualLine("Penjualan tunai", formatRupiah(d.incomeCash), COLS));
  if (d.refundedAmount > 0) {
    parts.push(dualLine("Refund", `-${formatRupiah(d.refundedAmount)}`, COLS));
  }
  if (d.pettyIncomeCash > 0) {
    parts.push(
      dualLine("Kas masuk", `+${formatRupiah(d.pettyIncomeCash)}`, COLS),
    );
  }
  if (d.pettyExpenseCash > 0) {
    parts.push(
      dualLine("Kas keluar", `-${formatRupiah(d.pettyExpenseCash)}`, COLS),
    );
  }
  parts.push(divider("-", COLS));
  parts.push(dualLine("Kas harusnya", formatRupiah(d.expectedCash), COLS));
  parts.push(dualLine("Kas dihitung", formatRupiah(d.actualCash), COLS));

  const variance = d.actualCash - d.expectedCash;
  parts.push(bold(true));
  parts.push(
    dualLine(
      "SELISIH",
      variance === 0
        ? "PAS"
        : `${variance > 0 ? "+" : "-"}${formatRupiah(Math.abs(variance))}`,
      COLS,
    ),
  );
  parts.push(bold(false));
  if (variance !== 0) {
    parts.push(align("center"));
    parts.push(text(variance > 0 ? "(kas lebih)\n" : "(kas kurang)\n"));
    parts.push(align("left"));
  }

  // ---- Transaksi ----
  parts.push(divider("=", COLS));
  parts.push(bold(true));
  parts.push(text("TRANSAKSI\n"));
  parts.push(bold(false));
  parts.push(dualLine("Lunas", `${d.paidCount}`, COLS));
  if (d.voidedCount > 0) {
    parts.push(
      dualLine(
        "Void",
        `${d.voidedCount} (${formatRupiah(d.voidedAmount)})`,
        COLS,
      ),
    );
  }
  if (d.refundedCount > 0) {
    parts.push(
      dualLine(
        "Refund",
        `${d.refundedCount} (${formatRupiah(d.refundedAmount)})`,
        COLS,
      ),
    );
  }

  // ---- Setoran ----
  if (d.depositAmount != null && d.depositAmount > 0) {
    parts.push(divider("=", COLS));
    parts.push(bold(true));
    parts.push(text("SETORAN KE OWNER\n"));
    parts.push(bold(false));
    parts.push(dualLine("Jumlah", formatRupiah(d.depositAmount), COLS));
    if (d.depositDestination && d.depositDestination.trim().length > 0) {
      parts.push(text(`Tujuan : ${ascii(d.depositDestination)}\n`));
    }
    parts.push(text("Menunggu verifikasi owner.\n"));
  }

  // ---- Catatan ----
  if (d.notes && d.notes.trim().length > 0) {
    parts.push(divider("=", COLS));
    parts.push(text("CATATAN\n"));
    parts.push(text(`${ascii(d.notes.trim())}\n`));
  }
  if (d.handoverMessage && d.handoverMessage.trim().length > 0) {
    parts.push(divider("-", COLS));
    parts.push(text("PESAN SHIFT BERIKUT\n"));
    parts.push(text(`${ascii(d.handoverMessage.trim())}\n`));
  }

  // ---- Tanda tangan ----
  parts.push(divider("=", COLS));
  parts.push(text("\n"));
  parts.push(dualLine("Kasir", "Penerima", COLS));
  parts.push(text("\n\n"));
  parts.push(dualLine("(..........)", "(..........)", COLS));

  parts.push(feed(3));
  parts.push(cut());
  return concat(...parts);
}
