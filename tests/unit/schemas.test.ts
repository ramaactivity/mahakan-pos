import { describe, it, expect } from "vitest";
import {
  createMenuItemSchema,
  categoryNameSchema,
} from "@/features/menu/schemas";
import {
  createTransactionSchema,
  voidTransactionSchema,
} from "@/features/transactions/schemas";

describe("menu schemas", () => {
  describe("createMenuItemSchema", () => {
    it("accepts a valid fixed-price item", () => {
      const res = createMenuItemSchema.safeParse({
        name: "Ricebowl",
        categoryId: "11111111-1111-4111-8111-111111111111",
        priceType: "fixed",
        priceFixed: 23_000,
      });
      expect(res.success).toBe(true);
    });

    it("accepts a valid variant item with at least one price", () => {
      const res = createMenuItemSchema.safeParse({
        name: "Americano",
        categoryId: "11111111-1111-4111-8111-111111111111",
        priceType: "variant",
        priceHot: 17_000,
        priceIced: 16_000,
      });
      expect(res.success).toBe(true);
    });

    it("rejects variant with both prices null", () => {
      const res = createMenuItemSchema.safeParse({
        name: "Bad",
        categoryId: "11111111-1111-4111-8111-111111111111",
        priceType: "variant",
        priceHot: null,
        priceIced: null,
      });
      expect(res.success).toBe(false);
    });

    it("accepts open-price item", () => {
      const res = createMenuItemSchema.safeParse({
        name: "V60",
        categoryId: "11111111-1111-4111-8111-111111111111",
        priceType: "open",
      });
      expect(res.success).toBe(true);
    });

    it("rejects price above 999_999_999", () => {
      const res = createMenuItemSchema.safeParse({
        name: "Insane",
        categoryId: "11111111-1111-4111-8111-111111111111",
        priceType: "fixed",
        priceFixed: 1_000_000_000,
      });
      expect(res.success).toBe(false);
    });

    it("rejects negative price", () => {
      const res = createMenuItemSchema.safeParse({
        name: "Negative",
        categoryId: "11111111-1111-4111-8111-111111111111",
        priceType: "fixed",
        priceFixed: -1,
      });
      expect(res.success).toBe(false);
    });

    it("rejects empty name", () => {
      const res = createMenuItemSchema.safeParse({
        name: "",
        categoryId: "11111111-1111-4111-8111-111111111111",
        priceType: "fixed",
        priceFixed: 10_000,
      });
      expect(res.success).toBe(false);
    });
  });

  describe("categoryNameSchema", () => {
    it("trims and accepts valid name", () => {
      const res = categoryNameSchema.safeParse("  Pastry  ");
      expect(res.success).toBe(true);
      if (res.success) expect(res.data).toBe("Pastry");
    });

    it("rejects empty after trim", () => {
      expect(categoryNameSchema.safeParse("   ").success).toBe(false);
    });

    it("rejects > 50 chars", () => {
      expect(categoryNameSchema.safeParse("x".repeat(51)).success).toBe(false);
    });
  });
});

describe("transaction schemas", () => {
  describe("createTransactionSchema", () => {
    function validInput() {
      return {
        shiftId: "11111111-1111-4111-8111-111111111111",
        cashierId: "22222222-2222-4222-8222-222222222222",
        pagerNumber: 5,
        orderType: "takeaway" as const,
        items: [
          {
            menuItemId: "33333333-3333-4333-8333-333333333333",
            variant: null,
            quantity: 1,
            unitPrice: 23_000,
            modifiersPriceDelta: 0,
            subtotal: 23_000,
            note: null,
            openPriceNote: null,
            modifiers: [],
          },
        ],
        subtotal: 23_000,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        discountReason: null,
        total: 23_000,
        paymentMethod: "cash" as const,
        cashReceived: 23_000,
        cashChange: 0,
      };
    }

    it("accepts minimal valid payload", () => {
      const res = createTransactionSchema.safeParse(validInput());
      expect(res.success).toBe(true);
    });

    it("rejects pager outside 1-99", () => {
      const r1 = createTransactionSchema.safeParse({
        ...validInput(),
        pagerNumber: 0,
      });
      const r2 = createTransactionSchema.safeParse({
        ...validInput(),
        pagerNumber: 100,
      });
      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
    });

    it("rejects empty items array", () => {
      const res = createTransactionSchema.safeParse({
        ...validInput(),
        items: [],
      });
      expect(res.success).toBe(false);
    });

    it("rejects qty 0 line item", () => {
      const v = validInput();
      v.items[0].quantity = 0;
      expect(createTransactionSchema.safeParse(v).success).toBe(false);
    });

    it("rejects negative money", () => {
      const v = validInput();
      v.items[0].unitPrice = -1;
      expect(createTransactionSchema.safeParse(v).success).toBe(false);
    });

    it("accepts optional clientRefId UUID", () => {
      const v = validInput();
      const res = createTransactionSchema.safeParse({
        ...v,
        clientRefId: "44444444-4444-4444-8444-444444444444",
      });
      expect(res.success).toBe(true);
    });
  });

  describe("voidTransactionSchema", () => {
    it("accepts valid input", () => {
      const res = voidTransactionSchema.safeParse({
        transactionId: "11111111-1111-4111-8111-111111111111",
        reason: "Customer cancel",
      });
      expect(res.success).toBe(true);
    });

    it("rejects short reason", () => {
      expect(
        voidTransactionSchema.safeParse({
          transactionId: "11111111-1111-4111-8111-111111111111",
          reason: "ok",
        }).success,
      ).toBe(false);
    });

    it("rejects non-uuid transactionId", () => {
      expect(
        voidTransactionSchema.safeParse({
          transactionId: "not-uuid",
          reason: "Customer cancel",
        }).success,
      ).toBe(false);
    });
  });
});
