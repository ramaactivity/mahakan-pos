import type { OpnameDiffStats } from "./types";

interface LineLike {
  expectedQty: number;
  actualQty: number | null;
  unitCostAtSnapshot: number;
  // Sesi AE-62e — decimal mirrors. Truth source kalau ada (negative-stock
  // case bisa lose data kalau hanya pakai bigint yang di-clamp ke 0).
  expectedQtyDecimal?: string | null;
  actualQtyDecimal?: string | null;
}

function effectiveExpected(l: LineLike): number {
  if (l.expectedQtyDecimal != null) return parseFloat(l.expectedQtyDecimal);
  return l.expectedQty;
}

function effectiveActual(l: LineLike): number | null {
  if (l.actualQtyDecimal != null) return parseFloat(l.actualQtyDecimal);
  return l.actualQty;
}

/**
 * Pure aggregator over a session's lines. Used for UI rollup + finalize
 * eligibility checks. Lines with actualQty === null are "uncounted" and
 * excluded from diff totals.
 *
 * Sesi AE-62e — prefer decimal mirror over bigint. Bigint expectedQty
 * di-clamp ke 0 untuk negative-stock case (oversold), real value disimpan
 * di decimal. Tanpa decimal preference, UI preview misleading "0 diff"
 * walau finalize akan create +X adjust.
 */
export function computeDiffStats(lines: LineLike[]): OpnameDiffStats {
  let counted = 0;
  let matching = 0;
  let surplus = 0;
  let shortage = 0;
  let totalDiffQty = 0;
  let totalAbsDiffQty = 0;
  let totalDiffCost = 0;
  let totalAbsDiffCost = 0;

  for (const l of lines) {
    const actual = effectiveActual(l);
    if (actual === null) continue;
    counted++;
    const expected = effectiveExpected(l);
    const diff = actual - expected;
    if (diff === 0) matching++;
    else if (diff > 0) surplus++;
    else shortage++;
    totalDiffQty += diff;
    totalAbsDiffQty += Math.abs(diff);
    const costImpact = diff * l.unitCostAtSnapshot;
    totalDiffCost += costImpact;
    totalAbsDiffCost += Math.abs(costImpact);
  }

  return {
    countedLines: counted,
    totalLines: lines.length,
    uncountedLines: lines.length - counted,
    matchingLines: matching,
    surplusLines: surplus,
    shortageLines: shortage,
    totalDiffQty,
    totalAbsDiffQty,
    totalDiffCost,
    totalAbsDiffCost,
  };
}
