/**
 * Sesi AE-47 — pure helper untuk validate split_payments paymentMethod
 * di journal mapping. No DB, no `server-only` — unit-testable.
 *
 * Background: hooks.ts journal mapper dulu pakai `filter` yang silent
 * drop split row dengan paymentMethod tidak dikenali. Effect: journal
 * lines incomplete → GL undercounted → owner tidak visibility.
 *
 * Sekarang gunakan `validateSplitPaymentMethods` di awal mapper. Kalau
 * ada row invalid, throw Error dengan detail row IDs. fireJournalHook
 * (AE-46) catch error + audit log `journal.posting_failed` → owner liat
 * di Back Office.
 */

export interface SplitPaymentRowMinimal {
  id: string;
  paymentMethod: string | null;
}

export interface InvalidSplitRowReport {
  id: string;
  paymentMethod: string | null;
}

/**
 * Cari split rows dengan paymentMethod yang TIDAK ada di `validMethods`.
 * Return list — kalau kosong = semua valid, kalau berisi = caller harus
 * throw atau handle error.
 *
 * Designed sebagai pure check (no throw inside) supaya caller bisa
 * decide error format (mis. include transactionId context).
 */
export function findInvalidSplitMethods<T extends SplitPaymentRowMinimal>(
  splits: T[],
  validMethods: readonly string[],
): InvalidSplitRowReport[] {
  const validSet = new Set(validMethods);
  const invalid: InvalidSplitRowReport[] = [];
  for (const s of splits) {
    if (!s.paymentMethod || !validSet.has(s.paymentMethod)) {
      invalid.push({ id: s.id, paymentMethod: s.paymentMethod });
    }
  }
  return invalid;
}

/**
 * Format error message dari invalid rows, truncated ke 8 char per ID
 * untuk readability. Dipakai di throw caller.
 */
export function formatInvalidSplitMethodsError(
  invalid: InvalidSplitRowReport[],
  context: string,
): string {
  const detail = invalid
    .map(
      (r) =>
        `${r.id.slice(0, 8)}:${r.paymentMethod ?? "<null>"}`,
    )
    .join(", ");
  return `SPLIT_UNKNOWN_PAYMENT_METHOD (${context}): ${invalid.length} row invalid → ${detail}`;
}
