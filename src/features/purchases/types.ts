import type { InferSelectModel } from "drizzle-orm";
import type { purchases, purchaseItems } from "@/db/schema";

export type Purchase = InferSelectModel<typeof purchases>;
export type PurchaseItem = InferSelectModel<typeof purchaseItems>;
export type PaymentMethod = Purchase["paymentMethod"];
export type PurchaseStatus = Purchase["status"];

export interface PurchaseItemInput {
  ingredientId: string;
  qty: number;
  unitCost: number;
}

export interface CreatePurchaseInput {
  supplierId: string | null;
  purchaseDate: string;     // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  paymentTermDays?: number;
  invoiceNo?: string | null;
  notes?: string | null;
  /** Vercel Blob URL ke foto nota / bukti transfer (sesi AA #2). */
  receiptImageUrl?: string | null;
  /** Whether to update each ingredient.cost_per_unit master from this
   * purchase's unit cost. Default true. */
  updateCost?: boolean;
  /** Whether to auto-create kas expense. Default: true for non-TOP, false
   * for TOP (TOP creates expense at mark-paid). */
  createKasEntry?: boolean;
  items: PurchaseItemInput[];
}

export interface CancelPurchaseInput {
  id: string;
  reason: string;
}

export interface MarkPaidInput {
  id: string;
  paymentMethod: PaymentMethod;
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

export interface PurchaseListItem extends Purchase {
  supplierName: string | null;
  itemCount: number;
}

export interface PurchaseDetail extends Purchase {
  supplierName: string | null;
  items: Array<
    PurchaseItem & {
      currentUnit: string;
      currentSection: string | null;
    }
  >;
  createdByName: string | null;
  paidByName: string | null;
  cancelledByName: string | null;
}

export interface ListPurchasesOptions {
  status?: PurchaseStatus;
  supplierId?: string;
  paymentMethod?: PaymentMethod;
  dateFrom?: string;     // YYYY-MM-DD
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface TopOutstandingItem {
  id: string;
  purchaseDate: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNo: string | null;
  totalAmount: number;
  dueDate: string | null;
  /** Days from today (Asia/Jakarta) to dueDate. Negative = overdue. */
  daysToDue: number | null;
}
