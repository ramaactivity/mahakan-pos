/**
 * Pure function: map a category name to {revenue, cogs, persediaan} account
 * codes. Used by mapPosSale + mapPosRefund + mapPosCompliment.
 *
 * Heuristic-based default (Sesi T). Can be overridden per-category via
 * categories.accountingRevenueAccountId / accountingCogsAccountId fields
 * (set by Owner via Admin → Menu → Categories editor — UI deferred sesi V).
 *
 * Mapping rules (Indonesian category slugs/names):
 * - Food (4101 / 5101 / 1140 Kitchen): ricebowl, bakmie, snack, croffle,
 *   dessert, makanan, food
 * - Drink (4102 / 5102 / 1141 Bar): coffee, kopi, non-coffee, manual brew,
 *   tea, teh, minuman, drink, juice, milk-based
 * - Lain (4103 / 5103 / 1142 Pendukung): everything else (merchandise, etc)
 */

export type CategoryAccountMapping = {
  revenueAccountCode: string;
  cogsAccountCode: string;
  persediaanAccountCode: string;
  bucket: "food" | "drink" | "other";
};

const FOOD_KEYWORDS = [
  "rice",
  "bakmie",
  "mie",
  "snack",
  "croffle",
  "dessert",
  "makanan",
  "food",
];

const DRINK_KEYWORDS = [
  "coffee",
  "kopi",
  "non-coffee",
  "noncoffee",
  "manual brew",
  "manualbrew",
  "tea",
  "teh",
  "minuman",
  "drink",
  "juice",
  "jus",
  "milk",
  "susu",
  "matcha",
  "chocolate",
  "coklat",
];

export function mapCategoryToAccounts(
  categoryName: string,
): CategoryAccountMapping {
  const lower = categoryName.trim().toLowerCase();

  for (const kw of FOOD_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        revenueAccountCode: "4101",
        cogsAccountCode: "5101",
        persediaanAccountCode: "1140",
        bucket: "food",
      };
    }
  }

  for (const kw of DRINK_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        revenueAccountCode: "4102",
        cogsAccountCode: "5102",
        persediaanAccountCode: "1141",
        bucket: "drink",
      };
    }
  }

  return {
    revenueAccountCode: "4103",
    cogsAccountCode: "5103",
    persediaanAccountCode: "1142",
    bucket: "other",
  };
}

/**
 * Aggregate category-bucketed lines from a list of items. Used by all POS
 * mappers to produce balanced food/drink revenue + COGS lines.
 */
export type AggregatedItem = {
  itemCategoryName: string;
  /** Net amount setelah discount allocation. Untuk POS sale = subtotal,
   * untuk refund = refundedAmount, untuk compliment = 0 (hanya COGS yang relevan). */
  amount: number;
  cogs: number;
};

export type CategoryAggregateResult = {
  food: { amount: number; cogs: number };
  drink: { amount: number; cogs: number };
  other: { amount: number; cogs: number };
};

export function aggregateByCategory(
  items: AggregatedItem[],
): CategoryAggregateResult {
  const result: CategoryAggregateResult = {
    food: { amount: 0, cogs: 0 },
    drink: { amount: 0, cogs: 0 },
    other: { amount: 0, cogs: 0 },
  };
  for (const item of items) {
    const m = mapCategoryToAccounts(item.itemCategoryName);
    result[m.bucket].amount += item.amount;
    result[m.bucket].cogs += item.cogs;
  }
  return result;
}
