/**
 * mapShiftVariance — shift close dengan variance != 0 → journal lines.
 *
 * Mapping per design doc §4.14:
 *   Variance = actualCash - expectedCash
 *
 *   Variance < 0 (kas kurang):
 *     Dr 6902 Selisih Kas                  |variance|
 *        Cr 1101 Kas Tunai                 |variance|
 *
 *   Variance > 0 (kas lebih):
 *     Dr 1101 Kas Tunai                    variance
 *        Cr 6902 Selisih Kas               variance  (treated as gain)
 */

import type { JournalLineInput } from "../posting";

export type ShiftVarianceInput = {
  shiftId: string;
  /** "Shift kasir Galih 2026-04-30 14:00-22:00" — untuk description. */
  shiftLabel: string;
  outletId: string;
  /** Date shift closed (YYYY-MM-DD WIB). */
  entryDate: string;
  /** actualCash - expectedCash. Positive = surplus, negative = shortage. */
  variance: number;
};

export function mapShiftVariance(input: ShiftVarianceInput): JournalLineInput[] {
  if (input.variance === 0) {
    // Caller sebaiknya skip recordJournal kalau variance=0; kita defensive return [].
    return [];
  }

  const abs = Math.abs(input.variance);

  if (input.variance < 0) {
    // Kas kurang
    return [
      {
        accountCode: "6902",
        debit: abs,
        description: `Selisih kas (kurang) — ${input.shiftLabel}`,
      },
      {
        accountCode: "1101",
        credit: abs,
        description: `Adjust kas drawer — ${input.shiftLabel}`,
      },
    ];
  }

  // Kas lebih (surplus)
  return [
    {
      accountCode: "1101",
      debit: abs,
      description: `Adjust kas drawer (surplus) — ${input.shiftLabel}`,
    },
    {
      accountCode: "6902",
      credit: abs,
      description: `Selisih kas (lebih) — ${input.shiftLabel}`,
    },
  ];
}

/**
 * Sesi AE-62o — mapShiftVarianceReversal: post reverse entry untuk rebalance.
 *
 * Saat owner approve rebalancing, kita perlu:
 *   1. Reverse original variance entry (kalau variance lama != 0)
 *   2. Post new entry sesuai corrected variance (kalau != 0)
 *
 * Helper ini bantu step 1 — mirror mapShiftVariance tapi dengan debit/credit
 * di-swap. sourceType="shift_variance_reversal" (new enum value AE-62o).
 *
 * Note: actual "new variance" entry posted via existing mapShiftVariance
 * dengan input.variance = correctedVariance. Hook caller handle both
 * sequencing in single transaction (lihat postJournalForShiftVarianceReversal).
 */
export function mapShiftVarianceReversal(
  input: ShiftVarianceInput & { reason: string },
): JournalLineInput[] {
  if (input.variance === 0) return [];
  const abs = Math.abs(input.variance);

  if (input.variance < 0) {
    // Original was Dr 6902 / Cr 1101. Reverse: Dr 1101 / Cr 6902.
    return [
      {
        accountCode: "1101",
        debit: abs,
        description: `REVERSE selisih kas (kurang) — ${input.shiftLabel}: ${input.reason}`,
      },
      {
        accountCode: "6902",
        credit: abs,
        description: `REVERSE — ${input.shiftLabel}`,
      },
    ];
  }

  // Original was Dr 1101 / Cr 6902 (surplus). Reverse: Dr 6902 / Cr 1101.
  return [
    {
      accountCode: "6902",
      debit: abs,
      description: `REVERSE selisih kas (lebih) — ${input.shiftLabel}: ${input.reason}`,
    },
    {
      accountCode: "1101",
      credit: abs,
      description: `REVERSE — ${input.shiftLabel}`,
    },
  ];
}
