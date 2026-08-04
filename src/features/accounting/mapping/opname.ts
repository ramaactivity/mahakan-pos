/**
 * mapOpnameAdjustment — stock opname finalize → journal lines.
 *
 * Per design doc §4.15. Aggregate diffs per ingredient.section:
 *
 * Shortage (count_actual < expected → diff_value < 0, kerugian):
 *   Dr 6903 Penghapusan Persediaan      |total_shortage|
 *      Cr 1140/1141/1142 Persediaan
 *
 * Surplus (count_actual > expected → diff_value > 0, gain):
 *   Dr 1140/1141/1142 Persediaan        total_surplus
 *      Cr 6903 Penghapusan Persediaan
 *
 * Mixed (some sections shortage, some surplus): both Dr/Cr lines for 6903.
 * MUST balance overall.
 *
 * Section sums input from caller (sesi U hook aggregates per-line diffs,
 * groups by ingredient.section).
 */

import type { JournalLineInput } from "../posting";

export type OpnameSectionDiff = {
  section: "kitchen" | "bar" | "supporting" | "cleaning" | null;
  /** Net rupiah value (sum diffs * unit_cost). Positive = surplus, negative = shortage. */
  diffValue: number;
};

export type OpnameAdjustmentInput = {
  opnameSessionId: string;
  outletId: string;
  entryDate: string;
  /** "Opname Mei 2026" — for description. */
  sessionLabel: string;
  /** Per-section aggregated diff. */
  sectionDiffs: OpnameSectionDiff[];
};

const PERSEDIAAN_BY_SECTION: Record<
  NonNullable<OpnameSectionDiff["section"]> | "null",
  string
> = {
  kitchen: "1140",
  bar: "1141",
  supporting: "1142",
  cleaning: "1142",
  null: "1142",
};

function persediaanCode(section: OpnameSectionDiff["section"]): string {
  return PERSEDIAAN_BY_SECTION[(section ?? "null") as keyof typeof PERSEDIAAN_BY_SECTION];
}

export function mapOpnameAdjustment(
  input: OpnameAdjustmentInput,
): JournalLineInput[] {
  /* Sesi AE-182 — WAJIB bulatkan. diffValue = qty desimal × unit_cost
   * desimal, jadi hasilnya hampir selalu pecahan (mis. 428126.8473).
   * Kolom journal_lines.debit/credit bertipe bigint → Postgres menolak
   * dengan SQLSTATE 22P02 "invalid input syntax for type bigint" dan
   * jurnal opname GAGAL PERMANEN (retry pun tetap gagal karena args
   * snapshot-nya masih pecahan). Tiga jurnal opname hilang karena ini
   * sebelum diperbaiki: Mei, 14 Juli, 1 Agustus 2026.
   *
   * Bulatkan per SECTION dulu (bukan di akhir) supaya baris persediaan dan
   * baris lawan 6903 dihitung dari angka bulat yang sama → selalu balance. */
  const byCode: Record<string, number> = {};
  for (const sd of input.sectionDiffs) {
    const value = Math.round(sd.diffValue);
    if (value === 0) continue;
    const code = persediaanCode(sd.section);
    byCode[code] = (byCode[code] ?? 0) + value;
  }

  const lines: JournalLineInput[] = [];
  let totalShortage = 0;
  let totalSurplus = 0;

  for (const [code, value] of Object.entries(byCode)) {
    if (value === 0) continue;
    if (value < 0) {
      // Shortage: persediaan turun (Cr), counter ke beban (Dr 6903)
      const abs = Math.abs(value);
      totalShortage += abs;
      lines.push({
        accountCode: code,
        credit: abs,
        description: `Penyesuaian shortage opname ${input.sessionLabel}`,
      });
    } else {
      // Surplus: persediaan naik (Dr), counter ke beban (Cr 6903 = gain)
      totalSurplus += value;
      lines.push({
        accountCode: code,
        debit: value,
        description: `Penyesuaian surplus opname ${input.sessionLabel}`,
      });
    }
  }

  // Counter line: 6903 Penghapusan Persediaan, net direction.
  // Net debit ke 6903 (loss) kalau shortage > surplus, net credit (gain) sebaliknya.
  const netLoss = totalShortage - totalSurplus;
  if (netLoss > 0) {
    lines.push({
      accountCode: "6903",
      debit: netLoss,
      description: `Penghapusan persediaan netto opname ${input.sessionLabel}`,
    });
  } else if (netLoss < 0) {
    lines.push({
      accountCode: "6903",
      credit: Math.abs(netLoss),
      description: `Surplus persediaan netto opname ${input.sessionLabel}`,
    });
  }
  // netLoss = 0 berarti shortage perfectly cancels surplus — no 6903 line needed.
  // Total Dr (surplus + shortage 6903) = Total Cr (shortage + surplus 6903) by construction.

  // Edge case: kalau gak ada movement (semua diff 0), return [].
  if (lines.length === 0) return [];

  return lines;
}
