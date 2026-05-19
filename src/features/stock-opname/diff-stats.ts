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

/* Sesi AE-63 phase7 — defensive parseFloat: kalau decimal string corrupt
 * (NaN/Infinity dari Drizzle string → number cast), fallback ke bigint.
 * Tanpa guard ini, NaN propagate ke arithmetic → totalDiffQty=NaN → submit
 * gagal cast ke bigint OR UI render NaN. */
function safeParseDecimal(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function effectiveExpected(l: LineLike): number {
  if (l.expectedQtyDecimal != null) {
    const p = safeParseDecimal(l.expectedQtyDecimal);
    if (p !== null) return p;
  }
  return Number.isFinite(l.expectedQty) ? l.expectedQty : 0;
}

function effectiveActual(l: LineLike): number | null {
  if (l.actualQtyDecimal != null) {
    const p = safeParseDecimal(l.actualQtyDecimal);
    if (p !== null) return p;
  }
  if (l.actualQty === null) return null;
  return Number.isFinite(l.actualQty) ? l.actualQty : null;
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
    /* Defensive: kalau diff somehow NaN (mis. unit_cost corrupt), skip
     * line dari accumulation supaya total stays finite. */
    if (!Number.isFinite(diff)) continue;
    if (diff === 0) matching++;
    else if (diff > 0) surplus++;
    else shortage++;
    totalDiffQty += diff;
    totalAbsDiffQty += Math.abs(diff);
    /* unit_cost_at_snapshot bigint, but defensive cast supaya kalau
     * Drizzle return string (edge case neon driver), Number() coerce. */
    const cost = Number(l.unitCostAtSnapshot);
    const safeCost = Number.isFinite(cost) ? cost : 0;
    const costImpact = diff * safeCost;
    if (!Number.isFinite(costImpact)) continue;
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
