import type { InferSelectModel } from "drizzle-orm";
import type { supplierIngredients } from "@/db/schema";

export type SupplierIngredient = InferSelectModel<typeof supplierIngredients>;

/** Joined view with supplier + ingredient meta. Drives Market List table. */
export interface MarketListItem {
  id: string;
  outletId: string;
  supplierId: string;
  supplierName: string;
  supplierContact: string | null;
  ingredientId: string;
  ingredientName: string;
  ingredientUnit: string;
  ingredientSection: string | null;
  /** Harga total per pack (Rp). */
  unitCost: number;
  /** Pack qty in pack unit. */
  packSize: number;
  packUnit: string;
  /** Effective Rp per ingredient.unit (after pack→unit conversion). */
  effectiveCostPerUnit: number;
  isPrimary: boolean;
  notes: string | null;
  updatedAt: string;
  /** Stamped saat unitCost terakhir berubah — info "Last Updated" di UI. */
  priceLastChangedAt: string;
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

export interface CreateMarketItemInput {
  supplierId: string;
  ingredientId: string;
  unitCost: number;
  packSize: number;
  packUnit: string;
  isPrimary?: boolean;
  notes?: string | null;
}

export interface UpdateMarketItemInput {
  unitCost?: number;
  packSize?: number;
  packUnit?: string;
  isPrimary?: boolean;
  notes?: string | null;
}

export interface ListMarketItemsOptions {
  search?: string;
  supplierId?: string;
  primaryOnly?: boolean;
}

/** Bulk import: array of rows. Setiap row identified via (supplier_name,
 *  ingredient_name) atau (supplier_id, ingredient_id) explicit. */
export interface BulkImportRow {
  supplierName: string;
  ingredientName: string;
  unitCost: number;
  packSize: number;
  packUnit: string;
  isPrimary?: boolean;
  notes?: string | null;
}

export interface BulkImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}
