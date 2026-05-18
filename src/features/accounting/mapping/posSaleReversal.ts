/**
 * mapPosSaleReversal / mapPosSaleCorrection — POS sale correction journal helpers.
 *
 * Sesi AE-62r — fitur Koreksi Transaksi dari Riwayat (kasir ubah paymentMethod
 * dan/atau total nominal pada transaksi paid, owner approve via email code).
 *
 * Strategy: items TIDAK berubah (hanya paymentMethod / total / split breakdown).
 * Karena items unchanged, COGS journal (5101/5102/5103 Dr, 1140/1141/1142 Cr)
 * tidak boleh disentuh — double-counting kalau diulang reverse+repost.
 *
 * Workflow di postJournalForTransactionCorrection:
 *   1. mapPosSaleReversal(originalInput, reason) — Dr↔Cr swap revenue side,
 *      sourceType='pos_sale_reversal', sourceId=correctionId
 *      → mark original pos_sale entry status='reversed'
 *   2. mapPosSaleCorrection(correctedInput, reason) — corrected revenue side,
 *      sourceType='pos_sale_correction', sourceId=correctionId
 *
 * Both helpers reuse `mapPosSale` untuk konsistensi mapping (same allocator
 * for discount, same payment-method-to-account table). Hanya filter out
 * COGS lines + (untuk reversal) swap debit/credit + annotate description.
 *
 * Trap T7 (lihat plan dynamic-sparking-swing.md): COGS lines harus di-strip
 * supaya inventory tidak di-double-reverse + HPP tidak hilang.
 */

import { mapPosSale, type PosSaleInput } from "./posSale";
import type { JournalLineInput } from "../posting";

/** Account codes yang merupakan COGS movement (HPP Dr + Persediaan Cr).
 * Lines dengan account ini harus di-strip dari reversal + repost. */
const COGS_ACCOUNT_CODES = new Set([
  "5101", // HPP makanan
  "5102", // HPP minuman
  "5103", // HPP lain
  "1140", // Persediaan kitchen
  "1141", // Persediaan bar
  "1142", // Persediaan pendukung
]);

function isCogsLine(line: JournalLineInput): boolean {
  return line.accountCode != null && COGS_ACCOUNT_CODES.has(line.accountCode);
}

function stripCogsLines(lines: JournalLineInput[]): JournalLineInput[] {
  return lines.filter((l) => !isCogsLine(l));
}

function swapDebitCredit(line: JournalLineInput): JournalLineInput {
  return {
    accountId: line.accountId,
    accountCode: line.accountCode,
    debit: line.credit ?? 0,
    credit: line.debit ?? 0,
    description: line.description,
    metadata: line.metadata,
  };
}

export interface PosSaleReversalInput extends PosSaleInput {
  /** Reason text dari kasir — di-embed ke description tiap line untuk
   * audit trail visible di journal viewer. */
  reason: string;
}

/**
 * Build reversal entry untuk original pos_sale. Mirror struktur mapPosSale
 * tapi:
 *  - Dr ↔ Cr di-swap (kas yang awalnya Dr → jadi Cr untuk balikin saldo)
 *  - COGS lines (HPP + Persediaan) di-strip karena items unchanged
 *  - Description di-prefix "REVERSE: ..." dengan reason
 *
 * Input harus mirror snapshot original sale (paymentMethod, total, subtotal,
 * discountAmount, items, splits). Caller fetch dari transaction_corrections
 * snapshot fields (originalPaymentMethod, originalTotal, dst).
 */
export function mapPosSaleReversal(
  input: PosSaleReversalInput,
): JournalLineInput[] {
  const fullLines = mapPosSale(input);
  const revenueOnly = stripCogsLines(fullLines);
  const swapped = revenueOnly.map(swapDebitCredit);
  return swapped.map((l) => ({
    ...l,
    description: `REVERSE: ${l.description ?? "Penjualan"} (Koreksi: ${input.reason})`,
  }));
}

export interface PosSaleCorrectionInput extends PosSaleInput {
  reason: string;
}

/**
 * Build corrected-repost entry — sama dengan mapPosSale tapi tanpa COGS lines
 * (items tidak berubah, COGS sudah ter-handle di original entry yang sekarang
 * status='posted' tetap valid untuk movement). Description di-prefix "KOREKSI: ..."
 * dengan reason.
 *
 * Input dipakai paymentMethod/total/subtotal/discountAmount/splits CORRECTED,
 * tapi items snapshot original (untuk bucket aggregation).
 */
export function mapPosSaleCorrection(
  input: PosSaleCorrectionInput,
): JournalLineInput[] {
  const fullLines = mapPosSale(input);
  const revenueOnly = stripCogsLines(fullLines);
  return revenueOnly.map((l) => ({
    ...l,
    description: `KOREKSI: ${l.description ?? "Penjualan"} (${input.reason})`,
  }));
}
