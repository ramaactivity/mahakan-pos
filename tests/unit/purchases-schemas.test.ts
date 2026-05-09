import { describe, expect, it } from "vitest";
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  markPaidSchema,
} from "@/features/purchases/schemas";

const validUuid = "11111111-2222-4333-8444-555555555555";
const validUuid2 = "11111111-2222-4333-8444-666666666666";

describe("purchase zod schemas", () => {
  describe("createPurchaseSchema", () => {
    it("accepts minimal cash purchase", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [
          { ingredientId: validUuid, qty: 5, unitCost: 1000 },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejects empty items", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [],
      });
      expect(r.success).toBe(false);
    });

    it("rejects qty <= 0", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [{ ingredientId: validUuid, qty: 0, unitCost: 1000 }],
      });
      expect(r.success).toBe(false);
    });

    it("rejects negative unit cost", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [{ ingredientId: validUuid, qty: 5, unitCost: -100 }],
      });
      expect(r.success).toBe(false);
    });

    it("rejects duplicate ingredient in items", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [
          { ingredientId: validUuid, qty: 5, unitCost: 1000 },
          { ingredientId: validUuid, qty: 3, unitCost: 1000 },
        ],
      });
      expect(r.success).toBe(false);
    });

    it("rejects invalid date format", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "30/04/2026",
        paymentMethod: "cash",
        items: [{ ingredientId: validUuid, qty: 5, unitCost: 1000 }],
      });
      expect(r.success).toBe(false);
    });

    it("requires paymentTermDays > 0 for TOP", () => {
      const r1 = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "top",
        paymentTermDays: 0,
        items: [{ ingredientId: validUuid, qty: 5, unitCost: 1000 }],
      });
      expect(r1.success).toBe(false);

      const r2 = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "top",
        paymentTermDays: 7,
        items: [{ ingredientId: validUuid, qty: 5, unitCost: 1000 }],
      });
      expect(r2.success).toBe(true);
    });

    it("requires paymentTermDays === 0 for non-TOP", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        paymentTermDays: 7,
        items: [{ ingredientId: validUuid, qty: 5, unitCost: 1000 }],
      });
      expect(r.success).toBe(false);
    });

    it("accepts multi-item purchase", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "transfer_bca",
        items: [
          { ingredientId: validUuid, qty: 5, unitCost: 1000 },
          { ingredientId: validUuid2, qty: 3, unitCost: 2500 },
        ],
      });
      expect(r.success).toBe(true);
    });

    // Sesi AE — decimal qty + unit override
    it("accepts decimal qty (0.5 kg)", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [{ ingredientId: validUuid, qty: 0.5, unitCost: 10000 }],
      });
      expect(r.success).toBe(true);
    });

    it("accepts decimal qty (0.25)", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [{ ingredientId: validUuid, qty: 0.25, unitCost: 48000 }],
      });
      expect(r.success).toBe(true);
    });

    it("accepts unit override per line", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [
          {
            ingredientId: validUuid,
            qty: 500,
            unitCost: 20,
            unit: "gr",
          },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("accepts null unit override (fallback ke master)", () => {
      const r = createPurchaseSchema.safeParse({
        supplierId: null,
        purchaseDate: "2026-04-30",
        paymentMethod: "cash",
        items: [
          { ingredientId: validUuid, qty: 1, unitCost: 1000, unit: null },
        ],
      });
      expect(r.success).toBe(true);
    });
  });

  describe("cancelPurchaseSchema", () => {
    it("requires reason >= 3 chars", () => {
      const r1 = cancelPurchaseSchema.safeParse({
        id: validUuid,
        reason: "ok",
      });
      expect(r1.success).toBe(false);
      const r2 = cancelPurchaseSchema.safeParse({
        id: validUuid,
        reason: "salah input",
      });
      expect(r2.success).toBe(true);
    });
  });

  describe("markPaidSchema", () => {
    it("rejects 'top' as payment method when marking paid", () => {
      const r = markPaidSchema.safeParse({
        id: validUuid,
        paymentMethod: "top",
      });
      expect(r.success).toBe(false);
    });

    it("accepts cash/transfer methods", () => {
      const r1 = markPaidSchema.safeParse({
        id: validUuid,
        paymentMethod: "cash",
      });
      expect(r1.success).toBe(true);
      const r2 = markPaidSchema.safeParse({
        id: validUuid,
        paymentMethod: "transfer_bca",
      });
      expect(r2.success).toBe(true);
    });
  });
});
