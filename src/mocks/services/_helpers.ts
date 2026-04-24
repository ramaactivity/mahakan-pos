/**
 * Shared helpers for mock service layer.
 * Internal — consumers import from specific service modules, not here.
 */

import type { ApiFailure, ApiResult, ApiSuccess } from "../types";

/** Simulate network latency. */
export function delay(ms = 200 + Math.random() * 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wrap a value in the success envelope. */
export function ok<T>(data: T): ApiSuccess<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: genId("req"),
    },
  };
}

/** Wrap an error in the failure envelope. */
export function fail(
  code: string,
  message: string,
  field?: string,
): ApiFailure {
  return {
    success: false,
    error: {
      code,
      message,
      ...(field ? { field } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: genId("req"),
    },
  };
}

/** Convenience type guards for callers. */
export function isOk<T>(res: ApiResult<T>): res is ApiSuccess<T> {
  return res.success;
}

/** Generate a short unique-ish ID with a prefix. */
export function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}${rand}`;
}

/** Generate transaction number TRX-YYYYMMDD-NNNN (WIB-adjusted day). */
export function genTransactionNumber(date: Date, sequence: number): string {
  // Convert to WIB (UTC+7) manually to avoid pulling date-fns-tz into mocks
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const seq = String(sequence).padStart(4, "0");
  return `TRX-${yyyy}${mm}${dd}-${seq}`;
}

/** Get today's date as YYYY-MM-DD in WIB (for expense/income date fields). */
export function todayInJakarta(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
