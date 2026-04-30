import { describe, expect, it } from "vitest";
import {
  createSupplierSchema,
  updateSupplierSchema,
} from "@/features/suppliers/schemas";

describe("supplier zod schemas", () => {
  describe("createSupplierSchema", () => {
    it("accepts minimal valid input (name only)", () => {
      const r = createSupplierSchema.safeParse({ name: "Vina" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.defaultPaymentTermDays).toBe(0);
    });

    it("rejects empty name", () => {
      const r = createSupplierSchema.safeParse({ name: "" });
      expect(r.success).toBe(false);
    });

    it("rejects negative payment term", () => {
      const r = createSupplierSchema.safeParse({
        name: "X",
        defaultPaymentTermDays: -5,
      });
      expect(r.success).toBe(false);
    });

    it("accepts term up to 365 days", () => {
      const r = createSupplierSchema.safeParse({
        name: "X",
        defaultPaymentTermDays: 365,
      });
      expect(r.success).toBe(true);
    });

    it("rejects term beyond 365 days", () => {
      const r = createSupplierSchema.safeParse({
        name: "X",
        defaultPaymentTermDays: 400,
      });
      expect(r.success).toBe(false);
    });

    it("trims whitespace from optional fields", () => {
      const r = createSupplierSchema.safeParse({
        name: "Vina",
        contact: "  0812-9999  ",
        category: " Beans ",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.contact).toBe("0812-9999");
        expect(r.data.category).toBe("Beans");
      }
    });
  });

  describe("updateSupplierSchema", () => {
    it("rejects empty input (no fields)", () => {
      const r = updateSupplierSchema.safeParse({});
      expect(r.success).toBe(false);
    });

    it("accepts partial updates", () => {
      const r1 = updateSupplierSchema.safeParse({ name: "New Name" });
      expect(r1.success).toBe(true);
      const r2 = updateSupplierSchema.safeParse({ isActive: false });
      expect(r2.success).toBe(true);
    });

    it("allows clearing nullable fields with null", () => {
      const r = updateSupplierSchema.safeParse({
        contact: null,
        category: null,
      });
      expect(r.success).toBe(true);
    });
  });
});
