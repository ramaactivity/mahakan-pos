import type { InferSelectModel } from "drizzle-orm";
import type {
  transactions,
  transactionItems,
  transactionItemModifiers,
} from "@/db/schema";

export type Transaction = InferSelectModel<typeof transactions>;
export type TransactionItem = InferSelectModel<typeof transactionItems>;
export type TransactionItemModifier = InferSelectModel<
  typeof transactionItemModifiers
>;

export type Variant = "hot" | "iced";
export type DiscountType = "percent" | "fixed";
export type PaymentMethod = "cash" | "qris" | "card_bca";
export type OrderType = "dine_in" | "takeaway";
export type TransactionStatus = "paid" | "voided" | "refunded" | "open";

export interface TransactionWithItems extends Transaction {
  items: Array<TransactionItem & { modifiers: TransactionItemModifier[] }>;
}

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

// ---------- Input shapes (Server Action signatures) ----------

export interface CreateTransactionItemModifierInput {
  modifierSlug: string;
  selectedValue: string | null;
  priceDelta: number;
}

export interface CreateTransactionItemInput {
  menuItemId: string;
  variant: Variant | null;
  quantity: number;
  unitPrice: number;
  modifiersPriceDelta: number;
  subtotal: number;
  note: string | null;
  openPriceNote: string | null;
  modifiers: CreateTransactionItemModifierInput[];
}

export interface CreateTransactionInput {
  /** UUID; if duplicate of an existing transaction's clientRefId, server returns the existing one (idempotency). */
  clientRefId?: string;
  shiftId: string;
  cashierId: string;
  pagerNumber: number;
  orderType: OrderType;
  /** Optional free-form label — customer name, "Meja 5", "Gojek", etc.
   * Helps kasir + dapur call out by name instead of pager number. */
  customerName?: string | null;
  items: CreateTransactionItemInput[];
  /** Client-claimed; server recomputes and rejects mismatch. */
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived: number | null;
  cashChange: number | null;
  /** For Staff-initiated discount: token from /api/v1/auth/verify-approver. */
  discountApproverToken?: string;
}

export interface VoidTransactionInput {
  transactionId: string;
  reason: string;
  /** Required for Staff. Validated against pos.transaction.void permission. */
  approverToken?: string;
}

export interface RefundTransactionInput {
  transactionId: string;
  reason: string;
  approverToken?: string;
}

/**
 * Save transaction as an open bill — items locked, stock decremented as
 * usual, but no payment yet. Status="open" until customer returns to pay.
 * Same shape as CreateTransactionInput minus payment fields (placeholders
 * are filled server-side with paymentMethod="cash", cashReceived=0).
 */
export interface SaveOpenBillInput {
  clientRefId?: string;
  shiftId: string;
  cashierId: string;
  pagerNumber: number;
  orderType: OrderType;
  customerName?: string | null;
  items: CreateTransactionItemInput[];
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  discountApproverToken?: string;
}

/**
 * Close an open bill — finalize payment + transition to "paid". Triggers
 * customer receipt auto-print on success (client-side after action).
 */
export interface CloseOpenBillInput {
  transactionId: string;
  paymentMethod: PaymentMethod;
  cashReceived: number | null;
}
