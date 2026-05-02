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
