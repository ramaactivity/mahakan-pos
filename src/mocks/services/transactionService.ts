import {
  OUTLET_ID,
  mockMenuItems,
  mockTransactions,
  EXPENSE_CAT_REFUND_ID,
} from "../data";
import {
  computeDiscountAmount,
  computeItemSubtotal,
  computeTotal,
} from "@/lib/money";
import type {
  ApiResult,
  DiscountType,
  Expense,
  OrderType,
  Paginated,
  PaymentMethod,
  Transaction,
  TransactionItem,
  TransactionItemModifier,
  TransactionStatus,
  Variant,
} from "../types";
import { delay, fail, genId, genTransactionNumber, ok } from "./_helpers";
import { _internalAddRefundExpense } from "./expenseService";

// Mutable working copy
let transactions: Transaction[] = mockTransactions.map((t) => ({
  ...t,
  items: t.items.map((it) => ({
    ...it,
    modifiers: it.modifiers.map((m) => ({ ...m })),
  })),
}));

// --------------------------------------------------------------------------
// Input shapes (match future Server Action signatures)
// --------------------------------------------------------------------------

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
  clientRefId?: string;
  shiftId: string;
  cashierId: string;
  pagerNumber: number;
  orderType: OrderType;
  items: CreateTransactionItemInput[];
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived: number | null;
  cashChange: number | null;
  /** For staff-initiated actions that need override. */
  discountApproverToken?: string;
  discountApproverId?: string;
}

// --------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------

export interface ListTransactionOptions {
  shiftId?: string;
  status?: TransactionStatus;
  paymentMethod?: PaymentMethod;
  /** Inclusive ISO date range. */
  from?: string;
  to?: string;
  /** Pager number or transaction number substring. */
  search?: string;
  limit?: number;
}

export async function listTransactions(
  options: ListTransactionOptions = {},
): Promise<ApiResult<Paginated<Transaction>>> {
  await delay();

  const { shiftId, status, paymentMethod, from, to, search, limit = 50 } = options;
  const searchLower = search?.toLowerCase().trim();

  const filtered = transactions.filter((t) => {
    if (shiftId && t.shiftId !== shiftId) return false;
    if (status && t.status !== status) return false;
    if (paymentMethod && t.paymentMethod !== paymentMethod) return false;
    if (from && t.createdAt < from) return false;
    if (to && t.createdAt > to) return false;
    if (searchLower) {
      const matchNumber = t.transactionNumber.toLowerCase().includes(searchLower);
      const matchPager = String(t.pagerNumber).includes(searchLower);
      if (!matchNumber && !matchPager) return false;
    }
    return true;
  });

  filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return ok({
    items: filtered.slice(0, limit),
    total: filtered.length,
    hasMore: filtered.length > limit,
  });
}

export async function getTransaction(
  id: string,
): Promise<ApiResult<Transaction>> {
  await delay();
  const found = transactions.find((t) => t.id === id);
  if (!found) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  return ok({ ...found });
}

// --------------------------------------------------------------------------
// Create — with server-side validation mimicking future Server Action
// --------------------------------------------------------------------------

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<ApiResult<Transaction>> {
  await delay();

  // Idempotency check (per docs/08-API-SPEC.md §4.1 + 14.2)
  if (input.clientRefId) {
    const existing = transactions.find((t) => t.clientRefId === input.clientRefId);
    if (existing) {
      return ok({ ...existing });
    }
  }

  if (input.items.length === 0) {
    return fail("VALIDATION_ERROR", "Order harus punya minimal 1 item");
  }
  if (input.pagerNumber < 1 || input.pagerNumber > 99) {
    return fail("VALIDATION_ERROR", "Pager number harus 1-99");
  }

  // Recompute subtotal + totals server-side (per docs/03-TSD.md §5.3)
  const recomputedItemSubtotals = input.items.map((item) => {
    const menuItem = mockMenuItems.find((m) => m.id === item.menuItemId);
    if (!menuItem) {
      throw new Error(`MENU_ITEM_NOT_FOUND:${item.menuItemId}`);
    }
    if (menuItem.isSoldOut) {
      throw new Error(`MENU_ITEM_SOLD_OUT:${item.menuItemId}`);
    }
    // Price match check (unless open-price item, which allows manual pricing)
    if (menuItem.priceType !== "open") {
      const expected =
        menuItem.priceType === "fixed"
          ? menuItem.priceFixed
          : item.variant === "hot"
            ? menuItem.priceHot
            : menuItem.priceIced;
      if (expected === null || expected !== item.unitPrice) {
        throw new Error(`PRICE_MISMATCH:${item.menuItemId}`);
      }
    }
    return computeItemSubtotal(
      item.unitPrice,
      item.modifiersPriceDelta,
      item.quantity,
    );
  });

  // Validate — use try/catch pattern since computeItemSubtotal can throw
  let recomputedSubtotal: number;
  try {
    recomputedSubtotal = recomputedItemSubtotals.reduce((sum, s) => sum + s, 0);
  } catch (e) {
    const err = e instanceof Error ? e : new Error("Unknown");
    const [code, itemId] = err.message.split(":");
    if (code === "MENU_ITEM_NOT_FOUND") {
      return fail("NOT_FOUND", `Menu item tidak ditemukan: ${itemId}`);
    }
    if (code === "MENU_ITEM_SOLD_OUT") {
      return fail("MENU_ITEM_SOLD_OUT", `Item sold-out: ${itemId}`);
    }
    if (code === "PRICE_MISMATCH") {
      return fail("PRICE_MISMATCH", `Harga tidak sesuai: ${itemId}`);
    }
    return fail("VALIDATION_ERROR", err.message);
  }

  if (recomputedSubtotal !== input.subtotal) {
    return fail(
      "SUBTOTAL_MISMATCH",
      `Subtotal server (${recomputedSubtotal}) ≠ client (${input.subtotal})`,
    );
  }

  const discount =
    input.discountType && input.discountValue !== null
      ? { type: input.discountType, value: input.discountValue }
      : null;
  const recomputedDiscount = computeDiscountAmount(recomputedSubtotal, discount);
  if (recomputedDiscount !== input.discountAmount) {
    return fail(
      "DISCOUNT_MISMATCH",
      `Diskon server (${recomputedDiscount}) ≠ client (${input.discountAmount})`,
    );
  }

  const recomputedTotal = computeTotal(recomputedSubtotal, recomputedDiscount);
  if (recomputedTotal !== input.total) {
    return fail(
      "TOTAL_MISMATCH",
      `Total server (${recomputedTotal}) ≠ client (${input.total})`,
    );
  }

  // Cash validation
  if (input.paymentMethod === "cash") {
    if (input.cashReceived === null || input.cashReceived < recomputedTotal) {
      return fail(
        "INSUFFICIENT_CASH",
        "Uang diterima kurang dari total transaksi",
      );
    }
    const expectedChange = input.cashReceived - recomputedTotal;
    if (input.cashChange !== expectedChange) {
      return fail("CASH_CHANGE_MISMATCH", "Kembalian tidak sesuai perhitungan");
    }
  }

  // Discount approver check — per docs/05-ROLES-RBAC.md §6
  // Mocks: if discount present and token provided, trust it. Real verify in Fase B.
  // (UI caller is responsible for calling verifyApprover first for Staff.)

  // Generate transaction number (WIB day + sequence)
  const now = new Date();
  const todayTrxCount = transactions.filter(
    (t) => t.transactionNumber.startsWith(genTransactionNumber(now, 1).slice(0, 12)),
  ).length;
  const transactionNumber = genTransactionNumber(now, todayTrxCount + 1);

  const trxId = genId("trx");
  const nowIso = now.toISOString();

  const items: TransactionItem[] = input.items.map((item) => {
    const itemId = genId("trxitem");
    const menuItem = mockMenuItems.find((m) => m.id === item.menuItemId);
    const modifiers: TransactionItemModifier[] = item.modifiers.map((mod) => ({
      id: genId("trxmod"),
      transactionItemId: itemId,
      modifierSlug: mod.modifierSlug,
      selectedValue: mod.selectedValue,
      priceDelta: mod.priceDelta,
      createdAt: nowIso,
    }));
    return {
      id: itemId,
      transactionId: trxId,
      menuItemId: item.menuItemId,
      itemName: menuItem?.name ?? "Unknown",
      itemCategoryName: "", // filled below
      variant: item.variant,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      modifiersPriceDelta: item.modifiersPriceDelta,
      subtotal: computeItemSubtotal(
        item.unitPrice,
        item.modifiersPriceDelta,
        item.quantity,
      ),
      note: item.note,
      openPriceNote: item.openPriceNote,
      modifiers,
      createdAt: nowIso,
    };
  });

  const newTrx: Transaction = {
    id: trxId,
    outletId: OUTLET_ID,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
    clientRefId: input.clientRefId ?? null,
    transactionNumber,
    pagerNumber: input.pagerNumber,
    orderType: input.orderType,
    subtotal: recomputedSubtotal,
    discountType: input.discountType,
    discountValue: input.discountValue,
    discountAmount: recomputedDiscount,
    discountReason: input.discountReason,
    total: recomputedTotal,
    paymentMethod: input.paymentMethod,
    cashReceived: input.cashReceived,
    cashChange: input.cashChange,
    status: "paid",
    voidedAt: null,
    voidedBy: null,
    voidedApprover: null,
    voidReason: null,
    refundedAt: null,
    refundedBy: null,
    refundedApprover: null,
    refundReason: null,
    discountApprover: input.discountApproverId ?? null,
    servedAt: null,
    items,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  transactions = [...transactions, newTrx];
  return ok(newTrx);
}

// --------------------------------------------------------------------------
// Mutations — void, refund, mark served
// --------------------------------------------------------------------------

export interface VoidTransactionInput {
  transactionId: string;
  reason: string;
  voidedBy: string;
  approverId?: string;
  approverToken?: string;
}

export async function voidTransaction(
  input: VoidTransactionInput,
): Promise<ApiResult<Transaction>> {
  await delay();
  const index = transactions.findIndex((t) => t.id === input.transactionId);
  if (index === -1) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  const current = transactions[index];
  if (current.status === "voided") {
    return fail("ALREADY_VOIDED", "Transaksi sudah di-void sebelumnya");
  }
  if (current.status === "refunded") {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Transaksi sudah di-refund, tidak bisa di-void",
    );
  }

  const now = new Date().toISOString();
  transactions[index] = {
    ...current,
    status: "voided",
    voidedAt: now,
    voidedBy: input.voidedBy,
    voidedApprover: input.approverId ?? null,
    voidReason: input.reason,
    updatedAt: now,
  };
  return ok({ ...transactions[index] });
}

export interface RefundTransactionInput {
  transactionId: string;
  reason: string;
  refundedBy: string;
  approverId?: string;
  approverToken?: string;
}

export async function refundTransaction(
  input: RefundTransactionInput,
): Promise<ApiResult<{ transaction: Transaction; autoExpense: Expense }>> {
  await delay();
  const index = transactions.findIndex((t) => t.id === input.transactionId);
  if (index === -1) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  const current = transactions[index];

  if (current.status !== "paid") {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Hanya transaksi paid yang bisa di-refund",
    );
  }
  if (current.paymentMethod !== "cash") {
    return fail(
      "REFUND_NOT_ALLOWED_NON_CASH",
      "Phase 1: hanya cash yang bisa di-refund",
    );
  }

  // Same-day only (WIB)
  const createdDay = current.createdAt.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (createdDay !== today) {
    return fail(
      "REFUND_NOT_ALLOWED_PAST_DAY",
      "Phase 1: refund hanya untuk transaksi hari yang sama",
    );
  }

  const now = new Date().toISOString();
  transactions[index] = {
    ...current,
    status: "refunded",
    refundedAt: now,
    refundedBy: input.refundedBy,
    refundedApprover: input.approverId ?? null,
    refundReason: input.reason,
    updatedAt: now,
  };

  // Auto-generate expense entry under "Refund" system category
  const autoExpense = _internalAddRefundExpense({
    refundedTransactionId: current.id,
    transactionNumber: current.transactionNumber,
    reason: input.reason,
    amount: current.total,
    createdBy: input.refundedBy,
    categoryId: EXPENSE_CAT_REFUND_ID,
  });

  return ok({ transaction: { ...transactions[index] }, autoExpense });
}

export async function markServed(id: string): Promise<ApiResult<Transaction>> {
  await delay();
  const index = transactions.findIndex((t) => t.id === id);
  if (index === -1) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  const now = new Date().toISOString();
  transactions[index] = { ...transactions[index], servedAt: now, updatedAt: now };
  return ok({ ...transactions[index] });
}

/** Test-only — reset mutable state. */
export function __resetTransactionState(): void {
  transactions = mockTransactions.map((t) => ({
    ...t,
    items: t.items.map((it) => ({
      ...it,
      modifiers: it.modifiers.map((m) => ({ ...m })),
    })),
  }));
}

/** Internal read access for cross-service aggregations (reportService). */
export function _internalAllTransactions(): readonly Transaction[] {
  return transactions;
}
