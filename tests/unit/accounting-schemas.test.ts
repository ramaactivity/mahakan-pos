import { describe, it, expect } from "vitest";
import {
  accountCodeSchema,
  createAccountSchema,
  isNormalBalanceValid,
  updateAccountSchema,
} from "@/features/accounting/schemas";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("accountCodeSchema", () => {
  it("accepts 4-digit codes 1xxx–6xxx", () => {
    expect(accountCodeSchema.safeParse("1101").success).toBe(true);
    expect(accountCodeSchema.safeParse("4101").success).toBe(true);
    expect(accountCodeSchema.safeParse("6999").success).toBe(true);
  });

  it("rejects non-4-digit", () => {
    expect(accountCodeSchema.safeParse("110").success).toBe(false);
    expect(accountCodeSchema.safeParse("11010").success).toBe(false);
    expect(accountCodeSchema.safeParse("11A1").success).toBe(false);
  });

  it("rejects codes outside 1xxx–6xxx", () => {
    expect(accountCodeSchema.safeParse("0101").success).toBe(false);
    expect(accountCodeSchema.safeParse("7101").success).toBe(false);
    expect(accountCodeSchema.safeParse("9999").success).toBe(false);
  });
});

describe("createAccountSchema", () => {
  it("accepts minimal valid input", () => {
    const r = createAccountSchema.safeParse({
      code: "6900",
      name: "Test Akun",
      type: "expense",
      normalBalance: "debit",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.isContra).toBe(false);
      expect(r.data.displayOrder).toBe(0);
      expect(r.data.parentCode).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  it("trims name + transforms empty notes to null", () => {
    const r = createAccountSchema.safeParse({
      code: "6901",
      name: "  Foo  ",
      type: "expense",
      normalBalance: "debit",
      notes: "  ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Foo");
      expect(r.data.notes).toBeNull();
    }
  });

  it("rejects name shorter than 2 chars", () => {
    const r = createAccountSchema.safeParse({
      code: "6902",
      name: "X",
      type: "expense",
      normalBalance: "debit",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid parent code format", () => {
    const r = createAccountSchema.safeParse({
      code: "6903",
      name: "Test",
      type: "expense",
      normalBalance: "debit",
      parentCode: "ABC",
    });
    expect(r.success).toBe(false);
  });
});

describe("updateAccountSchema", () => {
  it("requires id", () => {
    const r = updateAccountSchema.safeParse({ name: "X" });
    expect(r.success).toBe(false);
  });

  it("accepts partial updates", () => {
    const r = updateAccountSchema.safeParse({ id: UUID, name: "Updated" });
    expect(r.success).toBe(true);
  });

  it("accepts isActive toggle", () => {
    const r = updateAccountSchema.safeParse({ id: UUID, isActive: false });
    expect(r.success).toBe(true);
  });
});

describe("isNormalBalanceValid", () => {
  it("non-contra: asset/cogs/expense → debit normal", () => {
    expect(isNormalBalanceValid("asset", "debit", false)).toBe(true);
    expect(isNormalBalanceValid("cogs", "debit", false)).toBe(true);
    expect(isNormalBalanceValid("expense", "debit", false)).toBe(true);
    expect(isNormalBalanceValid("asset", "credit", false)).toBe(false);
  });

  it("non-contra: liability/equity/revenue → credit normal", () => {
    expect(isNormalBalanceValid("liability", "credit", false)).toBe(true);
    expect(isNormalBalanceValid("equity", "credit", false)).toBe(true);
    expect(isNormalBalanceValid("revenue", "credit", false)).toBe(true);
    expect(isNormalBalanceValid("liability", "debit", false)).toBe(false);
  });

  it("contra: flip the expected normal balance", () => {
    // Kontra-asset (e.g. Akumulasi Penyusutan) = credit
    expect(isNormalBalanceValid("asset", "credit", true)).toBe(true);
    expect(isNormalBalanceValid("asset", "debit", true)).toBe(false);
    // Kontra-revenue (e.g. Diskon Penjualan) = debit
    expect(isNormalBalanceValid("revenue", "debit", true)).toBe(true);
    expect(isNormalBalanceValid("revenue", "credit", true)).toBe(false);
    // Kontra-equity (e.g. Prive Owner) = debit
    expect(isNormalBalanceValid("equity", "debit", true)).toBe(true);
  });
});
