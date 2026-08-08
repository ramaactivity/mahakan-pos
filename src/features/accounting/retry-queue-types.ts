/**
 * Sesi AE-62w — pure types/constants untuk journal retry queue.
 * Split dari retry-queue.ts ("use server") karena file actions tidak boleh
 * export non-async fn (Next.js rule).
 */

import type { journalRetryQueue } from "@/db/schema";

export const RETRY_QUEUE_HOOK_LABELS = [
  "pos_sale",
  "pos_void",
  "pos_refund",
  "expense_create",
  /* Audit AE-186 — sinkron jurnal saat expense/income diedit/dihapus. */
  "expense_void",
  "expense_resync",
  "income_create",
  "income_void",
  "income_resync",
  "opname_adjustment",
  /* Sesi AE-193 — jurnal penjualan harian. Wajib retryable: kalau gagal saat
   * tutup shift, SATU HARI penuh penjualan hilang dari buku besar sekaligus
   * (bukan satu transaksi seperti dulu), jadi jaring pengamannya harus ada. */
  "pos_daily_sales",
] as const;

export type RetryQueueHookLabel = (typeof RETRY_QUEUE_HOOK_LABELS)[number];

export function isRetryableHookLabel(
  label: string,
): label is RetryQueueHookLabel {
  return (RETRY_QUEUE_HOOK_LABELS as readonly string[]).includes(label);
}

export type JournalRetryQueueRow = typeof journalRetryQueue.$inferSelect;

export interface ListJournalQueueOptions {
  status?: "pending" | "resolved" | "abandoned" | "all";
  limit?: number;
}

/** Label/value pair berbahasa manusia untuk blok "Detail Transaksi" di UI. */
export interface SourceContextField {
  label: string;
  value: string;
}

export interface JournalRetryQueueListRow extends JournalRetryQueueRow {
  lastRetryByName: string | null;
  resolvedByName: string | null;
  abandonedByName: string | null;
  hookDisplayName: string;
  /** Ringkasan bisnis 1 baris, mis. "Transaksi MHK-0123 — Rp 85.000 (QRIS),
   * kasir Bayu". Null kalau source record tidak ketemu / args tidak lengkap. */
  sourceSummary: string | null;
  /** Detail transaksi sumber (nomor, nominal, kasir, dst) — supaya finance/
   * accounting/inventory paham jurnal pending ini milik aksi apa SEBELUM
   * klik Retry, tanpa harus baca error coding / args snapshot. */
  sourceContext: SourceContextField[];
}

export interface EnqueueJournalFailureInput {
  outletId: string;
  hookLabel: RetryQueueHookLabel;
  hookArgs: Record<string, unknown>;
  sourceType?: string;
  sourceId?: string;
  error: unknown;
}
