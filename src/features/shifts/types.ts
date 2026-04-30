import type { InferSelectModel } from "drizzle-orm";
import type { shifts } from "@/db/schema";

export type Shift = InferSelectModel<typeof shifts>;
export type ShiftStatus = "open" | "closed";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export interface Paginated<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface OpenShiftInput {
  openingCash: number;
}

export interface CloseShiftInput {
  shiftId: string;
  actualCash: number;
  notes: string | null;
  /** Pesan untuk shift berikutnya (Galih ask #10). */
  handoverMessage?: string | null;
  /** Kasir-reported settlement amounts for reconciliation (Galih ask #11).
   * All optional + non-negative; outlet boleh skip channel yang gak relevan. */
  edcSettlement?: number | null;
  gofoodSettlement?: number | null;
  grabfoodSettlement?: number | null;
  shopeefoodSettlement?: number | null;
}

export interface ShiftSummary {
  transactionCount: number;
  paid: {
    count: number;
    cash: number;
    qris: number;
    cardBca: number;
  };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
}

export interface CloseShiftResult {
  shift: Shift;
  summary: ShiftSummary;
}
