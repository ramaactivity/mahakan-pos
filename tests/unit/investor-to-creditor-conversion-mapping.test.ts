import { describe, expect, it } from "vitest";
import { mapInvestorToCreditorConversion } from "@/features/accounting/mapping/investorToCreditorConversion";

/**
 * Sesi AE-80 follow-up — mapping test untuk convert investor → kreditur
 * journal lines (re-classify equity → liability).
 *
 *   Dr 3101 Modal Owner       principalIdr
 *     Cr 2150 Hutang Kreditur  principalIdr
 */

describe("Investor → Kreditur conversion mapping", () => {
  it("balanced Dr 3101 / Cr 2150 at full modal amount", () => {
    const lines = mapInvestorToCreditorConversion({
      principalIdr: 10_000_000,
      investorName: "Pak Andi",
      creditorName: "Pak Andi",
    });
    expect(lines).toHaveLength(2);

    const dr = lines.find((l) => l.accountCode === "3101");
    const cr = lines.find((l) => l.accountCode === "2150");
    expect(dr).toBeDefined();
    expect(cr).toBeDefined();
    expect(dr!.debit).toBe(10_000_000);
    expect(dr!.credit).toBe(0);
    expect(cr!.credit).toBe(10_000_000);
    expect(cr!.debit).toBe(0);

    /* Balance invariant */
    const totalDr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(totalDr).toBe(totalCr);
  });

  it("descriptions mention investor + creditor names for audit clarity", () => {
    const lines = mapInvestorToCreditorConversion({
      principalIdr: 5_000_000,
      investorName: "Investor Lama",
      creditorName: "Kreditur Baru",
    });
    expect(lines[0].description).toContain("Investor Lama");
    expect(lines[1].description).toContain("Kreditur Baru");
  });

  it("floor amount to integer (Rp tidak bisa pecahan)", () => {
    const lines = mapInvestorToCreditorConversion({
      principalIdr: 1_500_000.99,
      investorName: "X",
      creditorName: "X",
    });
    expect(lines[0].debit).toBe(1_500_000);
    expect(lines[1].credit).toBe(1_500_000);
  });

  it("negative principal di-clamp ke 0 (defensive — caller wajib validate >0 dulu)", () => {
    const lines = mapInvestorToCreditorConversion({
      principalIdr: -100,
      investorName: "X",
      creditorName: "X",
    });
    expect(lines[0].debit).toBe(0);
    expect(lines[1].credit).toBe(0);
  });

  it("zero principal returns balanced zero-line entry (caller wajib guard)", () => {
    const lines = mapInvestorToCreditorConversion({
      principalIdr: 0,
      investorName: "X",
      creditorName: "X",
    });
    expect(lines[0].debit).toBe(0);
    expect(lines[1].credit).toBe(0);
    /* Balance tetap */
    expect(lines.reduce((s, l) => s + (l.debit ?? 0), 0)).toBe(
      lines.reduce((s, l) => s + (l.credit ?? 0), 0),
    );
  });
});
