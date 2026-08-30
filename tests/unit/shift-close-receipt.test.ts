import { describe, it, expect } from "vitest";
import {
  buildShiftCloseReceipt,
  sumShiftIncome,
  type ShiftCloseReceiptData,
} from "@/lib/printer/shift-close-builder";
import { buildShiftCloseReceiptData } from "@/features/shifts/close-receipt-data";
import type { Shift, ShiftSummary } from "@/features/shifts/types";

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function sample(
  overrides: Partial<ShiftCloseReceiptData> = {},
): ShiftCloseReceiptData {
  return {
    outletName: "Mahakan Coffee & Space",
    outletAddress: "Puncak Rd KM 22, Cisarua",
    cashierName: "Rina",
    openedAt: new Date("2026-08-30T01:00:00Z"), // 08:00 WIB
    closedAt: new Date("2026-08-30T15:00:00Z"), // 22:00 WIB
    incomeCash: 1_200_000,
    channels: [
      { label: "QRIS", amount: 800_000, reported: 800_000 },
      { label: "EDC / Kartu", amount: 500_000, reported: null },
    ],
    openingCash: 300_000,
    pettyExpenseCash: 50_000,
    pettyIncomeCash: 0,
    refundedAmount: 0,
    expectedCash: 1_450_000,
    actualCash: 1_450_000,
    paidCount: 42,
    voidedCount: 0,
    voidedAmount: 0,
    refundedCount: 0,
    ...overrides,
  };
}

describe("buildShiftCloseReceipt", () => {
  it("starts with ESC @ init and ends with a cut", () => {
    const bytes = buildShiftCloseReceipt(sample());
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    // GS V — paper cut
    expect([...bytes.slice(-3)]).toEqual([0x1d, 0x56, 0x00]);
  });

  it("prints the three income channels and their total", () => {
    const t = decode(buildShiftCloseReceipt(sample()));
    expect(t).toContain("PEMASUKAN");
    expect(t).toContain("Tunai");
    expect(t).toContain("QRIS");
    expect(t).toContain("EDC / Kartu");
    expect(t).toContain("TOTAL INCOME");
    // 1.200.000 + 800.000 + 500.000
    expect(t).toContain("Rp 2.500.000");
  });

  it("never prints a sold-item list — owner directive", () => {
    const t = decode(buildShiftCloseReceipt(sample()));
    // Struk closing hanya uang; tidak ada blok item seperti struk penjualan.
    expect(t).not.toContain("ITEM");
    expect(t).not.toContain("Subtotal");
    expect(t).not.toContain("x ");
  });

  it("marks cash variance with direction, and PAS when it matches", () => {
    expect(decode(buildShiftCloseReceipt(sample()))).toContain("PAS");

    const short = decode(
      buildShiftCloseReceipt(sample({ actualCash: 1_400_000 })),
    );
    expect(short).toContain("-Rp 50.000");
    expect(short).toContain("(kas kurang)");

    const over = decode(
      buildShiftCloseReceipt(sample({ actualCash: 1_500_000 })),
    );
    expect(over).toContain("+Rp 50.000");
    expect(over).toContain("(kas lebih)");
  });

  it("prints the kasir-reported figure only when it differs from POS", () => {
    const same = decode(buildShiftCloseReceipt(sample()));
    expect(same).not.toContain("lapor");

    const differs = decode(
      buildShiftCloseReceipt(
        sample({
          channels: [
            { label: "QRIS", amount: 800_000, reported: 780_000 },
            { label: "EDC / Kartu", amount: 500_000, reported: null },
          ],
        }),
      ),
    );
    expect(differs).toContain("lapor Rp 780.000");
    expect(differs).toContain("-Rp 20.000");
  });

  it("keeps aggregator settlement out of TOTAL INCOME", () => {
    const d = sample({
      otherSettlements: [
        { label: "GoFood", amount: 400_000 },
        { label: "GrabFood", amount: 0 },
      ],
    });
    const t = decode(buildShiftCloseReceipt(d));
    expect(t).toContain("GoFood");
    // Channel bernilai 0 tidak dicetak sama sekali.
    expect(t).not.toContain("GrabFood");
    // Total tetap 2.500.000 — aggregator tidak ikut dijumlah.
    expect(sumShiftIncome(d)).toBe(2_500_000);
    expect(t).toContain("Rp 2.500.000");
  });

  it("flags a reprint so the second sheet is not mistaken for another shift", () => {
    expect(decode(buildShiftCloseReceipt(sample()))).not.toContain(
      "CETAK ULANG",
    );
    expect(decode(buildShiftCloseReceipt(sample({ reprint: true })))).toContain(
      "** CETAK ULANG **",
    );
  });

  it("strips non-ASCII from free text so the printer does not garble it", () => {
    const t = decode(
      buildShiftCloseReceipt(
        sample({
          cashierName: "Rina — shift 2",
          notes: "Mesin es rusak 🙁 “cek besok”",
        }),
      ),
    );
    expect(t).toContain("Rina - shift 2");
    expect(t).toContain('Mesin es rusak "cek besok"');
    expect(/[^\x00-\x7F]/.test(t)).toBe(false);
  });

  it("prints deposit and handover blocks only when filled", () => {
    const bare = decode(buildShiftCloseReceipt(sample()));
    expect(bare).not.toContain("SETORAN KE OWNER");
    expect(bare).not.toContain("PESAN SHIFT BERIKUT");

    const full = decode(
      buildShiftCloseReceipt(
        sample({
          depositAmount: 1_000_000,
          depositDestination: "BCA Owner",
          notes: "Mesin es rusak",
          handoverMessage: "Stok susu tinggal 2",
        }),
      ),
    );
    expect(full).toContain("SETORAN KE OWNER");
    expect(full).toContain("BCA Owner");
    expect(full).toContain("Mesin es rusak");
    expect(full).toContain("Stok susu tinggal 2");
  });

  it("prints the full close date when the shift crossed midnight", () => {
    const sameDay = decode(buildShiftCloseReceipt(sample()));
    // Jam tutup saja — tanggal tidak diulang.
    expect(sameDay).toMatch(/Tutup\s+: \d{2}\.\d{2}/);

    const overnight = decode(
      buildShiftCloseReceipt(
        sample({ closedAt: new Date("2026-08-31T18:00:00Z") }),
      ),
    );
    expect(overnight).toMatch(/Tutup\s+: 01 Sep 2026/);
  });
});

describe("buildShiftCloseReceiptData", () => {
  const shift = {
    id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    openingCash: 300_000,
    actualCash: 1_450_000,
    notes: null,
    handoverMessage: null,
    qrisSettlement: 800_000,
    edcSettlement: null,
    gofoodSettlement: 400_000,
    grabfoodSettlement: null,
    shopeefoodSettlement: null,
    openedAt: new Date("2026-08-30T01:00:00Z"),
    closedAt: new Date("2026-08-30T15:00:00Z"),
  } as unknown as Shift;

  const summary: ShiftSummary = {
    transactionCount: 42,
    paid: { count: 42, cash: 1_200_000, qris: 800_000, cardBca: 500_000 },
    voided: { count: 1, totalAmount: 25_000 },
    refunded: { count: 0, totalAmount: 0 },
    expectedCash: 1_450_000,
    pettyExpenseCash: 50_000,
    pettyIncomeCash: 0,
  };

  it("maps POS totals into the three income channels", () => {
    const d = buildShiftCloseReceiptData({
      shift,
      summary,
      cashierName: "Rina",
      outletName: "Mahakan",
      outletAddress: null,
    });
    expect(d.incomeCash).toBe(1_200_000);
    expect(d.channels.map((c) => c.label)).toEqual(["QRIS", "EDC / Kartu"]);
    expect(d.channels[0]!.amount).toBe(800_000);
    expect(d.channels[1]!.amount).toBe(500_000);
    expect(sumShiftIncome(d)).toBe(2_500_000);
  });

  it("carries aggregator settlement separately, defaulting nulls to 0", () => {
    const d = buildShiftCloseReceiptData({
      shift,
      summary,
      cashierName: "Rina",
      outletName: "Mahakan",
      outletAddress: null,
    });
    expect(d.otherSettlements).toEqual([
      { label: "GoFood", amount: 400_000 },
      { label: "GrabFood", amount: 0 },
      { label: "ShopeeFood", amount: 0 },
    ]);
    // Tidak menggeser total pemasukan.
    expect(sumShiftIncome(d)).toBe(2_500_000);
  });

  it("falls back to 0 when actualCash is null (shift never counted)", () => {
    const d = buildShiftCloseReceiptData({
      shift: { ...shift, actualCash: null } as unknown as Shift,
      summary,
      cashierName: "Rina",
      outletName: "Mahakan",
      outletAddress: null,
    });
    expect(d.actualCash).toBe(0);
  });
});
