import type { InferSelectModel } from "drizzle-orm";
import type {
  transactions,
  transactionItems,
  transactionItemModifiers,
  splitPayments,
  splitPaymentItems,
} from "@/db/schema";

export type Transaction = InferSelectModel<typeof transactions>;
export type TransactionItem = InferSelectModel<typeof transactionItems>;
export type TransactionItemModifier = InferSelectModel<
  typeof transactionItemModifiers
>;
export type SplitPayment = InferSelectModel<typeof splitPayments>;
export type SplitPaymentItem = InferSelectModel<typeof splitPaymentItems>;
export type SplitKind = "nominal" | "per_menu";

/** A single split event with its per-menu detail rows joined in. */
export interface SplitPaymentWithItems extends SplitPayment {
  items: SplitPaymentItem[];
}

/** Aggregate split-payment summary for a transaction — drives BillCard
 * progress badge + HistoryDetailModal breakdown. */
export interface SplitPaymentBreakdown {
  splits: SplitPaymentWithItems[];
  totalPaid: number;
  remainingAmount: number;
  /** Map: transactionItemId → quantity already paid via per_menu splits.
   * Used to compute remaining unpaid items when adding the next split. */
  paidQuantityByTrxItemId: Record<string, number>;
}

export interface SplitPaymentItemInput {
  transactionItemId: string;
  quantity: number;
}

export interface AddSplitPaymentInput {
  transactionId: string;
  amount: number;
  paymentMethod: Exclude<PaymentMethod, "split">;
  cashReceived: number | null;
  cashChange: number | null;
  splitKind: SplitKind;
  /** Required when splitKind = 'per_menu'; ignored otherwise. */
  items?: SplitPaymentItemInput[];
}

export type Variant = "hot" | "iced";
export type DiscountType = "percent" | "fixed";
export type PaymentMethod =
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other"
  | "split";

/**
 * All concrete card EDC methods (excludes "split" composite). Used by code
 * that needs to enumerate the bank-card variants for filtering, summing,
 * accounting routing, etc.
 */
export const CARD_PAYMENT_METHODS = [
  "card_bca",
  "card_bni",
  "card_mandiri",
  "card_bri",
  "card_other",
] as const;
export type CardPaymentMethod = (typeof CARD_PAYMENT_METHODS)[number];

export function isCardPayment(m: string): m is CardPaymentMethod {
  return (CARD_PAYMENT_METHODS as readonly string[]).includes(m);
}
export type OrderType = "dine_in" | "takeaway";
export type TransactionStatus =
  | "paid"
  | "voided"
  | "refunded"
  | "open"
  | "partially_refunded";

/** Loyalty member snapshot embedded in transaction queries for receipt
 * rendering + history modals. Populated via LEFT JOIN customers in
 * fetchTransactionById; null when transaction has no linked member. */
export interface TransactionMemberInfo {
  id: string;
  name: string;
  phone: string;
  totalPoints: number;
}

export interface TransactionWithItems extends Transaction {
  items: Array<TransactionItem & { modifiers: TransactionItemModifier[] }>;
  member?: TransactionMemberInfo | null;
  /** Sesi AE-156d — split payments breakdown (cuma populated kalau
   *  paymentMethod="split"). Empty array kalau bukan split. */
  splits?: SplitPaymentWithItems[];
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
  pagerNumber: number | null;
  orderType: OrderType;
  /** Optional free-form label — customer name, "Meja 5", "Gojek", etc.
   * Helps kasir + dapur call out by name instead of pager number. Also
   * supplies the name for loyalty record creation when customerPhone is
   * provided and the customer doesn't yet exist. */
  customerName?: string | null;
  /** Optional phone (digits-only or formatted) for loyalty linkage. When
   * supplied + valid (>=6 digits), server finds-or-creates a customer and
   * earns points on the sale total. */
  customerPhone?: string | null;
  /** Optional bill-level note (catatan khusus pesanan). Max 200 chars,
   * trimmed; empty string normalized to null server-side. */
  note?: string | null;
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
  /** Sesi AE-195 — kode approval compliment yang sudah dikonsumsi. */
  /** Sesi AE-221 — PIN statis compliment, diverifikasi server. */
  complimentPin?: string;
  /** Loyalty redemption: number of points the member tukar on this sale.
   * When >0, server validates customerId is set + balance ≥ N + the
   * provided discountAmount equals N * RUPIAH_PER_POINT_REDEEMED + the
   * discountReason starts with "Tukar Poin:". The redemption rupiah rides
   * on the existing discount slot — XOR with manual discount/compliment
   * is enforced UI-side. */
  loyaltyPointsRedeemed?: number | null;
  /** Sesi K — when discount comes from a master promo, set this to the
   * promo's UUID. Server validates eligibility, inserts promo_usages row,
   * and increments promos.currentUses (all in same DB tx). */
  promoId?: string | null;
  /** Sesi AE-155 — Split metode payment di direct sale (POS).
   *  Saat di-set + non-empty: paymentMethod harus "split", cashReceived +
   *  cashChange harus null (per check constraint), dan SUM(splits.amount)
   *  harus exactly = total. Server insert split_payments rows + journal
   *  pakai postJournalForPosSale yang sudah split-aware.
   *
   *  Beda dengan addSplitPayment (open-bill flow): di sini transaksi langsung
   *  paid + split rows ter-create dalam 1 server action atomic. Cocok untuk
   *  kasir yang langsung tahu mau split saat checkout (tidak via save-bill
   *  dulu).
   *
   *  Empty array atau undefined = single-method payment (existing behavior). */
  splits?: CreateTransactionSplitInput[];
}

/** Sesi AE-155 — Per-split entry untuk direct-sale split payment. */
export interface CreateTransactionSplitInput {
  /** Method untuk split ini. Tidak boleh "split" (rekursi). */
  paymentMethod: Exclude<PaymentMethod, "split">;
  /** Rupiah amount untuk split ini. Sum semua splits harus = transaction.total. */
  amount: number;
  /** Cash received (only kalau paymentMethod="cash" + split terakhir
   *  yang mungkin punya change). Else null. */
  cashReceived: number | null;
  /** Change (cashReceived - amount). Hanya kalau cash. Else null. */
  cashChange: number | null;
}

export interface VoidTransactionInput {
  transactionId: string;
  reason: string;
  /** Legacy "pin" mode — JWT from /api/v1/auth/verify-approver. */
  approverToken?: string;
  /** New "code" mode (B-2) — 6-digit Owner-issued approval code. */
  approvalCode?: string;
  /** Direct-approve mode (Pusat Persetujuan, owner-only). Bypass code/PIN,
   * server revoke active codes inline. */
  directOwnerApprove?: boolean;
}

export interface RefundTransactionInput {
  transactionId: string;
  reason: string;
  approverToken?: string;
  approvalCode?: string;
  /** Direct-approve mode (Pusat Persetujuan, owner-only). */
  directOwnerApprove?: boolean;
}

/** Per-item line for a partial refund request. */
export interface RefundTransactionPartialItem {
  transactionItemId: string;
  /** Number of units to refund this round; must be in (0, item.quantity - item.refundedQuantity]. */
  quantity: number;
}

export interface RefundTransactionPartialInput {
  transactionId: string;
  items: RefundTransactionPartialItem[];
  reason: string;
  approverToken?: string;
  approvalCode?: string;
  /** Sesi AE-62v — UUID untuk idempotent submit (network retry / double-click). */
  clientRefId?: string;
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
  pagerNumber: number | null;
  orderType: OrderType;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  items: CreateTransactionItemInput[];
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  discountApproverToken?: string;
  /** Sesi AE-195 — kode approval compliment yang sudah dikonsumsi. */
  /** Sesi AE-221 — PIN statis compliment, diverifikasi server. */
  complimentPin?: string;
  /** Sesi K — same semantics as CreateTransactionInput.promoId. */
  promoId?: string | null;
}

/**
 * Close an open bill — finalize payment + transition to "paid". Triggers
 * customer receipt auto-print on success (client-side after action).
 */
/** Sesi AE-36 — close open bill. paymentMethod excludes 'split' karena
 *  itu sentinel value yang dipasang server kalau ada prior splits. */
export interface CloseOpenBillInput {
  transactionId: string;
  paymentMethod: Exclude<PaymentMethod, "split">;
  cashReceived: number | null;
}

/**
 * Edit an open bill — replace items + recompute totals. Stock is restored
 * for the old items, then deducted again for the new items. Status remains
 * "open"; payment fields untouched.
 */
export interface EditOpenBillInput {
  transactionId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  items: CreateTransactionItemInput[];
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  discountApproverToken?: string;
  /** Sesi AE-195 — kode approval compliment yang sudah dikonsumsi kasir. */
  /** Sesi AE-221 — PIN statis compliment, diverifikasi server. */
  complimentPin?: string;
  /** Sesi K — same semantics as CreateTransactionInput.promoId. */
  promoId?: string | null;
}

/** Sesi AE-62k — cancel open bill (customer batal / no-show). */
export interface CancelOpenBillInput {
  transactionId: string;
  reason: string;
}
