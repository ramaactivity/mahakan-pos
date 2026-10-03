import type { InferSelectModel } from "drizzle-orm";
import type { dailyMarketEntries, dailyMarketItems } from "@/db/schema";

export type DailyMarketEntry = InferSelectModel<typeof dailyMarketEntries>;
export type DailyMarketItem = InferSelectModel<typeof dailyMarketItems>;
export type DailyMarketKind = "topup" | "spend";

export type {
  MarketItemInput,
  ReverseInput,
  SpendInput,
  TopupInput,
} from "./schemas";

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
  /** Sesi AE-245 — baris bahan beserta qty & rupiahnya. */
  items: DailyMarketItemRow[];
  /** Rupiah nota yang masuk persediaan (jumlah subtotal baris bahan). */
  inventoryTotal: number;
  /** Sisa nota yang dibebankan langsung (parkir, plastik, kuli angkut). */
  expenseTotal: number;
}

export interface DailyMarketItemRow {
  id: string;
  ingredientId: string;
  name: string;
  qty: number;
  unit: string;
  qtyMaster: number;
  masterUnit: string;
  unitCost: number;
  subtotal: number;
  /** false = stok benar-benar bertambah dari baris ini. */
  stockSkipped: boolean;
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
