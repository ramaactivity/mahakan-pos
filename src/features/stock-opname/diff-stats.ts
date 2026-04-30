import type { OpnameDiffStats } from "./types";

interface LineLike {
  expectedQty: number;
  actualQty: number | null;
  unitCostAtSnapshot: number;
}

/**
 * Pure aggregator over a session's lines. Used for UI rollup + finalize
 * eligibility checks. Lines with actualQty === null are "uncounted" and
 * excluded from diff totals.
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
    if (l.actualQty === null) continue;
    counted++;
    const diff = l.actualQty - l.expectedQty;
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
