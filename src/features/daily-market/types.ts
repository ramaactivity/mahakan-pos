import type { InferSelectModel } from "drizzle-orm";
import type { dailyMarketEntries } from "@/db/schema";

export type DailyMarketEntry = InferSelectModel<typeof dailyMarketEntries>;
export type DailyMarketKind = "topup" | "spend";

export type { ReverseInput, SpendInput, TopupInput } from "./schemas";

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; field?: string } };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(code: string, message: string, field?: string): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}
export function isOk<T>(r: ApiResult<T>): r is { success: true; data: T } {
  return r.success === true;
}

export interface DailyMarketEntryRow extends DailyMarketEntry {
  bankLabel: string | null;
  categoryName: string | null;
  createdByName: string | null;
  /** Sesi AE-243 — nama bahan hasil resolusi `ingredientIds`. */
  ingredientNames: string[];
}

export interface DailyMarketSummary {
  /** Total top up yang masih berlaku (status posted). */
  totalTopup: number;
  /** Total belanja yang masih berlaku. */
  totalSpend: number;
  /** Sisa saldo kurir = top up − belanja. */
  balance: number;
  entryCount: number;
}
