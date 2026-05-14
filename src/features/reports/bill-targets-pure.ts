/**
 * Sesi AE-55 — Pure helpers untuk Per-Bill stats, Closing Shift aggregate,
 * dan Target progress. No DB / framework deps — testable isolation, dipakai
 * di queries.ts (server) dan TargetsView.tsx (client).
 */
import type {
  BillBucket,
  BillBucketKey,
  BillStats,
  ClosingShiftRow,
} from "./types";

/* ---------------- Bill stats ---------------- */

export const BILL_BUCKET_THRESHOLDS: Array<{
  key: BillBucketKey;
  label: string;
  min: number;
  max: number | null;
}> = [
  { key: "small", label: "Bill Kecil (<Rp 50k)", min: 0, max: 50_000 },
  { key: "medium", label: "Bill Sedang (Rp 50k–100k)", min: 50_000, max: 100_000 },
  { key: "large", label: "Bill Besar (Rp 100k–200k)", min: 100_000, max: 200_000 },
  { key: "premium", label: "Bill Premium (>Rp 200k)", min: 200_000, max: null },
];

function bucketOf(amount: number): BillBucketKey {
  if (amount < 50_000) return "small";
  if (amount < 100_000) return "medium";
  if (amount < 200_000) return "large";
  return "premium";
}

/** Linear-interpolation median; null kalau kosong. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  if (lo === hi) return sorted[lo];
  return Math.round((sorted[lo] + sorted[hi]) / 2);
}

export function computeBillStats(netTotals: number[]): {
  stats: BillStats;
  buckets: BillBucket[];
} {
  if (netTotals.length === 0) {
    return {
      stats: {
        count: 0,
        totalRevenue: 0,
        avgBill: 0,
        medianBill: 0,
        minBill: 0,
        maxBill: 0,
        modeBucket: null,
      },
      buckets: BILL_BUCKET_THRESHOLDS.map((t) => ({
        key: t.key,
        label: t.label,
        min: t.min,
        max: t.max,
        count: 0,
        revenue: 0,
        pctOfCount: 0,
      })),
    };
  }

  const counts: Record<BillBucketKey, number> = {
    small: 0,
    medium: 0,
    large: 0,
    premium: 0,
  };
  const revenues: Record<BillBucketKey, number> = {
    small: 0,
    medium: 0,
    large: 0,
    premium: 0,
  };

  let total = 0;
  let min = netTotals[0];
  let max = netTotals[0];
  for (const v of netTotals) {
    total += v;
    if (v < min) min = v;
    if (v > max) max = v;
    const b = bucketOf(v);
    counts[b]++;
    revenues[b] += v;
  }

  let modeBucket: BillBucketKey | null = null;
  let modeCount = 0;
  for (const key of Object.keys(counts) as BillBucketKey[]) {
    if (counts[key] > modeCount) {
      modeCount = counts[key];
      modeBucket = key;
    }
  }

  const count = netTotals.length;
  const buckets: BillBucket[] = BILL_BUCKET_THRESHOLDS.map((t) => ({
    key: t.key,
    label: t.label,
    min: t.min,
    max: t.max,
    count: counts[t.key],
    revenue: revenues[t.key],
    pctOfCount: count > 0 ? Math.round((counts[t.key] / count) * 1000) / 10 : 0,
  }));

  return {
    stats: {
      count,
      totalRevenue: total,
      avgBill: Math.round(total / count),
      medianBill: median(netTotals),
      minBill: min,
      maxBill: max,
      modeBucket,
    },
    buckets,
  };
}

/* ---------------- Closing Shift aggregate ---------------- */

export function aggregateClosingShifts(
  rows: ClosingShiftRow[],
  varianceThreshold: number,
): {
  shiftCount: number;
  totalPaidCash: number;
  totalActualCash: number;
  totalVariance: number;
  totalSettlement: number;
  avgVariance: number;
  biggestPositiveVariance: number;
  biggestNegativeVariance: number;
  overThresholdCount: number;
} {
  if (rows.length === 0) {
    return {
      shiftCount: 0,
      totalPaidCash: 0,
      totalActualCash: 0,
      totalVariance: 0,
      totalSettlement: 0,
      avgVariance: 0,
      biggestPositiveVariance: 0,
      biggestNegativeVariance: 0,
      overThresholdCount: 0,
    };
  }

  let totalPaidCash = 0;
  let totalActualCash = 0;
  let totalVariance = 0;
  let totalSettlement = 0;
  let biggestPos = 0;
  let biggestNeg = 0;
  let overThreshold = 0;

  for (const r of rows) {
    totalPaidCash += r.paidCash;
    totalActualCash += r.actualCash;
    totalVariance += r.variance;
    totalSettlement += r.settlementTotal;
    if (r.variance > biggestPos) biggestPos = r.variance;
    if (r.variance < biggestNeg) biggestNeg = r.variance;
    if (Math.abs(r.variance) > varianceThreshold) overThreshold++;
  }

  return {
    shiftCount: rows.length,
    totalPaidCash,
    totalActualCash,
    totalVariance,
    totalSettlement,
    avgVariance: Math.round(totalVariance / rows.length),
    biggestPositiveVariance: biggestPos,
    biggestNegativeVariance: biggestNeg,
    overThresholdCount: overThreshold,
  };
}

/* ---------------- Target progress ---------------- */

export type ProgressTier = "on_track" | "needs_push" | "behind" | "no_target";

export interface ProgressResult {
  target: number;
  revenue: number;
  /** 0..100+ ; null kalau target tidak diset. */
  pct: number | null;
  delta: number; // revenue - target (signed)
  tier: ProgressTier;
}

export function computeProgress(
  revenue: number,
  target: number | null | undefined,
): ProgressResult {
  if (!target || target <= 0) {
    return {
      target: 0,
      revenue,
      pct: null,
      delta: 0,
      tier: "no_target",
    };
  }
  const pct = Math.round((revenue / target) * 1000) / 10;
  const delta = revenue - target;
  let tier: ProgressTier;
  if (pct >= 100) tier = "on_track";
  else if (pct >= 70) tier = "needs_push";
  else tier = "behind";
  return { target, revenue, pct, delta, tier };
}
