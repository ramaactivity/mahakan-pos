import { describe, it, expect } from "vitest";
import {
  mapPosSaleCorrection,
  mapPosSaleReversal,
} from "@/features/accounting/mapping";
import type { AggregatedItem } from "@/features/accounting/mapping";

function sumDebit(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.debit ?? 0), 0);
}
function sumCredit(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.credit ?? 0), 0);
}
function isBalanced(lines: Array<{ debit?: number; credit?: number }>) {
  return sumDebit(lines) === sumCredit(lines);
}

const COGS_CODES = ["5101", "5102", "5103", "1140", "1141", "1142"];
function hasCogs(lines: Array<{ accountCode?: string }>) {
  return lines.some((l) => l.accountCode && COGS_CODES.includes(l.accountCode));
}

function singleDrinkItem(amount = 50_000, cogs = 10_000): AggregatedItem[] {
  return [
    {
      itemCategoryName: "Minuman",
      amount,
      cogs,
    },
  ];
}

const baseInput = {
  transactionId: "trx-1",
  transactionNumber: "TRX-20260518-0001",
  outletId: "outlet-1",
  entryDate: "2026-05-18",
};

describe("mapPosSaleReversal — sesi AE-62r", () => {
  it("cash sale 50k → reversal balanced + COGS stripped + Dr↔Cr swapped", () => {
    const lines = mapPosSaleReversal({
      ...baseInput,
      paymentMethod: "cash",
      total: 50_000,
      subtotal: 50_000,
      discountAmount: 0,
      items: singleDrinkItem(50_000, 10_000),
      reason: "Salah pencet cash",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(hasCogs(lines)).toBe(false);
    // Original kas 1101 Dr → reversal: 1101 Cr
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(50_000);
    // Original revenue 4102 Cr → reversal: 4102 Dr
    expect(lines.find((l) => l.accountCode === "4102")?.debit).toBe(50_000);
    // Description di-prefix REVERSE
    for (const l of lines) {
      expect(l.description).toMatch(/^REVERSE:/);
      expect(l.description).toContain("Salah pencet cash");
    }
  });

  it("QRIS sale dengan diskon → reversal preserves discount kontra (4110) flipped to Cr", () => {
    const lines = mapPosSaleReversal({
      ...baseInput,
      paymentMethod: "qris",
      total: 45_000,
      subtotal: 50_000,
      discountAmount: 5_000,
      items: singleDrinkItem(50_000, 10_000),
      reason: "Customer pindah pembayaran",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(hasCogs(lines)).toBe(false);
    // QRIS 1120 Dr → reversal: 1120 Cr
    expect(lines.find((l) => l.accountCode === "1120")?.credit).toBe(45_000);
    // Diskon 4110 Dr → reversal: 4110 Cr
    expect(lines.find((l) => l.accountCode === "4110")?.credit).toBe(5_000);
    // Revenue 4102 50k gross Cr → reversal: 4102 Dr
    expect(lines.find((l) => l.accountCode === "4102")?.debit).toBe(50_000);
  });

  it("split sale 30k cash + 70k qris → reversal both legs swapped", () => {
    const lines = mapPosSaleReversal({
      ...baseInput,
      paymentMethod: "split",
      total: 100_000,
      subtotal: 100_000,
      discountAmount: 0,
      items: singleDrinkItem(100_000, 30_000),
      splits: [
        { paymentMethod: "cash", amount: 30_000 },
        { paymentMethod: "qris", amount: 70_000 },
      ],
      reason: "Restructure",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(hasCogs(lines)).toBe(false);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(30_000);
    expect(lines.find((l) => l.accountCode === "1120")?.credit).toBe(70_000);
    expect(lines.find((l) => l.accountCode === "4102")?.debit).toBe(100_000);
  });
});

describe("mapPosSaleCorrection — sesi AE-62r", () => {
  it("corrected qris 50k → revenue side only, COGS stripped", () => {
    const lines = mapPosSaleCorrection({
      ...baseInput,
      paymentMethod: "qris",
      total: 50_000,
      subtotal: 50_000,
      discountAmount: 0,
      items: singleDrinkItem(50_000, 10_000),
      reason: "Koreksi salah pencet cash",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(hasCogs(lines)).toBe(false);
    expect(lines.find((l) => l.accountCode === "1120")?.debit).toBe(50_000);
    expect(lines.find((l) => l.accountCode === "4102")?.credit).toBe(50_000);
    for (const l of lines) {
      expect(l.description).toMatch(/^KOREKSI:/);
      expect(l.description).toContain("Koreksi salah pencet cash");
    }
  });

  it("corrected total turun (loyalty floor scenario) → discountAmount baru lebih besar, balanced", () => {
    // Original 50k, sekarang corrected ke 40k dengan subtotal tetap 50k
    // → corrected discountAmount = 10k (auto-derived by request action)
    const lines = mapPosSaleCorrection({
      ...baseInput,
      paymentMethod: "qris",
      total: 40_000,
      subtotal: 50_000,
      discountAmount: 10_000,
      items: singleDrinkItem(50_000, 10_000),
      reason: "Salah input total",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(hasCogs(lines)).toBe(false);
    expect(lines.find((l) => l.accountCode === "1120")?.debit).toBe(40_000);
    expect(lines.find((l) => l.accountCode === "4110")?.debit).toBe(10_000);
    expect(lines.find((l) => l.accountCode === "4102")?.credit).toBe(50_000);
    // Sumcheck Dr (40k+10k) = Cr (50k) ✓
  });

  it("corrected split 60k cash + 40k qris → both legs at corrected", () => {
    const lines = mapPosSaleCorrection({
      ...baseInput,
      paymentMethod: "split",
      total: 100_000,
      subtotal: 100_000,
      discountAmount: 0,
      items: singleDrinkItem(100_000, 30_000),
      splits: [
        { paymentMethod: "cash", amount: 60_000 },
        { paymentMethod: "qris", amount: 40_000 },
      ],
      reason: "Restructure split",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(hasCogs(lines)).toBe(false);
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(60_000);
    expect(lines.find((l) => l.accountCode === "1120")?.debit).toBe(40_000);
    expect(lines.find((l) => l.accountCode === "4102")?.credit).toBe(100_000);
  });
});

describe("Round-trip: reversal + correction net to zero on Kas side", () => {
  it("cash→qris swap: net Kas 1101 = -50k, net QRIS 1120 = +50k", () => {
    const reversal = mapPosSaleReversal({
      ...baseInput,
      paymentMethod: "cash",
      total: 50_000,
      subtotal: 50_000,
      discountAmount: 0,
      items: singleDrinkItem(50_000, 10_000),
      reason: "Swap test",
    });
    const correction = mapPosSaleCorrection({
      ...baseInput,
      paymentMethod: "qris",
      total: 50_000,
      subtotal: 50_000,
      discountAmount: 0,
      items: singleDrinkItem(50_000, 10_000),
      reason: "Swap test",
    });
    const all = [...reversal, ...correction];
    function netByCode(code: string) {
      let dr = 0;
      let cr = 0;
      for (const l of all) {
        if (l.accountCode === code) {
          dr += l.debit ?? 0;
          cr += l.credit ?? 0;
        }
      }
      return dr - cr;
    }
    // Kas: 50k Cr (reversal) → net -50k
    expect(netByCode("1101")).toBe(-50_000);
    // QRIS: 50k Dr (correction) → net +50k
    expect(netByCode("1120")).toBe(50_000);
    // Revenue 4102: gross +50k Cr (correction) - 50k Dr (reversal) = 0
    expect(netByCode("4102")).toBe(0);
    // Total: balanced
    expect(sumDebit(all)).toBe(sumCredit(all));
  });
});
