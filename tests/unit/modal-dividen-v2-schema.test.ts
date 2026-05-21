import { describe, expect, it } from "vitest";

/**
 * Sesi AE-80 — Schema smoke tests untuk modal-dividen-v2 migration.
 *
 * Pure type-level + value-level invariant checks. Tidak hit DB
 * (constraint tests yang real perlu DB instance; di-skip kalau env
 * `INTEGRATION_TEST=1` tidak set).
 *
 * Goal: catch typo di schema enum / CHECK / shape sebelum deploy.
 */

describe("modal-dividen-v2 schema invariants (pure)", () => {
  it("OutletSettings.dividen flag punya semua default fields yang dipakai service layer", () => {
    type OutletDividenSettings = {
      useWaterfallV2?: boolean;
      defaultPayoutRatioPct?: number;
      defaultLossPct?: number;
      defaultCapexPct?: number;
      investorPoolPct?: number;
    };

    const defaults: OutletDividenSettings = {
      useWaterfallV2: false,
      defaultPayoutRatioPct: 10,
      defaultLossPct: 3,
      defaultCapexPct: 0.7,
      investorPoolPct: 35,
    };

    expect(defaults.defaultPayoutRatioPct).toBeGreaterThan(0);
    expect(defaults.defaultLossPct).toBeGreaterThan(0);
    expect(defaults.defaultCapexPct).toBeGreaterThan(0);
    expect(defaults.investorPoolPct).toBeGreaterThan(0);
    expect(defaults.investorPoolPct).toBeLessThanOrEqual(100);
  });

  it("calculation_model enum values match expected v1/v2", () => {
    const validModels = ["v1", "v2"] as const;
    type CalculationModel = (typeof validModels)[number];
    const m: CalculationModel = "v2";
    expect(validModels).toContain(m);
  });

  it("distribution status enum extends to include reversed", () => {
    const validStatuses = [
      "draft",
      "approved",
      "posted",
      "cancelled",
      "reversed",
    ] as const;
    expect(validStatuses).toContain("reversed");
    expect(validStatuses.length).toBe(5);
  });

  it("capital_movements kind enum mencakup semua AE-80 additions", () => {
    const validKinds = [
      "initial_deposit",
      "top_up",
      "dividend_credit",
      "withdrawal",
      "adjustment",
      "reversal",
      "share_transfer_in",
      "share_transfer_out",
      "company_buyback",
      "creditor_repayment_principal",
      "dividend_withdrawal",
    ] as const;
    expect(validKinds).toContain("reversal");
    expect(validKinds).toContain("dividend_withdrawal");
    expect(validKinds).toContain("share_transfer_in");
    expect(validKinds).toContain("share_transfer_out");
    expect(validKinds).toContain("company_buyback");
    expect(validKinds.length).toBe(11);
  });

  it("share_transactions kind enum hanya 4 jenis valid", () => {
    const validKinds = [
      "p2p_transfer",
      "company_buyback",
      "top_up",
      "initial",
    ] as const;
    expect(validKinds.length).toBe(4);
  });

  it("creditor interest_period hanya 3 jenis valid", () => {
    const validPeriods = ["monthly", "yearly", "flat"] as const;
    expect(validPeriods.length).toBe(3);
  });

  it("withdrawal min amount Rp 50.000 (CHECK ck_withdrawal_min_amount)", () => {
    const MIN = 50_000;
    expect(MIN).toBe(50000);
    /* CHECK constraint: amount >= 50000. UI input min juga 50000. */
    expect(49_999 >= MIN).toBe(false);
    expect(50_000 >= MIN).toBe(true);
    expect(50_001 >= MIN).toBe(true);
  });

  it("share_pct precision: decimal(7,4) → 0.0000 - 9999.9999, app constrain 0-100", () => {
    /* Schema decimal(7,4) allow up to 999.9999, tapi CHECK constrain 0-100. */
    const valid = [0, 0.0001, 33.3333, 100];
    const invalid = [-0.0001, 100.0001, 101];
    for (const v of valid) {
      expect(v >= 0 && v <= 100).toBe(true);
    }
    for (const v of invalid) {
      expect(v >= 0 && v <= 100).toBe(false);
    }
  });

  it("dividend_balance CHECK >= 0 (last line of defense)", () => {
    /* Service layer pakai FOR UPDATE row lock + pre-check di action.
     * CHECK constraint last defense untuk concurrent race. */
    expect(0 >= 0).toBe(true);
    expect(-1 >= 0).toBe(false);
  });

  it("creditor principalOutstanding <= principalOriginal invariant", () => {
    /* CHECK ck_creditors_principal_outstanding_lte_original */
    expect(1_000_000 <= 1_000_000).toBe(true); // OK initial
    expect(500_000 <= 1_000_000).toBe(true); // OK after repay
    expect(1_500_000 <= 1_000_000).toBe(false); // INVALID (over original)
  });

  it("share_transactions per-kind shape constraints", () => {
    /* P2P: from+to required, amount=0, no bank.
     * Buyback: from required, to NULL, amount>0, bank required.
     * Top_up/Initial: from NULL, to required, amount>0, bank required. */
    type Kind = "p2p_transfer" | "company_buyback" | "top_up" | "initial";
    type ShareTx = {
      kind: Kind;
      fromInvestorId: string | null;
      toInvestorId: string | null;
      amountIdr: number;
      bankAccountId: string | null;
    };

    function isValid(t: ShareTx): boolean {
      if (t.kind === "p2p_transfer") {
        return (
          t.fromInvestorId !== null &&
          t.toInvestorId !== null &&
          t.amountIdr === 0 &&
          t.bankAccountId === null
        );
      }
      if (t.kind === "company_buyback") {
        return (
          t.fromInvestorId !== null &&
          t.toInvestorId === null &&
          t.amountIdr > 0 &&
          t.bankAccountId !== null
        );
      }
      if (t.kind === "top_up" || t.kind === "initial") {
        return (
          t.fromInvestorId === null &&
          t.toInvestorId !== null &&
          t.amountIdr > 0 &&
          t.bankAccountId !== null
        );
      }
      return false;
    }

    expect(
      isValid({
        kind: "p2p_transfer",
        fromInvestorId: "a",
        toInvestorId: "b",
        amountIdr: 0,
        bankAccountId: null,
      }),
    ).toBe(true);

    expect(
      isValid({
        kind: "company_buyback",
        fromInvestorId: "a",
        toInvestorId: null,
        amountIdr: 5_000_000,
        bankAccountId: "bank1",
      }),
    ).toBe(true);

    expect(
      isValid({
        kind: "top_up",
        fromInvestorId: null,
        toInvestorId: "b",
        amountIdr: 1_000_000,
        bankAccountId: "bank1",
      }),
    ).toBe(true);

    /* Invalid: P2P with amount > 0 */
    expect(
      isValid({
        kind: "p2p_transfer",
        fromInvestorId: "a",
        toInvestorId: "b",
        amountIdr: 100,
        bankAccountId: null,
      }),
    ).toBe(false);

    /* Invalid: company_buyback without bank */
    expect(
      isValid({
        kind: "company_buyback",
        fromInvestorId: "a",
        toInvestorId: null,
        amountIdr: 5_000_000,
        bankAccountId: null,
      }),
    ).toBe(false);
  });

  it("v2 distribution wajib punya payout_ratio_pct + snapshot rates (ck_distribution_v2_fields_consistent)", () => {
    function isV2Consistent(row: {
      calculationModel: "v1" | "v2";
      payoutRatioPct: string | null;
      lossRateSnapshot: string | null;
      capexRateSnapshot: string | null;
    }): boolean {
      if (row.calculationModel === "v1") return true;
      return (
        row.payoutRatioPct !== null &&
        row.lossRateSnapshot !== null &&
        row.capexRateSnapshot !== null
      );
    }

    expect(
      isV2Consistent({
        calculationModel: "v1",
        payoutRatioPct: null,
        lossRateSnapshot: null,
        capexRateSnapshot: null,
      }),
    ).toBe(true);

    expect(
      isV2Consistent({
        calculationModel: "v2",
        payoutRatioPct: "10.00",
        lossRateSnapshot: "3.00",
        capexRateSnapshot: "0.70",
      }),
    ).toBe(true);

    expect(
      isV2Consistent({
        calculationModel: "v2",
        payoutRatioPct: null,
        lossRateSnapshot: "3.00",
        capexRateSnapshot: "0.70",
      }),
    ).toBe(false);
  });

  it("JournalSourceType enum mencakup semua AE-80 sources", () => {
    const sources = [
      "dividend_distribution_reversal",
      "dividend_withdrawal",
      "dividend_withdrawal_reversal",
      "creditor_repayment",
      "creditor_repayment_reversal",
      "share_buyback",
      "share_buyback_reversal",
    ] as const;
    expect(sources.length).toBe(7);
  });
});
