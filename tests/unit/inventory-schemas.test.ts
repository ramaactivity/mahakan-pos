import { describe, it, expect } from "vitest";
import {
  adjustStockSchema,
  createIngredientSchema,
  receiveStockSchema,
  recordWasteSchema,
  updateIngredientSchema,
} from "@/features/inventory/schemas";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("createIngredientSchema", () => {
  it("accepts a minimal valid input", () => {
    const r = createIngredientSchema.safeParse({
      name: "Susu Full Cream",
      unit: "ml",
      costPerUnit: 30,
      initialStock: 5000,
    });
    expect(r.success).toBe(true);
  });

  it("trims whitespace on name + unit", () => {
    const r = createIngredientSchema.safeParse({
      name: "  Espresso Beans  ",
      unit: " g ",
      costPerUnit: 200,
      initialStock: 1000,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Espresso Beans");
      expect(r.data.unit).toBe("g");
    }
  });

  it("rejects empty name", () => {
    const r = createIngredientSchema.safeParse({
      name: "",
      unit: "g",
      costPerUnit: 100,
      initialStock: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative cost", () => {
    const r = createIngredientSchema.safeParse({
      name: "Sugar",
      unit: "g",
      costPerUnit: -5,
      initialStock: 1000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative initial stock", () => {
    const r = createIngredientSchema.safeParse({
      name: "Sugar",
      unit: "g",
      costPerUnit: 5,
      initialStock: -100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects float cost (must be integer rupiah)", () => {
    const r = createIngredientSchema.safeParse({
      name: "Sugar",
      unit: "g",
      costPerUnit: 5.5,
      initialStock: 1000,
    });
    expect(r.success).toBe(false);
  });

  it("accepts nullable reorder threshold + notes", () => {
    const r = createIngredientSchema.safeParse({
      name: "Sugar",
      unit: "g",
      costPerUnit: 5,
      initialStock: 1000,
      reorderThreshold: null,
      notes: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects name over 80 chars", () => {
    const r = createIngredientSchema.safeParse({
      name: "A".repeat(81),
      unit: "g",
      costPerUnit: 5,
      initialStock: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe("updateIngredientSchema", () => {
  it("accepts partial update with at least one field", () => {
    const r = updateIngredientSchema.safeParse({ costPerUnit: 250 });
    expect(r.success).toBe(true);
  });

  it("rejects empty object (no fields to update)", () => {
    const r = updateIngredientSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts isActive toggle alone", () => {
    const r = updateIngredientSchema.safeParse({ isActive: false });
    expect(r.success).toBe(true);
  });
});

describe("receiveStockSchema", () => {
  it("accepts valid receive with positive qty + cost", () => {
    const r = receiveStockSchema.safeParse({
      ingredientId: VALID_UUID,
      qty: 1000,
      unitCost: 200,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.updateCost).toBe(true); // default
  });

  it("rejects zero qty", () => {
    const r = receiveStockSchema.safeParse({
      ingredientId: VALID_UUID,
      qty: 0,
      unitCost: 200,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid uuid", () => {
    const r = receiveStockSchema.safeParse({
      ingredientId: "not-a-uuid",
      qty: 100,
      unitCost: 200,
    });
    expect(r.success).toBe(false);
  });
});

describe("adjustStockSchema", () => {
  it("accepts negative delta with reason", () => {
    const r = adjustStockSchema.safeParse({
      ingredientId: VALID_UUID,
      delta: -50,
      reason: "Selisih stock opname",
    });
    expect(r.success).toBe(true);
  });

  it("accepts positive delta with reason", () => {
    const r = adjustStockSchema.safeParse({
      ingredientId: VALID_UUID,
      delta: 100,
      reason: "Koreksi stok",
    });
    expect(r.success).toBe(true);
  });

  it("rejects zero delta", () => {
    const r = adjustStockSchema.safeParse({
      ingredientId: VALID_UUID,
      delta: 0,
      reason: "Reason here",
    });
    expect(r.success).toBe(false);
  });

  it("rejects reason shorter than 3 chars", () => {
    const r = adjustStockSchema.safeParse({
      ingredientId: VALID_UUID,
      delta: 10,
      reason: "a",
    });
    expect(r.success).toBe(false);
  });
});

describe("recordWasteSchema", () => {
  it("accepts positive qty + reason", () => {
    const r = recordWasteSchema.safeParse({
      ingredientId: VALID_UUID,
      qty: 50,
      reason: "Susu kadaluarsa",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative qty (waste is always positive)", () => {
    const r = recordWasteSchema.safeParse({
      ingredientId: VALID_UUID,
      qty: -10,
      reason: "Tumpah",
    });
    expect(r.success).toBe(false);
  });
});
