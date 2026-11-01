import { describe, expect, it } from "vitest";
import { stripPerpetualCogsLines } from "@/features/accounting/periodic-cogs";
import { mapPosSale } from "@/features/accounting/mapping/posSale";
import { buildPeriodicCloseLines, persediaanCodeForSection } from "@/features/cogs/cogs-calc";

/* Sesi AE-260 — owner: penjualan menu tidak mengurangi saldo akun Persediaan;
 * HPP = stok awal + pembelian − stok akhir lewat Tutup Periode. */

const balanced = (lines: { debit?: number; credit?: number }[]) =>
  lines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);

describe("stripPerpetualCogsLines", () => {
  const sale = mapPosSale({
    transactionId: "00000000-0000-0000-0000-000000000001",
    transactionNumber: "TRX-1",
    outletId: "00000000-0000-0000-0000-0000000000aa",
    entryDate: "2026-11-02",
    paymentMethod: "cash",
    total: 45000,
    subtotal: 45000,
    discountAmount: 0,
    items: [
      { itemCategoryName: "Coffee Based", amount: 25000, cogs: 9785 },
      { itemCategoryName: "Ricebowl", amount: 20000, cogs: 13211 },
    ],
  });

  it("jurnal penjualan asli memang menyentuh Persediaan", () => {
    expect(sale.some((l) => l.accountCode?.startsWith("114"))).toBe(true);
  });

  it("periodik: tanpa HPP/Persediaan, tetap seimbang, pendapatan utuh", () => {
    const out = stripPerpetualCogsLines(sale);
    expect(out.some((l) => /^(510[123]|114[012])$/.test(l.accountCode ?? ""))).toBe(false);
    expect(balanced(out)).toBe(0);
    expect(out.reduce((s, l) => s + (l.credit ?? 0), 0)).toBe(45000);
  });
});

describe("buildPeriodicCloseLines", () => {
  it("HPP = saldo buku − fisik per akun, saldo jadi sama dengan fisik", () => {
    const { lines, adjustmentTotal } = buildPeriodicCloseLines({
      // stok awal 7,76jt + pembelian Agustus
      bookBalance: { "1140": 8_134_554, "1141": 10_740_684, "1142": 3_306_756 },
      physical: { "1140": 2_058_588, "1141": 3_200_987, "1142": 1_020_885 },
      periodLabel: "Agustus 2026",
    });
    expect(adjustmentTotal).toBe(6_075_966 + 7_539_697 + 2_285_871);
    expect(balanced(lines)).toBe(0);
    expect(lines.find((l) => l.accountCode === "5101")?.debit).toBe(6_075_966);
    expect(lines.find((l) => l.accountCode === "1140")?.credit).toBe(6_075_966);
  });

  it("fisik lebih besar dari buku (saldo minus) → Persediaan didebit, HPP dikredit", () => {
    const { lines } = buildPeriodicCloseLines({
      bookBalance: { "1140": 0, "1141": 0, "1142": -9_691_195 },
      physical: { "1140": 0, "1141": 0, "1142": 1_382_725 },
      periodLabel: "Oktober 2026",
    });
    expect(lines.find((l) => l.accountCode === "1142")?.debit).toBe(11_073_920);
    expect(lines.find((l) => l.accountCode === "5103")?.credit).toBe(11_073_920);
  });

  it("section cleaning / tanpa section masuk 1142", () => {
    expect(persediaanCodeForSection("cleaning")).toBe("1142");
    expect(persediaanCodeForSection(null)).toBe("1142");
    expect(persediaanCodeForSection("bar")).toBe("1141");
  });
});
