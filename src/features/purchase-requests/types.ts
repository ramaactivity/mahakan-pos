import type { InferSelectModel } from "drizzle-orm";
import type { purchaseRequests, purchaseRequestItems } from "@/db/schema";

export type PurchaseRequest = InferSelectModel<typeof purchaseRequests>;
export type PurchaseRequestItem = InferSelectModel<typeof purchaseRequestItems>;
export type PurchaseRequestStatus = PurchaseRequest["status"];

export interface PurchaseRequestItemInput {
  ingredientId: string;
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

export interface LowStockIngredient {
  id: string;
  name: string;
  unit: string;
  section: "kitchen" | "bar" | "supporting" | "cleaning" | null;
  currentStock: number;
  reorderThreshold: number;
  /** Suggested qty: max(reorderThreshold * 1.5 - currentStock, reorderThreshold). */
  suggestedQty: number;
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
