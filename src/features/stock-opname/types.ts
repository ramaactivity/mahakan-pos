import type { InferSelectModel } from "drizzle-orm";
import type {
  stockOpnameLines,
  stockOpnameSessions,
} from "@/db/schema";

export type OpnameSession = InferSelectModel<typeof stockOpnameSessions>;
export type OpnameLine = InferSelectModel<typeof stockOpnameLines>;
export type OpnameStatus = OpnameSession["status"];

export interface OpnameLineWithIngredient extends OpnameLine {
  ingredient: {
    id: string;
    name: string;
    unit: string;
    isActive: boolean;
    deletedAt: Date | null;
  };
}

export interface OpnameSessionWithCounts extends OpnameSession {
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
