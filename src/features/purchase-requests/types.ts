import type { InferSelectModel } from "drizzle-orm";
import type { purchaseRequests, purchaseRequestItems } from "@/db/schema";

export type PurchaseRequest = InferSelectModel<typeof purchaseRequests>;
export type PurchaseRequestItem = InferSelectModel<typeof purchaseRequestItems>;
export type PurchaseRequestStatus = PurchaseRequest["status"];

export interface PurchaseRequestItemInput {
  /** Sesi AE-16 — nullable untuk support manual items (bahan yang belum
   * di-master). Linked items punya FK; manual items pakai
   * ingredientNameSnapshot + unitSnapshot saja. */
  ingredientId?: string | null;
  /** Required selalu (display). Untuk linked items, server overwrite
   * dengan nama master saat create. */
  ingredientNameSnapshot?: string;
  unitSnapshot?: string;
  requestedQty: number;
  notes?: string | null;
}

export interface CreatePurchaseRequestInput {
  shiftId?: string | null;
  notes?: string | null;
  items: PurchaseRequestItemInput[];
}

export interface ReceiveItemInput {
  itemId: string;
  receivedQty: number;
}

/** Sesi AE-18 — bulk receive untuk multiple items dalam 1 PR sekaligus. */
export interface BulkReceiveItemsInput {
  requestId: string;
  items: Array<{ itemId: string; receivedQty: number }>;
}

export interface CancelPurchaseRequestInput {
  id: string;
  reason: string;
}

export interface PurchaseRequestWithItems extends PurchaseRequest {
  items: PurchaseRequestItem[];
  createdByName: string | null;
  cancelledByName: string | null;
  shiftStartedAt: Date | null;
}

/* Sesi AE-57 — PR items siap di-tarik ke Pembelian. Per item include
 * outstanding qty + suggested supplier (primary dari supplier_ingredients)
 * + suggested unitCost. Sort: oldest first untuk FIFO. */
export interface PrItemForPurchase {
  purchaseRequestItemId: string;
  ingredientId: string | null;
  ingredientName: string;
  unit: string;
  requestedQty: number;
  receivedQty: number;
  outstandingQty: number;
  /** Suggested supplier dari supplier_ingredients WHERE isPrimary=true.
   * NULL kalau belum ada mapping. */
  suggestedSupplierId: string | null;
  suggestedSupplierName: string | null;
  /** Suggested unit cost dari supplier_ingredients.unitCost (per pack).
   * NULL kalau belum ada. */
  suggestedUnitCost: number | null;
  notes: string | null;
}

export interface PrForPurchase {
  requestId: string;
  label: string;
  status: PurchaseRequestStatus;
  createdAt: Date;
  createdByName: string | null;
  notes: string | null;
  outstandingItemCount: number;
  totalOutstandingQty: number;
  items: PrItemForPurchase[];
}

export interface LowStockIngredient {
  id: string;
  name: string;
  /** Master/COGS unit (basis konversi). */
  unit: string;
  section: "kitchen" | "bar" | "supporting" | "cleaning" | null;
  currentStock: number;
  reorderThreshold: number;
  /** Suggested qty: max(reorderThreshold * 1.5 - currentStock, reorderThreshold). */
  suggestedQty: number;
  /* Sesi AE-177d — opsi satuan PR di sisi staff harus konsisten dgn Opname /
   * Market List → kirim packConversions + belanja tier supaya client bisa
   * bangun dropdown sama, lalu konversi qty staff ke master sebelum submit. */
  packConversions: Array<{ unitLabel: string; qtyPerBase: number }>;
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | {
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
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}
