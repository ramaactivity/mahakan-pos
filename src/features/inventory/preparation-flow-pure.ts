/**
 * Pure helpers for the M23.2 cost cascade + recursive expansion engine.
 *
 * No DB, no React, no `server-only`. Importable in tests + browser-side
 * COGS calculator (M23.3) without pulling in Postgres deps.
 *
 * Decisions resolved (`~/.claude/plans/halo-gua-mau-lanjut-gleaming-fern.md`):
 *   - D2/D9: Math.round, sum-then-round-once-per-leaf — match Owner spreadsheet.
 *   - D3 split: total = round(rawQty × (1 + waste/100)); lean = round(rawQty);
 *              waste = total − lean. Total is the truth, waste is derived.
 */

export interface RecipeLineInput {
  qty: number;
  costPerUnit: number;
}

/**
 * Cost-per-unit of a preparation given its recipe lines, Q Factor, and yield.
 *
 * Formula (matches Owner spreadsheet):
 *   cost_per_unit = round( sum(qty × costPerUnit) × (1 + waste/100) / yield )
 *
 * Throws if yield ≤ 0 (DB CHECK guarantees this can't happen at runtime,
 * but defense-in-depth for callers building inputs in memory).
 */
export function computePrepCostFromLines(
  lines: RecipeLineInput[],
  wasteFactorPct: number,
  yieldUnits: number,
): number {
  if (yieldUnits <= 0) {
    throw new Error("PREP_YIELD_INVALID");
  }
  const baseCost = lines.reduce(
    (acc, l) => acc + l.qty * l.costPerUnit,
    0,
  );
  const wasteFactor = 1 + wasteFactorPct / 100;
  return Math.round((baseCost * wasteFactor) / yieldUnits);
}

export interface MovementSplit {
  /** Lean qty deducted under kind=sale_deduct. */
  leanQty: number;
  /** Waste buffer qty deducted under kind=waste. May be 0. */
  wasteQty: number;
}

/**
 * Splits a raw deduction qty into lean + waste portions per D3.
 *
 * Convention: `total = round(rawQty × (1 + waste/100))` is the authoritative
 * total decrement; `lean = round(rawQty)`; `waste = total − lean`.
 * This avoids drift when both rounded independently.
 */
export function splitLineForMovement(
  rawQty: number,
  wasteFactorPct: number,
): MovementSplit {
  if (rawQty <= 0) return { leanQty: 0, wasteQty: 0 };
  const lean = Math.round(rawQty);
  if (wasteFactorPct <= 0) return { leanQty: lean, wasteQty: 0 };
  const total = Math.round(rawQty * (1 + wasteFactorPct / 100));
  const waste = Math.max(0, total - lean);
  return { leanQty: lean, wasteQty: waste };
}

/**
 * Aggregates recursive-CTE expansion rows by ingredientId — sum first, round
 * once per leaf. Critical for diamond dependencies where the same atomic
 * ingredient appears in two prep paths.
 */
export function aggregateExpansion(
  rows: ReadonlyArray<{ ingredientId: string; qtyScaled: number }>,
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const r of rows) {
    sums.set(r.ingredientId, (sums.get(r.ingredientId) ?? 0) + r.qtyScaled);
  }
  const result = new Map<string, number>();
  for (const [ingId, sum] of sums) {
    result.set(ingId, Math.round(sum));
  }
  return result;
}

/**
 * Cycle detector — pure graph form. Adjacency = preparation dep map (prep id →
 * ingredient ids it currently uses, INCLUDING other preps). Caller passes the
 * adjacency snapshot WITHOUT the recipe being edited included.
 *
 * Returns true iff applying `proposed` as `target`'s new ingredient list would
 * create a cycle reachable from `target`.
 */
export function validateNoCycle(
  adjacency: ReadonlyMap<string, ReadonlyArray<string>>,
  target: string,
  proposed: ReadonlyArray<string>,
): boolean {
  // Self-reference is the simplest cycle.
  if (proposed.includes(target)) return true;

  // BFS/DFS: walk from each proposed ingredient via adjacency. If we ever
  // reach `target`, cycle.
  const visited = new Set<string>();
  const stack: string[] = [...proposed];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const neighbors = adjacency.get(cur);
    if (neighbors) stack.push(...neighbors);
  }
  return false;
}
