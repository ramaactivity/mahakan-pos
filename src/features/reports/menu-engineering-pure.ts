/**
 * Pure helpers for menu engineering matrix classification (M23.6).
 * No DB / framework deps — testable in isolation, importable from client.
 *
 * Classification follows Kasavana-Smith framework: split menu by median
 * popularity (qty) and median contribution margin Rp into 4 quadrants.
 *
 * Items without sales OR without cogs are "unclassified" — they show in the
 * report but don't participate in the median computation or quadrant split.
 */
import type {
  ItemPerformanceRow,
  MenuEngineeringResult,
  MenuEngineeringRow,
  MenuQuadrant,
} from "./types";

/** Minimum classifiable items below which we skip quadrant labeling (returns all unclassified). */
export const MENU_ENGINEERING_MIN_ITEMS = 4;

/**
 * Linear-interpolation median (Excel-style PERCENTILE). Sorts a copy.
 * Returns null for empty input.
 */
export function linearMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * 0.5;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Add contribMarginRp to a row; null when cogs unknown. */
function withContribMargin(row: ItemPerformanceRow): MenuEngineeringRow {
  const contribMarginRp = row.cogs === null ? null : row.revenue - row.cogs;
  return {
    ...row,
    contribMarginRp,
    quadrant: "unclassified",
  };
}

/** A row is classifiable when it has positive qty AND known cogs. */
function isClassifiable(row: MenuEngineeringRow): boolean {
  return row.quantity > 0 && row.contribMarginRp !== null;
}

/**
 * Apply quadrant labels in-place using the supplied medians. Items with qty
 * exactly at median are bucketed UP (≥ medianQty = high popularity), since
 * "median or above" matches the spirit of "above-average" for thresholding.
 * Same convention for contribMargin.
 */
function classifyRow(row: MenuEngineeringRow, medianQty: number, medianContribMargin: number): MenuQuadrant {
  if (!isClassifiable(row)) return "unclassified";
  const highPop = row.quantity >= medianQty;
  const highMargin = (row.contribMarginRp as number) >= medianContribMargin;
  if (highPop && highMargin) return "star";
  if (highPop && !highMargin) return "plowhorse";
  if (!highPop && highMargin) return "puzzle";
  return "dog";
}

/**
 * Classify a list of ItemPerformanceRow into menu engineering quadrants.
 *
 * Behavior:
 * - Computes contribMarginRp per row (revenue − cogs).
 * - Filters classifiable rows (qty > 0 && cogs known); if fewer than
 *   MENU_ENGINEERING_MIN_ITEMS, returns all rows unclassified with
 *   `classified: false` so UI can show a "need more data" state.
 * - If qty has zero spread (all items equal qty) OR contribMargin spread is 0,
 *   we still classify but quadrant assignment may collapse — UI can show
 *   warnings but results stay deterministic.
 */
export function classifyMenuMatrix(
  rows: ItemPerformanceRow[],
): MenuEngineeringResult {
  const enriched = rows.map(withContribMargin);

  const totals = enriched.reduce(
    (acc, r) => {
      acc.revenue += r.revenue;
      if (r.cogs !== null) acc.cogs += r.cogs;
      if (r.contribMarginRp !== null) acc.contribMargin += r.contribMarginRp;
      return acc;
    },
    { revenue: 0, cogs: 0, contribMargin: 0 },
  );

  const classifiable = enriched.filter(isClassifiable);
  const counts: Record<MenuQuadrant, number> = {
    star: 0,
    plowhorse: 0,
    puzzle: 0,
    dog: 0,
    unclassified: 0,
  };

  if (classifiable.length < MENU_ENGINEERING_MIN_ITEMS) {
    counts.unclassified = enriched.length;
    return {
      rows: enriched,
      medianQty: null,
      medianContribMargin: null,
      totals,
      counts,
      classified: false,
    };
  }

  const medianQty = linearMedian(classifiable.map((r) => r.quantity));
  const medianContribMargin = linearMedian(
    classifiable.map((r) => r.contribMarginRp as number),
  );

  // medians are non-null because classifiable.length >= 4
  for (const r of enriched) {
    r.quadrant = classifyRow(r, medianQty as number, medianContribMargin as number);
    counts[r.quadrant]++;
  }

  return {
    rows: enriched,
    medianQty,
    medianContribMargin,
    totals,
    counts,
    classified: true,
  };
}
