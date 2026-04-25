import {
  computeDiscountAmount,
  computeItemSubtotal,
  computeTotal,
  type Discount,
} from "@/lib/money";
import type { MenuItem } from "@/features/menu";
import type { CreateTransactionInput } from "./types";

export type ValidationFail =
  | { code: "EMPTY_ORDER"; message: string }
  | { code: "MENU_ITEM_NOT_FOUND"; message: string }
  | { code: "MENU_ITEM_SOLD_OUT"; message: string }
  | { code: "PRICE_MISMATCH"; message: string }
  | { code: "OPEN_PRICE_OUT_OF_RANGE"; message: string }
  | { code: "SUBTOTAL_MISMATCH"; message: string }
  | { code: "DISCOUNT_MISMATCH"; message: string }
  | { code: "TOTAL_MISMATCH"; message: string }
  | { code: "INSUFFICIENT_CASH"; message: string }
  | { code: "CASH_CHANGE_MISMATCH"; message: string }
  | { code: "CASH_FIELDS_INVALID"; message: string };

export interface ValidationOk {
  recomputedSubtotal: number;
  recomputedDiscountAmount: number;
  recomputedTotal: number;
}

export type ValidationResult =
  | ({ ok: true } & ValidationOk)
  | ({ ok: false } & ValidationFail);

const OPEN_PRICE_MIN = 1_000;
const OPEN_PRICE_MAX = 9_999_999;

/**
 * Re-validate a CreateTransactionInput against authoritative menu data.
 * Pure function (no DB access) — caller must fetch menuItems first and pass
 * them in. Mirrors mock transactionService.createTransaction validation.
 */
export function validateCreateTransaction(
  input: CreateTransactionInput,
  menuItems: ReadonlyArray<MenuItem>,
): ValidationResult {
  if (input.items.length === 0) {
    return { ok: false, code: "EMPTY_ORDER", message: "Order harus punya minimal 1 item" };
  }

  const menuById = new Map(menuItems.map((m) => [m.id, m]));

  let recomputedSubtotal = 0;

  for (const item of input.items) {
    const menu = menuById.get(item.menuItemId);
    if (!menu) {
      return {
        ok: false,
        code: "MENU_ITEM_NOT_FOUND",
        message: `Menu item tidak ditemukan: ${item.menuItemId}`,
      };
    }
    if (menu.isSoldOut) {
      return {
        ok: false,
        code: "MENU_ITEM_SOLD_OUT",
        message: `Item sold-out: ${menu.name}`,
      };
    }
    if (menu.deletedAt !== null) {
      return {
        ok: false,
        code: "MENU_ITEM_NOT_FOUND",
        message: `Menu item dihapus: ${menu.name}`,
      };
    }

    if (menu.priceType === "open") {
      // Manual brew etc — barista enters the price, but we still bound it.
      if (
        item.unitPrice < OPEN_PRICE_MIN ||
        item.unitPrice > OPEN_PRICE_MAX
      ) {
        return {
          ok: false,
          code: "OPEN_PRICE_OUT_OF_RANGE",
          message: `Open-price harus ${OPEN_PRICE_MIN}-${OPEN_PRICE_MAX}: ${menu.name}`,
        };
      }
    } else {
      const expected =
        menu.priceType === "fixed"
          ? menu.priceFixed
          : item.variant === "hot"
            ? menu.priceHot
            : menu.priceIced;
      if (expected === null || expected !== item.unitPrice) {
        return {
          ok: false,
          code: "PRICE_MISMATCH",
          message: `Harga tidak sesuai untuk ${menu.name}`,
        };
      }
    }

    const itemSub = computeItemSubtotal(
      item.unitPrice,
      item.modifiersPriceDelta,
      item.quantity,
    );
    if (itemSub !== item.subtotal) {
      return {
        ok: false,
        code: "SUBTOTAL_MISMATCH",
        message: `Subtotal item ${menu.name} salah`,
      };
    }
    recomputedSubtotal += itemSub;
  }

  if (recomputedSubtotal !== input.subtotal) {
    return {
      ok: false,
      code: "SUBTOTAL_MISMATCH",
      message: `Subtotal server (${recomputedSubtotal}) ≠ client (${input.subtotal})`,
    };
  }

  const discount: Discount | null =
    input.discountType && input.discountValue !== null
      ? { type: input.discountType, value: input.discountValue }
      : null;
  const recomputedDiscountAmount = computeDiscountAmount(
    recomputedSubtotal,
    discount,
  );
  if (recomputedDiscountAmount !== input.discountAmount) {
    return {
      ok: false,
      code: "DISCOUNT_MISMATCH",
      message: `Diskon server (${recomputedDiscountAmount}) ≠ client (${input.discountAmount})`,
    };
  }

  const recomputedTotal = computeTotal(
    recomputedSubtotal,
    recomputedDiscountAmount,
  );
  if (recomputedTotal !== input.total) {
    return {
      ok: false,
      code: "TOTAL_MISMATCH",
      message: `Total server (${recomputedTotal}) ≠ client (${input.total})`,
    };
  }

  if (input.paymentMethod === "cash") {
    if (input.cashReceived === null || input.cashReceived < recomputedTotal) {
      return {
        ok: false,
        code: "INSUFFICIENT_CASH",
        message: "Uang diterima kurang dari total transaksi",
      };
    }
    const expectedChange = input.cashReceived - recomputedTotal;
    if (input.cashChange !== expectedChange) {
      return {
        ok: false,
        code: "CASH_CHANGE_MISMATCH",
        message: "Kembalian tidak sesuai perhitungan",
      };
    }
  } else {
    if (input.cashReceived !== null || input.cashChange !== null) {
      return {
        ok: false,
        code: "CASH_FIELDS_INVALID",
        message: "cashReceived/cashChange harus null untuk non-cash",
      };
    }
  }

  return {
    ok: true,
    recomputedSubtotal,
    recomputedDiscountAmount,
    recomputedTotal,
  };
}
