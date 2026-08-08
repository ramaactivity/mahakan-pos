/**
 * Sesi AE-193 — jurnal penjualan HARIAN: bagian murni (tanpa DB/React).
 *
 * Latar: satu journal entry per transaksi POS membuat 72% entry dan 86% baris
 * buku besar berasal dari POS, dan menambah kerja tulis di jalur pembayaran
 * yang paling sensitif. Owner minta jurnal dibuat per akhir shift/hari saja.
 *
 * Yang diringkas HANYA penjualan (`pos_sale`) dan compliment. Refund tetap
 * punya jurnal sendiri per kejadian, karena refund adalah peristiwa ekonomi di
 * TANGGAL REFUND — bukan koreksi tanggal penjualannya.
 *
 * Kunci ketelitian: pengelompokan memakai tanggal kalender WIB dari
 * `transactions.created_at`, BUKAN tanggal shift ditutup. Shift di sini biasa
 * buka jam 10 pagi dan tutup lewat tengah malam (26 dari 82 shift), jadi
 * memakai tanggal tutup akan menggeser 632 dari 1.752 transaksi ke hari yang
 * salah — sebagian lompat bulan dan merusak tutup buku.
 */

import type { AggregatedItem } from "./mapping/categoryMapper";
import type {
  PosSaleInput,
  SplitPaymentRow,
} from "./mapping/posSale";
import type { PosComplimentInput } from "./mapping/posCompliment";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD menurut kalender WIB (UTC+7, tanpa DST). */
export function jakartaDateOf(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Semua tanggal kalender WIB yang disentuh satu shift. Shift yang buka 09 Agu
 * 10:00 dan tutup 10 Agu 01:30 menyentuh DUA tanggal, jadi menghasilkan dua
 * batch jurnal.
 *
 * `closedAt` boleh null (shift masih terbuka) — dianggap sampai `now`.
 * Dibatasi 31 hari sebagai pengaman kalau ada shift yatim yang tak pernah
 * ditutup; sisanya diurus sapuan berkala.
 */
export function datesTouchedByShift(
  openedAt: Date | string,
  closedAt: Date | string | null,
  now: Date,
): string[] {
  const startIso = jakartaDateOf(openedAt);
  const endIso = jakartaDateOf(closedAt ?? now);
  if (!startIso || !endIso || startIso > endIso) {
    return startIso ? [startIso] : [];
  }
  const out: string[] = [];
  let t = new Date(`${startIso}T00:00:00Z`).getTime();
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  for (let guard = 0; t <= end && guard < 31; guard += 1) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += MS_PER_DAY;
  }
  return out;
}

/** Metode pembayaran yang punya akun kas/piutang sendiri. */
export type SettleMethod = SplitPaymentRow["paymentMethod"];

export interface DailyPaymentTotal {
  paymentMethod: SettleMethod;
  amount: number;
}

export interface DailyCategoryTotal {
  itemCategoryName: string;
  amount: number;
  cogs: number;
}

export interface DailySalesAggregate {
  entryDate: string;
  outletId: string;
  transactionCount: number;
  /** transactions.total dijumlah (sudah net diskon). */
  total: number;
  /** transactions.subtotal dijumlah (sebelum diskon). */
  subtotal: number;
  discountAmount: number;
  payments: DailyPaymentTotal[];
  categories: DailyCategoryTotal[];
}

export interface DailyComplimentAggregate {
  entryDate: string;
  outletId: string;
  transactionCount: number;
  categories: DailyCategoryTotal[];
}

export class DailyAggregateError extends Error {}

/**
 * Ubah agregat harian menjadi input `mapPosSale` yang sudah teruji.
 *
 * Trik-nya: pakai cabang `split` dengan daftar total per metode bayar untuk
 * SATU HARI penuh. Bentuknya persis sama dengan transaksi split biasa, jadi
 * pemetaan akun, penyerapan diskon, dan pengecekan neraca tidak perlu ditulis
 * ulang sama sekali.
 */
export function toDailySaleInput(
  agg: DailySalesAggregate,
  batchId: string,
): PosSaleInput {
  const payments = agg.payments.filter((p) => p.amount !== 0);
  if (payments.length === 0) {
    throw new DailyAggregateError("DAILY_SALES_NO_PAYMENTS");
  }

  const paymentSum = payments.reduce((s, p) => s + p.amount, 0);
  if (paymentSum !== agg.total) {
    throw new DailyAggregateError(
      `DAILY_SALES_PAYMENT_MISMATCH:total=${agg.total},payments=${paymentSum}`,
    );
  }

  /* transactions punya CHECK total = subtotal - discount, jadi ini harus tetap
   * berlaku setelah dijumlah. Kalau tidak, ada baris yang salah tarik — lebih
   * baik gagal keras daripada memposting jurnal timpang. */
  if (agg.total !== agg.subtotal - agg.discountAmount) {
    throw new DailyAggregateError(
      `DAILY_SALES_TOTAL_MISMATCH:total=${agg.total},subtotal=${agg.subtotal},discount=${agg.discountAmount}`,
    );
  }

  const categorySum = agg.categories.reduce((s, c) => s + c.amount, 0);
  if (categorySum !== agg.subtotal) {
    throw new DailyAggregateError(
      `DAILY_SALES_CATEGORY_MISMATCH:subtotal=${agg.subtotal},categories=${categorySum}`,
    );
  }

  return {
    transactionId: batchId,
    transactionNumber: dailyLabel(agg.entryDate, agg.transactionCount),
    outletId: agg.outletId,
    entryDate: agg.entryDate,
    paymentMethod: "split",
    total: agg.total,
    subtotal: agg.subtotal,
    discountAmount: agg.discountAmount,
    items: toAggregatedItems(agg.categories),
    splits: payments.map((p) => ({
      paymentMethod: p.paymentMethod,
      amount: p.amount,
    })),
  };
}

export function toDailyComplimentInput(
  agg: DailyComplimentAggregate,
  batchId: string,
): PosComplimentInput {
  return {
    transactionId: batchId,
    transactionNumber: dailyLabel(agg.entryDate, agg.transactionCount),
    outletId: agg.outletId,
    entryDate: agg.entryDate,
    items: toAggregatedItems(agg.categories),
  };
}

function toAggregatedItems(rows: DailyCategoryTotal[]): AggregatedItem[] {
  return rows.map((c) => ({
    itemCategoryName: c.itemCategoryName,
    amount: c.amount,
    cogs: c.cogs,
  }));
}

/** Label yang dibaca manusia di jurnal — jangan tampilkan UUID batch. */
export function dailyLabel(entryDate: string, transactionCount: number): string {
  return `${entryDate} (${transactionCount} transaksi)`;
}

export function describeDailySales(agg: DailySalesAggregate): string {
  return `Penjualan harian ${dailyLabel(agg.entryDate, agg.transactionCount)}`;
}

export function describeDailyCompliment(
  agg: DailyComplimentAggregate,
): string {
  return `Compliment harian ${dailyLabel(agg.entryDate, agg.transactionCount)}`;
}

export function totalCogsOf(rows: DailyCategoryTotal[]): number {
  return rows.reduce((s, c) => s + c.cogs, 0);
}

/**
 * Apakah tanggal ini sudah masuk rezim jurnal harian?
 *
 * `since` = `outlets.settings.features.dailyJournalSince` (YYYY-MM-DD).
 * null/kosong → tetap perilaku lama (satu jurnal per transaksi), sehingga
 * outlet yang belum mengaktifkan tidak berubah sama sekali.
 */
export function isDailyJournalDate(
  entryDate: string,
  since: string | null | undefined,
): boolean {
  if (!since) return false;
  return entryDate >= since;
}
