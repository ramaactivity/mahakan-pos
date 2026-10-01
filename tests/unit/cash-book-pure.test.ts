import { describe, expect, it } from "vitest";
import {
  buildCashBook,
  cashSourceLabel,
  isCashBankCode,
  type CashBookRawLine,
} from "@/features/accounting/cash-book-pure";

const KAS = { id: "kas", code: "1101", name: "Kas Tunai" };
const BCA = { id: "bca", code: "1110", name: "Bank BCA" };

const raw = (over: Partial<CashBookRawLine>): CashBookRawLine => ({
  entryId: "e1",
  entryNumber: "JE-1",
  entryDate: "2026-10-01",
  sourceType: "pos_daily_sales",
  description: "Penjualan 1 Okt",
  lineDescription: null,
  accountId: "kas",
  accountCode: "1101",
  accountName: "Kas Tunai",
  debit: 0,
  credit: 0,
  entryLines: [],
  ...over,
});

describe("isCashBankCode", () => {
  it("covers 1101–1119 incl. BNI 1113, not receivables", () => {
    expect(["1101", "1102", "1110", "1113", "1119"].every(isCashBankCode)).toBe(true);
    expect(["1100", "1120", "1155", "2101"].some(isCashBankCode)).toBe(false);
  });
});

describe("buildCashBook", () => {
  it("running balance from opening, with counterpart on the opposite side", () => {
    const book = buildCashBook({
      accounts: [KAS, BCA],
      accountId: "kas",
      from: "2026-10-01",
      to: "2026-10-31",
      openingBalance: 100_000,
      raw: [
        raw({
          debit: 50_000,
          entryLines: [
            { accountId: "kas", code: "1101", name: "Kas Tunai", debit: 50_000, credit: 0 },
            { accountId: "x", code: "4102", name: "Penjualan Minuman", debit: 0, credit: 50_000 },
            { accountId: "h", code: "5102", name: "HPP Minuman", debit: 9_000, credit: 0 },
            { accountId: "p", code: "1141", name: "Persediaan Bar", debit: 0, credit: 9_000 },
          ],
        }),
        raw({
          entryId: "e2",
          sourceType: "cash_deposit_verified",
          credit: 120_000,
          entryLines: [
            { accountId: "bca", code: "1110", name: "Bank BCA", debit: 120_000, credit: 0 },
            { accountId: "kas", code: "1101", name: "Kas Tunai", debit: 0, credit: 120_000 },
          ],
        }),
      ],
    });
    expect(book.lines.map((l) => l.saldo)).toEqual([150_000, 30_000]);
    expect(book.lines[0]!.counterparts.map((c) => c.code)).toEqual(["4102"]);
    expect(book.lines[1]!.counterparts.map((c) => c.code)).toEqual(["1110"]);
    expect(book.lines[1]!.isTransfer).toBe(true);
    expect(book.closingBalance).toBe(30_000);
    expect(book.totalIn).toBe(50_000);
    expect(book.totalOut).toBe(120_000);
  });

  it("human source labels", () => {
    expect(cashSourceLabel("payroll_paid")).toBe("Gaji karyawan");
    expect(cashSourceLabel("something_reversal")).toBe("Koreksi");
  });
});
