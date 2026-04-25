import { describe, it, expect } from "vitest";
import { validateCreateTransaction } from "@/features/transactions/validation";
import type {
  CreateTransactionInput,
  CreateTransactionItemInput,
} from "@/features/transactions";
import type { MenuItem } from "@/features/menu";

const REF_DATE = new Date("2026-04-25T07:00:00Z");

function fixedItem(
  id: string,
  name: string,
  price: number,
  isSoldOut = false,
): MenuItem {
  return {
    id,
    outletId: "outlet-1",
    categoryId: "cat-1",
    name,
    description: null,
    priceType: "fixed",
    priceFixed: price,
    priceHot: null,
    priceIced: null,
    isSignature: false,
    isSoldOut,
    isActive: true,
    displayOrder: 1,
    costPrice: null,
    recipeId: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
  };
}

function variantItem(
  id: string,
  name: string,
  hot: number | null,
  iced: number | null,
): MenuItem {
  return { ...fixedItem(id, name, 0), priceType: "variant", priceFixed: null, priceHot: hot, priceIced: iced };
}

function openItem(id: string, name: string): MenuItem {
  return { ...fixedItem(id, name, 0), priceType: "open", priceFixed: null };
}

function lineItem(
  partial: Partial<CreateTransactionItemInput> & {
    menuItemId: string;
    unitPrice: number;
    quantity: number;
  },
): CreateTransactionItemInput {
  const subtotal =
    (partial.unitPrice + (partial.modifiersPriceDelta ?? 0)) * partial.quantity;
  return {
    menuItemId: partial.menuItemId,
    variant: partial.variant ?? null,
    quantity: partial.quantity,
    unitPrice: partial.unitPrice,
    modifiersPriceDelta: partial.modifiersPriceDelta ?? 0,
    subtotal,
    note: null,
    openPriceNote: null,
    modifiers: [],
    ...partial,
  };
}

function payload(
  overrides: Partial<CreateTransactionInput> = {},
): CreateTransactionInput {
  const items = overrides.items ?? [
    lineItem({ menuItemId: "m1", unitPrice: 23_000, quantity: 1 }),
  ];
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  return {
    shiftId: "00000000-0000-0000-0000-000000000001",
    cashierId: "00000000-0000-0000-0000-000000000002",
    pagerNumber: 5,
    orderType: "takeaway",
    items,
    subtotal,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    discountReason: null,
    total: subtotal,
    paymentMethod: "cash",
    cashReceived: subtotal,
    cashChange: 0,
    ...overrides,
  };
}

describe("validateCreateTransaction — happy path", () => {
  it("fixed-price single item, cash exact", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const res = validateCreateTransaction(payload(), menu);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.recomputedSubtotal).toBe(23_000);
      expect(res.recomputedTotal).toBe(23_000);
      expect(res.recomputedDiscountAmount).toBe(0);
    }
  });

  it("variant Hot/Iced with correct iced price", () => {
    const menu = [variantItem("m1", "Americano", 17_000, 16_000)];
    const items = [
      lineItem({ menuItemId: "m1", unitPrice: 16_000, quantity: 2, variant: "iced" }),
    ];
    const res = validateCreateTransaction(payload({ items, subtotal: 32_000, total: 32_000, cashReceived: 50_000, cashChange: 18_000 }), menu);
    expect(res.ok).toBe(true);
  });

  it("open-price within bounds", () => {
    const menu = [openItem("mb-1", "V60")];
    const items = [lineItem({ menuItemId: "mb-1", unitPrice: 35_000, quantity: 1 })];
    const res = validateCreateTransaction(payload({ items, subtotal: 35_000, total: 35_000, cashReceived: 35_000, cashChange: 0 }), menu);
    expect(res.ok).toBe(true);
  });

  it("percent discount applied + cash change", () => {
    const menu = [fixedItem("m1", "Ricebowl", 100_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 100_000, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({
        items,
        subtotal: 100_000,
        discountType: "percent",
        discountValue: 10,
        discountAmount: 10_000,
        discountReason: "Promo Staff",
        total: 90_000,
        cashReceived: 100_000,
        cashChange: 10_000,
      }),
      menu,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.recomputedDiscountAmount).toBe(10_000);
      expect(res.recomputedTotal).toBe(90_000);
    }
  });

  it("non-cash payment with null cashReceived/cashChange", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 23_000, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({
        items,
        paymentMethod: "qris",
        cashReceived: null,
        cashChange: null,
      }),
      menu,
    );
    expect(res.ok).toBe(true);
  });
});

describe("validateCreateTransaction — failures", () => {
  it("rejects empty order", () => {
    const res = validateCreateTransaction(payload({ items: [] }), []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("EMPTY_ORDER");
  });

  it("rejects missing menu item", () => {
    const res = validateCreateTransaction(payload(), []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("MENU_ITEM_NOT_FOUND");
  });

  it("rejects sold-out menu item", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000, true)];
    const res = validateCreateTransaction(payload(), menu);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("MENU_ITEM_SOLD_OUT");
  });

  it("rejects price tampering on fixed item", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const items = [
      lineItem({ menuItemId: "m1", unitPrice: 1_000, quantity: 1 }),
    ];
    const res = validateCreateTransaction(payload({ items, subtotal: 1_000, total: 1_000, cashReceived: 1_000, cashChange: 0 }), menu);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PRICE_MISMATCH");
  });

  it("rejects open-price below floor", () => {
    const menu = [openItem("mb-1", "V60")];
    const items = [lineItem({ menuItemId: "mb-1", unitPrice: 500, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({ items, subtotal: 500, total: 500, cashReceived: 500, cashChange: 0 }),
      menu,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("OPEN_PRICE_OUT_OF_RANGE");
  });

  it("rejects subtotal mismatch (client claims wrong sum)", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 23_000, quantity: 1 })];
    const tampered = payload({ items, subtotal: 99_999, total: 99_999, cashReceived: 99_999, cashChange: 0 });
    // subtotal ok per item, but client total claim is wrong; the per-item subtotal mismatch handles it via item.subtotal
    // To trigger SUBTOTAL_MISMATCH at the aggregate level, override only top-level subtotal:
    tampered.subtotal = 99_999;
    tampered.items[0].subtotal = 23_000; // honest per-item
    const res = validateCreateTransaction(tampered, menu);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(["SUBTOTAL_MISMATCH", "TOTAL_MISMATCH"]).toContain(res.code);
    }
  });

  it("rejects discount tampering", () => {
    const menu = [fixedItem("m1", "Ricebowl", 100_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 100_000, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({
        items,
        subtotal: 100_000,
        discountType: "percent",
        discountValue: 10,
        discountAmount: 50_000, // claim 50% off when value=10
        total: 50_000,
        cashReceived: 50_000,
        cashChange: 0,
      }),
      menu,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("DISCOUNT_MISMATCH");
  });

  it("rejects total mismatch", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 23_000, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({ items, subtotal: 23_000, total: 1_000, cashReceived: 1_000, cashChange: 0 }),
      menu,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("TOTAL_MISMATCH");
  });

  it("rejects insufficient cash", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 23_000, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({ items, cashReceived: 1_000, cashChange: 0 }),
      menu,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INSUFFICIENT_CASH");
  });

  it("rejects wrong cash change", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 23_000, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({ items, cashReceived: 50_000, cashChange: 99_999 }),
      menu,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CASH_CHANGE_MISMATCH");
  });

  it("rejects cash fields on non-cash payment", () => {
    const menu = [fixedItem("m1", "Ricebowl", 23_000)];
    const items = [lineItem({ menuItemId: "m1", unitPrice: 23_000, quantity: 1 })];
    const res = validateCreateTransaction(
      payload({
        items,
        paymentMethod: "qris",
        cashReceived: 50_000,
        cashChange: 27_000,
      }),
      menu,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CASH_FIELDS_INVALID");
  });
});

describe("validateCreateTransaction — modifiers", () => {
  it("includes modifier price delta in item subtotal", () => {
    const menu = [variantItem("m1", "Americano", 17_000, 16_000)];
    const items = [
      lineItem({
        menuItemId: "m1",
        unitPrice: 17_000,
        quantity: 1,
        variant: "hot",
        modifiersPriceDelta: 8_000, // extra shot
      }),
    ];
    const res = validateCreateTransaction(
      payload({ items, subtotal: 25_000, total: 25_000, cashReceived: 25_000, cashChange: 0 }),
      menu,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recomputedSubtotal).toBe(25_000);
  });
});
