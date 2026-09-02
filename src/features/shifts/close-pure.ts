/**
 * Pure aggregation helper untuk shift close. No DB, no `server-only` —
 * unit-testable dari any context.
 *
 * Sesi AE-44 (audit fix) — extracted dari actions.ts supaya bisa
 * di-cover dengan tests. Bug original: partial_refunded transaction
 * tidak masuk perhitungan paidCash / refundedCash → expectedCash salah
 * → variance alarm palsu di shift close.
 */

export type ShiftTxnStatus =
  | "paid"
  | "voided"
  | "refunded"
  | "partially_refunded"
  | "open";

export interface ShiftTxnSplitRow {
  paymentMethod: string;
  amount: number;
}

export interface ShiftTxnRow {
  status: ShiftTxnStatus;
  paymentMethod: string;
  total: number;
  refundedAmount: number;
  /** Sesi AE-155 — splits untuk transaksi dengan paymentMethod="split".
   *  Required saat paymentMethod="split"; null/empty untuk single-method
   *  trx. Helper akan iterate splits dan aggregate per-method ke
   *  paidCash/paidQris/paidCard. Tanpa field ini, split trx ke-skip di
   *  expected cash calculation → variance alarm palsu. */
  splits?: ShiftTxnSplitRow[];
}

export interface PettyCashSummary {
  /** Total petty expense cash (Rp). Sudah filtered paymentMethod=cash. */
  expenseCash: number;
  expenseCashCount: number;
  /** Total petty income cash (Rp). Sudah filtered paymentMethod=cash. */
  incomeCash: number;
  incomeCashCount: number;
  /** Non-cash petty expenses (transfer/other) — tidak affect drawer
   *  tapi di-track untuk display. */
  expenseNonCash: number;
  expenseNonCashCount: number;
  incomeNonCash: number;
  incomeNonCashCount: number;
}

export interface ShiftCashSummary {
  paidCount: number;
  paidCash: number;
  paidQris: number;
  paidCard: number;
  voidedCount: number;
  voidedAmount: number;
  refundedCount: number;
  refundedAmount: number;
  refundedCash: number;
  /** Sesi AE-49 — petty cash impact pada drawer. expense_cash kurangi
   *  expectedCash, income_cash tambahi. Default 0 = backward-compat. */
  pettyExpenseCash: number;
  pettyIncomeCash: number;
}

/**
 * Aggregate cash/qris/card flows + refund totals dari array transaksi
 * shift. Pure function — input array, output ringkasan.
 *
 * Branch logic:
 *   - paid: original payment baru masuk drawer, belum ada refund.
 *   - voided: tidak masuk drawer (assumed canceled before settlement).
 *   - refunded (full): original payment was received then fully returned.
 *     (Note: existing legacy behavior count -total ke refundedCash;
 *     hasil net drawer impact -total padahal physically 0. Bug pre-existing,
 *     out of scope AE-44 fix per owner directive.)
 *   - partially_refunded: AE-44 NEW BRANCH. Original payment masuk drawer
 *     (paidCash += total) DAN refund cash keluar (refundedCash += refundedAmount).
 *     Net = total - refundedAmount, matches physical drawer.
 */
/**
 * Sesi AE-49 — extend signature dengan petty cash (optional, default 0
 * untuk backward-compat existing tests). Petty cash dihitung di queries
 * caller (filter paymentMethod=cash), lalu di-pass sebagai sums.
 *
 * Formula expectedCash (di caller, mis. closeShift action):
 *   expectedCash = openingCash + paidCash - refundedCash
 *                  - pettyExpenseCash + pettyIncomeCash
 *
 * Pure helper ini cuma agregat transaksi; petty cash di-pass-through
 * supaya field tersedia di summary output untuk display.
 */
export function computeShiftCashSummary(
  txns: ShiftTxnRow[],
  petty: { expenseCash?: number; incomeCash?: number } = {},
): ShiftCashSummary {
  let paidCount = 0;
  let paidCash = 0;
  let paidQris = 0;
  let paidCard = 0;
  let voidedCount = 0;
  let voidedAmount = 0;
  let refundedCount = 0;
  let refundedAmount = 0;
  let refundedCash = 0;

  /* Sesi AE-155 — helper allocate split amount ke bucket cash/qris/card. */
  function bucketize(method: string, amount: number) {
    if (method === "cash") paidCash += amount;
    else if (method === "qris") paidQris += amount;
    else paidCard += amount;
  }

  /* Sesi AE-228 — masukkan uang masuk sebuah transaksi ke ember yang benar,
   * split maupun bukan. Sebelumnya HANYA cabang `paid` yang mengerti split;
   * cabang refund memakai `t.paymentMethod` yang untuk transaksi split berisi
   * literal "split" — tidak cocok "cash" maupun "qris", jadi seluruh nilainya
   * jatuh ke ember kartu tanpa satu error pun. */
  function allocateIncoming(t: ShiftTxnRow) {
    if (t.paymentMethod === "split" && t.splits && t.splits.length > 0) {
      for (const s of t.splits) bucketize(s.paymentMethod, s.amount);
      return;
    }
    /* Defensif: transaksi split tanpa baris pecahan (data lama / anomali)
     * masuk ember kartu supaya totalnya tetap utuh — sama seperti AE-155. */
    if (t.paymentMethod === "split") {
      paidCard += t.total;
      return;
    }
    bucketize(t.paymentMethod, t.total);
  }

  /** Berapa rupiah dari transaksi ini yang masuk sebagai TUNAI. */
  function cashPortion(t: ShiftTxnRow): number {
    if (t.paymentMethod === "split") {
      if (!t.splits) return 0;
      return t.splits
        .filter((s) => s.paymentMethod === "cash")
        .reduce((sum, s) => sum + s.amount, 0);
    }
    return t.paymentMethod === "cash" ? t.total : 0;
  }

  for (const t of txns) {
    if (t.status === "paid") {
      paidCount += 1;
      /* Sesi AE-155 — transaksi split dipecah per metode supaya expectedCash
       * + settlement QRIS + settlement kartu akurat. Sesi AE-228 — logikanya
       * pindah ke `allocateIncoming` supaya cabang refund memakai aturan yang
       * sama persis. */
      allocateIncoming(t);
    } else if (t.status === "voided") {
      voidedCount += 1;
      voidedAmount += t.total;
    } else if (t.status === "refunded") {
      /* Sesi AE-45 (continuation audit AE-44 finding) — full refund:
       * dulu cuma count `refundedCash += total` TANPA add original
       * payment ke paidCash. Effect: expectedCash = opening + 0 - total
       * = opening - total, padahal physical drawer opening + total
       * (received) - total (refunded) = opening. Variance = +total per
       * full refund (false POSITIVE alarm).
       *
       * Fix: count original payment di paidCash/paidQris/paidCard.
       * Net dengan refundedCash = 0, matches physical drawer. Konsisten
       * dengan branch partially_refunded (AE-44). */
      paidCount += 1;
      refundedCount += 1;
      refundedAmount += t.total;
      /* Sesi AE-228 — split-aware. Untuk transaksi split, uang yang
       * dikembalikan dari laci = bagian TUNAI-nya saja; bagian QRIS/kartu
       * kembali lewat kanalnya masing-masing, bukan dari laci. */
      allocateIncoming(t);
      refundedCash += cashPortion(t);
    } else if (t.status === "partially_refunded") {
      paidCount += 1;
      refundedCount += 1;
      const refValue = t.refundedAmount ?? 0;
      refundedAmount += refValue;
      allocateIncoming(t);
      /* Refund sebagian tidak menyebut pecahan mana yang dikembalikan. Batas
       * yang pasti benar: tidak mungkin mengembalikan tunai lebih banyak dari
       * tunai yang masuk. Untuk transaksi non-split hasilnya persis perilaku
       * lama (refValue kalau bayarnya tunai, 0 kalau bukan). */
      refundedCash += Math.min(refValue, cashPortion(t));
    }
  }

  return {
    paidCount,
    paidCash,
    paidQris,
    paidCard,
    voidedCount,
    voidedAmount,
    refundedCount,
    refundedAmount,
    refundedCash,
    pettyExpenseCash: petty.expenseCash ?? 0,
    pettyIncomeCash: petty.incomeCash ?? 0,
  };
}

/**
 * Sesi AE-49 — compute expectedCash dari ringkasan + opening cash.
 * Pure function — testable terpisah dari computeShiftCashSummary.
 *
 * Formula:
 *   expectedCash = openingCash + paidCash - refundedCash
 *                  - pettyExpenseCash + pettyIncomeCash
 *
 * Petty cash sudah dilakukan filter `paymentMethod = "cash"` di caller
 * (queries.ts fetchDailyCashSummary). Transfer/other tidak masuk sini —
 * mereka tidak affect kas drawer fisik (laci kasir), affect bank account.
 */
export function computeExpectedCash(
  openingCash: number,
  summary: ShiftCashSummary,
): number {
  return (
    openingCash +
    summary.paidCash -
    summary.refundedCash -
    summary.pettyExpenseCash +
    summary.pettyIncomeCash
  );
}
