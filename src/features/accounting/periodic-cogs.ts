import type { JournalLineInput } from "./posting";

/**
 * Sesi AE-260 — periodic inventory: a sale must not touch Persediaan.
 *
 * The POS mappers always emit HPP and Persediaan as matched pairs (Dr 51xx /
 * Cr 114x per bucket on a sale, the mirror image on a refund), so dropping
 * both sides keeps the entry balanced. COGS is recognised once a month by
 * Tutup Periode: stok awal + pembelian − stok akhir.
 */
const PERPETUAL_COGS_CODES = new Set([
  "5101",
  "5102",
  "5103",
  "1140",
  "1141",
  "1142",
]);

export function stripPerpetualCogsLines(
  lines: JournalLineInput[],
): JournalLineInput[] {
  return lines.filter(
    (l) => !l.accountCode || !PERPETUAL_COGS_CODES.has(l.accountCode),
  );
}
