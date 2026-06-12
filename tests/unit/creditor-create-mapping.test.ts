import { describe, expect, it } from "vitest";
import { mapCreditorCreate } from "@/features/accounting/mapping/creditorRepayment";

/**
 * Audit AE-181 — jurnal pengakuan hutang saat kreditur dibuat/diimport.
 * Uang masuk sekarang: Dr <bank> / Cr 2150.
 * Hutang lama (import): Dr 3301 penyesuaian saldo / Cr 2150.
 */

function totals(lines: Array<{ debit?: number; credit?: number }>) {
  return {
    dr: lines.reduce((s, l) => s + (l.debit ?? 0), 0),
    cr: lines.reduce((s, l) => s + (l.credit ?? 0), 0),
  };
}

describe("mapCreditorCreate", () => {
  it("uang masuk sekarang: Dr bank / Cr 2150, balanced", () => {
    const lines = mapCreditorCreate({
      principal: 5_000_000,
      bankAccountCode: "1110",
      creditorName: "Pak Andi",
    });
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountCode === "1110");
    const cr = lines.find((l) => l.accountCode === "2150");
    expect(dr?.debit).toBe(5_000_000);
    expect(cr?.credit).toBe(5_000_000);
    const t = totals(lines);
    expect(t.dr).toBe(t.cr);
  });

  it("hutang lama (bankAccountCode null): Dr 3301 / Cr 2150", () => {
    const lines = mapCreditorCreate({
      principal: 1_000_000,
      bankAccountCode: null,
      creditorName: "Lidya",
    });
    const dr = lines.find((l) => l.accountCode === "3301");
    const cr = lines.find((l) => l.accountCode === "2150");
    expect(dr?.debit).toBe(1_000_000);
    expect(cr?.credit).toBe(1_000_000);
  });

  it("throws untuk principal <= 0", () => {
    expect(() =>
      mapCreditorCreate({
        principal: 0,
        bankAccountCode: null,
        creditorName: "X",
      }),
    ).toThrow("MAP_CREDITOR_CREATE_NONPOSITIVE");
  });

  it("floor pecahan Rupiah", () => {
    const lines = mapCreditorCreate({
      principal: 999_999.9,
      bankAccountCode: "1111",
      creditorName: "X",
    });
    expect(lines[0].debit).toBe(999_999);
    expect(lines[1].credit).toBe(999_999);
  });
});
