import { describe, expect, it } from "vitest";
import {
  postWithdrawalSchema,
  reverseWithdrawalSchema,
} from "@/features/withdrawals/schemas";
import {
  createCreditorSchema,
  postRepaymentSchema,
} from "@/features/creditors/schemas";
import {
  companyBuybackSchema,
  transferShareP2PSchema,
} from "@/features/share-transactions/schemas";

/**
 * Sesi AE-80 — Validation Zod schemas (pure tests).
 */

/* Valid UUID v4 strings untuk Zod validation. */
const UUID_1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const UUID_2 = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const UUID_3 = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

describe("Withdrawal schema validation", () => {
  it("valid withdrawal accepts", () => {
    const r = postWithdrawalSchema.safeParse({
      investorId: UUID_1,
      amount: 100_000,
      bankAccountId: UUID_2,
    });
    expect(r.success).toBe(true);
  });

  it("amount < 50000 rejected", () => {
    const r = postWithdrawalSchema.safeParse({
      investorId: UUID_1,
      amount: 49_999,
      bankAccountId: UUID_2,
    });
    expect(r.success).toBe(false);
  });

  it("amount = 50000 exact passes", () => {
    const r = postWithdrawalSchema.safeParse({
      investorId: UUID_1,
      amount: 50_000,
      bankAccountId: UUID_2,
    });
    expect(r.success).toBe(true);
  });

  it("non-integer amount rejected", () => {
    const r = postWithdrawalSchema.safeParse({
      investorId: UUID_1,
      amount: 100_000.5,
      bankAccountId: UUID_2,
    });
    expect(r.success).toBe(false);
  });

  it("reverse requires min 5 char reason", () => {
    expect(
      reverseWithdrawalSchema.safeParse({ id: UUID_1, reason: "ok" }).success,
    ).toBe(false);
    expect(
      reverseWithdrawalSchema.safeParse({ id: UUID_1, reason: "salah" })
        .success,
    ).toBe(true);
  });
});

describe("Creditor schema validation", () => {
  it("valid creditor accepts", () => {
    const r = createCreditorSchema.safeParse({
      fullName: "Pak Budi",
      principalOriginal: 10_000_000,
      startDate: "2026-01-01",
    });
    expect(r.success).toBe(true);
  });

  it("principal zero rejected (must be positive)", () => {
    const r = createCreditorSchema.safeParse({
      fullName: "Pak Budi",
      principalOriginal: 0,
      startDate: "2026-01-01",
    });
    expect(r.success).toBe(false);
  });

  it("dueDate < startDate rejected", () => {
    const r = createCreditorSchema.safeParse({
      fullName: "Pak Budi",
      principalOriginal: 1_000_000,
      startDate: "2026-06-01",
      dueDate: "2026-01-01",
    });
    expect(r.success).toBe(false);
  });

  it("interest rate > 100 rejected", () => {
    const r = createCreditorSchema.safeParse({
      fullName: "Pak Budi",
      principalOriginal: 1_000_000,
      startDate: "2026-01-01",
      interestRatePct: 150,
    });
    expect(r.success).toBe(false);
  });

  it("repayment total > 0 required", () => {
    expect(
      postRepaymentSchema.safeParse({
        creditorId: UUID_1,
        bankAccountId: UUID_2,
        principalAmount: 0,
        interestAmount: 0,
      }).success,
    ).toBe(false);
    expect(
      postRepaymentSchema.safeParse({
        creditorId: UUID_1,
        bankAccountId: UUID_2,
        principalAmount: 100_000,
        interestAmount: 0,
      }).success,
    ).toBe(true);
    expect(
      postRepaymentSchema.safeParse({
        creditorId: UUID_1,
        bankAccountId: UUID_2,
        principalAmount: 0,
        interestAmount: 50_000,
      }).success,
    ).toBe(true);
  });
});

describe("Share transaction schema validation", () => {
  it("P2P: fromInvestorId == toInvestorId rejected", () => {
    const r = transferShareP2PSchema.safeParse({
      fromInvestorId: UUID_1,
      toInvestorId: UUID_1,
      sharePctDelta: 5,
    });
    expect(r.success).toBe(false);
  });

  it("P2P valid case", () => {
    const r = transferShareP2PSchema.safeParse({
      fromInvestorId: UUID_1,
      toInvestorId: UUID_2,
      sharePctDelta: 5,
    });
    expect(r.success).toBe(true);
  });

  it("P2P delta = 0 rejected", () => {
    const r = transferShareP2PSchema.safeParse({
      fromInvestorId: UUID_1,
      toInvestorId: UUID_2,
      sharePctDelta: 0,
    });
    expect(r.success).toBe(false);
  });

  it("P2P delta > 100 rejected", () => {
    const r = transferShareP2PSchema.safeParse({
      fromInvestorId: UUID_1,
      toInvestorId: UUID_2,
      sharePctDelta: 101,
    });
    expect(r.success).toBe(false);
  });

  it("buyback requires bankAccount + amount > 0", () => {
    expect(
      companyBuybackSchema.safeParse({
        fromInvestorId: UUID_1,
        sharePctDelta: 5,
        amountIdr: 5_000_000,
        bankAccountId: UUID_3,
      }).success,
    ).toBe(true);

    expect(
      companyBuybackSchema.safeParse({
        fromInvestorId: UUID_1,
        sharePctDelta: 5,
        amountIdr: 0,
        bankAccountId: UUID_3,
      }).success,
    ).toBe(false);
  });
});
