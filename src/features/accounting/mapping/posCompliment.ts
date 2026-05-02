/**
 * mapPosCompliment — compliment transaction (reason prefix "Compliment:") →
 * journal lines.
 *
 * Mapping per design doc §4.6 + Q6 confirmation:
 *   Dr 6304 Marketing & Iklan               sum(item.cogs)
 *      Cr 1140/1141/1142 Persediaan         per bucket
 *
 * No revenue, no kas (transaction.total = 0). Pure marketing expense + persediaan
 * decrement.
 *
 * Edge case: kalau menu_item belum punya recipe (cogs=0 untuk semua items),
 * mapping returns EMPTY array — caller must skip recordJournal call (don't
 * post empty entry). Caller logs warning "Compliment without COGS — skipping
 * journal entry; review recipe data".
 */

import type { JournalLineInput } from "../posting";
import { aggregateByCategory, type AggregatedItem } from "./categoryMapper";

export type PosComplimentInput = {
  transactionId: string;
  transactionNumber: string;
  outletId: string;
  entryDate: string;
  items: AggregatedItem[];
};

export function mapPosCompliment(
  input: PosComplimentInput,
): JournalLineInput[] {
  const buckets = aggregateByCategory(input.items);
  const totalCogs =
    buckets.food.cogs + buckets.drink.cogs + buckets.other.cogs;

  if (totalCogs === 0) {
    // Owner-confirmed Q6: skip + warning. Return empty; caller checks length.
    return [];
  }

  const lines: JournalLineInput[] = [];

  // Dr Marketing — sum
  lines.push({
    accountCode: "6304",
    debit: totalCogs,
    description: `Compliment TRX ${input.transactionNumber}`,
  });

  // Cr Persediaan per bucket
  if (buckets.food.cogs > 0) {
    lines.push({
      accountCode: "1140",
      credit: buckets.food.cogs,
      description: "Persediaan kitchen",
    });
  }
  if (buckets.drink.cogs > 0) {
    lines.push({
      accountCode: "1141",
      credit: buckets.drink.cogs,
      description: "Persediaan bar",
    });
  }
  if (buckets.other.cogs > 0) {
    lines.push({
      accountCode: "1142",
      credit: buckets.other.cogs,
      description: "Persediaan pendukung",
    });
  }

  return lines;
}
