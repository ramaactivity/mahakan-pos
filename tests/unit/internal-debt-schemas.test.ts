import { describe, expect, it } from "vitest";
import {
  createInternalDebtPartySchema,
  postInternalDebtEntrySchema,
  postInternalDebtRepaymentSchema,
  reverseInternalDebtSchema,
} from "@/features/internal-debts/schemas";

/**
 * Sesi AE-180 — Zod schema validation Hutang Internal.
 */

const UUID = "5a0e8f8a-1111-4222-8333-444455556666";

describe("createInternalDebtPartySchema", () => {
  it("accepts minimal valid input", () => {
    const r = createInternalDebtPartySchema.safeParse({ name: "Rama" });
    expect(r.success).toBe(true);
  });

  it("rejects nama terlalu pendek", () => {
    const r = createInternalDebtPartySchema.safeParse({ name: "R" });
    expect(r.success).toBe(false);
  });
});

describe("postInternalDebtEntrySchema", () => {
  const base = {
    partyId: UUID,
    amount: 150_000,
    description: "Beli gas LPG",
  };

  it("expense_advance wajib categoryId", () => {
    const noCat = postInternalDebtEntrySchema.safeParse({
      ...base,
      kind: "expense_advance",
    });
    expect(noCat.success).toBe(false);

    const withCat = postInternalDebtEntrySchema.safeParse({
      ...base,
      kind: "expense_advance",
      categoryId: UUID,
    });
    expect(withCat.success).toBe(true);
  });

  it("cash_loan wajib bankAccountId", () => {
    const noBank = postInternalDebtEntrySchema.safeParse({
      ...base,
      kind: "cash_loan",
    });
    expect(noBank.success).toBe(false);

    const withBank = postInternalDebtEntrySchema.safeParse({
      ...base,
      kind: "cash_loan",
      bankAccountId: UUID,
    });
    expect(withBank.success).toBe(true);
  });

  it("rejects amount 0 / negatif / non-integer", () => {
    for (const amount of [0, -100, 100.5]) {
      const r = postInternalDebtEntrySchema.safeParse({
        ...base,
        amount,
        kind: "cash_loan",
        bankAccountId: UUID,
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects deskripsi terlalu pendek", () => {
    const r = postInternalDebtEntrySchema.safeParse({
      ...base,
      description: "ab",
      kind: "cash_loan",
      bankAccountId: UUID,
    });
    expect(r.success).toBe(false);
  });
});

describe("postInternalDebtRepaymentSchema", () => {
  it("accepts valid input", () => {
    const r = postInternalDebtRepaymentSchema.safeParse({
      partyId: UUID,
      bankAccountId: UUID,
      amount: 500_000,
    });
    expect(r.success).toBe(true);
  });

  it("rejects amount <= 0", () => {
    const r = postInternalDebtRepaymentSchema.safeParse({
      partyId: UUID,
      bankAccountId: UUID,
      amount: 0,
    });
    expect(r.success).toBe(false);
  });

  /* Sesi AE-209 — bukti transfer opsional; URL non-http disaring nanti
   * oleh normalizeReceiptUrl di action, bukan oleh schema. */
  it("menerima bukti transfer opsional", () => {
    const r = postInternalDebtRepaymentSchema.safeParse({
      partyId: UUID,
      bankAccountId: UUID,
      amount: 500_000,
      receiptImageUrl: "https://drive.google.com/file/d/abc/view",
    });
    expect(r.success).toBe(true);
  });

  it("tetap sah tanpa bukti transfer", () => {
    const r = postInternalDebtRepaymentSchema.safeParse({
      partyId: UUID,
      bankAccountId: UUID,
      amount: 500_000,
      receiptImageUrl: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("reverseInternalDebtSchema", () => {
  it("alasan min 5 karakter", () => {
    expect(
      reverseInternalDebtSchema.safeParse({ id: UUID, reason: "abc" }).success,
    ).toBe(false);
    expect(
      reverseInternalDebtSchema.safeParse({
        id: UUID,
        reason: "salah input",
      }).success,
    ).toBe(true);
  });
});
