import { describe, expect, it } from "vitest";
import {
  buildLedgerAccountSummary,
  type AccountBalanceRow,
} from "@/features/accounting/reports";

/**
 * Sesi AE-183 — ringkasan "total per akun" di Buku Besar (tampilan sebelum
 * memilih akun). Yang dijaga di sini:
 *   - saldo akhir = saldo awal + mutasi, bertanda sesuai sisi normal akun
 *     (harus sama persis dengan angka di detail buku besar akun itu);
 *   - akun benar-benar kosong disembunyikan, tapi tetap dihitung;
 *   - pengelompokan + urutan grup mengikuti urutan laporan keuangan.
 */

function row(
  over: Partial<AccountBalanceRow> & { accountId: string; code: string },
): AccountBalanceRow {
  return {
    name: `Akun ${over.code}`,
    type: "asset",
    normalBalance: "debit",
    isContra: false,
    parentCode: null,
    debitTotal: 0,
    creditTotal: 0,
    ...over,
  } as AccountBalanceRow;
}

describe("buildLedgerAccountSummary", () => {
  it("saldo akhir akun debit-normal = saldo awal + debit − kredit", () => {
    const r = buildLedgerAccountSummary({
      opening: [
        row({ accountId: "a1", code: "1101", debitTotal: 500_000, creditTotal: 100_000 }),
      ],
      movement: [
        row({ accountId: "a1", code: "1101", debitTotal: 300_000, creditTotal: 50_000 }),
      ],
    });
    const acc = r.groups[0].rows[0];
    expect(acc.openingBalance).toBe(400_000); // 500rb − 100rb
    expect(acc.closingBalance).toBe(650_000); // 400rb + 300rb − 50rb
  });

  it("akun kredit-normal dibalik tandanya (kewajiban/pendapatan)", () => {
    const r = buildLedgerAccountSummary({
      opening: [
        row({
          accountId: "b1",
          code: "2101",
          type: "liability",
          normalBalance: "credit",
          creditTotal: 1_000_000,
        }),
      ],
      movement: [
        row({
          accountId: "b1",
          code: "2101",
          type: "liability",
          normalBalance: "credit",
          debitTotal: 250_000,
        }),
      ],
    });
    const acc = r.groups[0].rows[0];
    expect(acc.openingBalance).toBe(1_000_000);
    /* Bayar hutang 250rb → saldo kewajiban turun, bukan naik. */
    expect(acc.closingBalance).toBe(750_000);
  });

  it("akun tanpa saldo & tanpa mutasi disembunyikan tapi tetap dihitung", () => {
    const r = buildLedgerAccountSummary({
      opening: [],
      movement: [
        row({ accountId: "z1", code: "1999" }),
        row({ accountId: "z2", code: "2999" }),
        row({ accountId: "a1", code: "1101", debitTotal: 10_000 }),
      ],
    });
    expect(r.hiddenEmptyAccounts).toBe(2);
    expect(r.groups.flatMap((g) => g.rows).map((x) => x.code)).toEqual(["1101"]);
  });

  it("akun bersaldo awal tetap tampil walau tidak ada mutasi periode ini", () => {
    const r = buildLedgerAccountSummary({
      opening: [row({ accountId: "a1", code: "1101", debitTotal: 900_000 })],
      movement: [row({ accountId: "a1", code: "1101" })],
    });
    expect(r.hiddenEmptyAccounts).toBe(0);
    const acc = r.groups[0].rows[0];
    expect(acc.debitTotal).toBe(0);
    expect(acc.closingBalance).toBe(900_000);
  });

  it("dikelompokkan per jenis akun dengan urutan laporan keuangan", () => {
    const r = buildLedgerAccountSummary({
      opening: [],
      movement: [
        row({ accountId: "e1", code: "6101", type: "expense", debitTotal: 1 }),
        row({ accountId: "r1", code: "4101", type: "revenue", normalBalance: "credit", creditTotal: 1 }),
        row({ accountId: "a1", code: "1101", type: "asset", debitTotal: 1 }),
      ],
    });
    expect(r.groups.map((g) => g.type)).toEqual([
      "asset",
      "revenue",
      "expense",
    ]);
    expect(r.groups.map((g) => g.label)).toEqual([
      "Aset",
      "Pendapatan",
      "Beban",
    ]);
  });

  it("subtotal grup + total mutasi + kontrol keseimbangan", () => {
    const r = buildLedgerAccountSummary({
      opening: [],
      movement: [
        row({ accountId: "a1", code: "1101", debitTotal: 700_000 }),
        row({ accountId: "a2", code: "1110", debitTotal: 300_000 }),
        row({
          accountId: "r1",
          code: "4101",
          type: "revenue",
          normalBalance: "credit",
          creditTotal: 1_000_000,
        }),
      ],
    });
    const aset = r.groups.find((g) => g.type === "asset")!;
    expect(aset.totalDebit).toBe(1_000_000);
    expect(aset.totalClosing).toBe(1_000_000);
    expect(r.totalDebit).toBe(1_000_000);
    expect(r.totalCredit).toBe(1_000_000);
    expect(r.balanced).toBe(true);
  });

  it("mutasi timpang ditandai balanced=false (kontrol integritas)", () => {
    const r = buildLedgerAccountSummary({
      opening: [],
      movement: [
        row({ accountId: "a1", code: "1101", debitTotal: 700_000 }),
        row({
          accountId: "r1",
          code: "4101",
          type: "revenue",
          normalBalance: "credit",
          creditTotal: 650_000,
        }),
      ],
    });
    expect(r.balanced).toBe(false);
    expect(r.totalDebit - r.totalCredit).toBe(50_000);
  });

  it("urutan baris dalam grup mengikuti kode akun", () => {
    const r = buildLedgerAccountSummary({
      opening: [],
      movement: [
        row({ accountId: "a3", code: "1142", debitTotal: 1 }),
        row({ accountId: "a1", code: "1101", debitTotal: 1 }),
        row({ accountId: "a2", code: "1110", debitTotal: 1 }),
      ],
    });
    expect(r.groups[0].rows.map((x) => x.code)).toEqual([
      "1101",
      "1110",
      "1142",
    ]);
  });
});
