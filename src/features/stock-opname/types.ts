import type { InferSelectModel } from "drizzle-orm";
import type {
  stockOpnameLines,
  stockOpnameSessions,
} from "@/db/schema";

export type OpnameSession = InferSelectModel<typeof stockOpnameSessions>;
export type OpnameLine = InferSelectModel<typeof stockOpnameLines>;
export type OpnameStatus = OpnameSession["status"];

export type IngredientSection = "kitchen" | "bar" | "supporting" | "cleaning";

export interface OpnameLineWithIngredient extends OpnameLine {
  ingredient: {
    id: string;
    name: string;
    unit: string;
    isActive: boolean;
    deletedAt: Date | null;
    /** Operational section (sesi O). Null = legacy/unclassified. */
    section: IngredientSection | null;
    /** Sesi AE-62y — pack conversions (jsonb dari ingredients.pack_conversions).
     * Diteruskan ke EditUnitModal + opname unit picker untuk auto-convert
     * input "1 packs" → "20 pcs". */
    packConversions: Array<{ unitLabel: string; qtyPerBase: number }> | null;
    /** Sesi AE-130 — multi-unit tier (Anisa feedback).
     *  Opname mobile pakai untuk:
     *    1. Extend unit picker dengan tier labels (tracking + belanja)
     *    2. Tampilkan tracking preview "≈ N Kotak" sebagai sanity check
     *  NULL = tier disabled, fallback ke `unit` (COGS) apa adanya. */
    unitTracking: string | null;
    unitTrackingPerCogs: string | null;
    unitBelanja: string | null;
    unitBelanjaPerCogs: string | null;
  };
}

export interface OpnameSessionWithCounts extends OpnameSession {
  /**
   * Sesi AE-210 — NILAI RUPIAH stok hasil hitung (Σ qty aktual × unit cost
   * snapshot). Beda dengan `totalDiffCost` yang hanya nilai SELISIH-nya.
   * Ini angka yang dipakai owner untuk mengisi saldo awal persediaan.
   */
  stockValue: number;
  startedByName: string | null;
  submittedByName: string | null;
  finalizedByName: string | null;
  cancelledByName: string | null;
}

export interface OpnameSessionDetail extends OpnameSessionWithCounts {
  lines: OpnameLineWithIngredient[];
}

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export type ApiFailure = {
  success: false;
  error: { code: string; message: string; field?: string };
};

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiFailure {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface StartOpnameInput {
  periodLabel?: string;
  /** Sesi AE-230 — bulan yang DIWAKILI opname ini ("YYYY-MM"). Kalau diisi,
   * label ikut diturunkan dari sini dan rekap COGS memakai bulan ini. */
  periodMonth?: string;
  notes?: string | null;
}

export interface SaveCountInput {
  sessionId: string;
  ingredientId: string;
  /** Pass null to clear an entry back to "uncounted". */
  actualQty: number | null;
  note?: string | null;
}

export interface SaveCountBatchInput {
  sessionId: string;
  lines: Array<{
    ingredientId: string;
    actualQty: number | null;
    note?: string | null;
  }>;
}

/** Sesi AE-22 — staff add bahan baru on-the-fly saat opname.
 *  Auto-create ingredient master + opname line dalam 1 transaction. */
export interface AddOpnameItemAdHocInput {
  sessionId: string;
  name: string;
  unit: string;
  /** Kalau null = "Lainnya" / unclassified. */
  section?: IngredientSection | null;
  /** Decimal qty actual (yang dihitung staff). */
  actualQty: number;
  note?: string | null;
}

export interface SubmitOpnameInput {
  sessionId: string;
  /** Lines that were uncounted will be treated as expected (zero diff). If
   * false (default), submit fails when there are any uncounted lines. */
  treatUncountedAsExpected?: boolean;
}

export interface FinalizeOpnameInput {
  sessionId: string;
}

export interface CancelOpnameInput {
  sessionId: string;
  reason: string;
}

export interface ReopenOpnameInput {
  sessionId: string;
}

/** Aggregate stats computed on the fly from lines. */
export interface OpnameDiffStats {
  countedLines: number;
  totalLines: number;
  uncountedLines: number;
  matchingLines: number;
  surplusLines: number;
  shortageLines: number;
  totalDiffQty: number;
  totalAbsDiffQty: number;
  totalDiffCost: number;
  totalAbsDiffCost: number;
}

/** Snapshot of monthly cadence — used by Home banner. */
export interface MonthlyCadenceStatus {
  /** ISO YYYY-MM key for current month (Asia/Jakarta). */
  currentMonthKey: string;
  /** Human label like "April 2026". */
  currentMonthLabel: string;
  /** Active in-progress / pending session id, if any. */
  activeSessionId: string | null;
  activeStatus: OpnameStatus | null;
  /** True when current month has at least one `completed` session. */
  hasCompletedThisMonth: boolean;
  /** When was the last completed opname for this outlet. */
  lastCompletedAt: Date | null;
  lastCompletedPeriodLabel: string | null;
}
