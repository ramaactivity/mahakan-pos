import { describe, expect, it } from "vitest";
import {
  buildShiftCloseSummaryText,
  normalizePhoneForWa,
} from "@/features/shifts/close-summary-text";
import type { Shift, ShiftSummary } from "@/features/shifts/types";

/* Audit POS E2E 2026-06-12 — Ringkasan Tutup Shift (WA/salin). */

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "shift-1",
    outletId: "outlet-1",
    userId: "user-1",
    status: "closed",
    openingCash: 200_000,
    actualCash: 1_395_000,
    variance: -5_000,
    notes: null,
    handoverMessage: null,
    edcSettlement: null,
    gofoodSettlement: null,
    grabfoodSettlement: null,
    shopeefoodSettlement: null,
    qrisSettlement: 350_000,
    cashSalesReported: null,
    openedAt: new Date("2026-06-12T01:00:00Z"), // 08:00 WIB
    closedAt: new Date("2026-06-12T09:05:00Z"), // 16:05 WIB
    createdAt: new Date("2026-06-12T01:00:00Z"),
    updatedAt: new Date("2026-06-12T09:05:00Z"),
    ...overrides,
  } as Shift;
}

function makeSummary(overrides: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    transactionCount: 26,
    paid: { count: 24, cash: 1_250_000, qris: 350_000, cardBca: 0 },
    voided: { count: 1, totalAmount: 35_000 },
    refunded: { count: 1, totalAmount: 50_000 },
    expectedCash: 1_400_000,
    pettyExpenseCash: 30_000,
    pettyIncomeCash: 0,
    depositId: null,
    depositError: null,
    ...overrides,
  };
}

describe("buildShiftCloseSummaryText", () => {
  it("memuat section kas + selisih kurang dengan tanda minus", () => {
    const text = buildShiftCloseSummaryText({
      shift: makeShift(),
      summary: makeSummary(),
      cashierName: "Galih",
    });
    expect(text).toContain("*TUTUP SHIFT MAHAKAN*");
    expect(text).toContain("Kasir: Galih");
    expect(text).toContain("Kas awal: Rp 200.000");
    expect(text).toContain("Kas seharusnya: Rp 1.400.000");
    expect(text).toContain("Kas dihitung: Rp 1.395.000");
    expect(text).toContain("(kurang)");
    expect(text).toContain("Kas keluar: -Rp 30.000");
    expect(text).toContain("QRIS: Rp 350.000");
    expect(text).toContain("24 lunas");
    expect(text).toContain("1 void");
    expect(text).toContain("1 refund");
  });

  it("variance 0 → label pas, tanpa section setoran kalau tidak ada", () => {
    const text = buildShiftCloseSummaryText({
      shift: makeShift({ variance: 0, actualCash: 1_400_000 }),
      summary: makeSummary(),
      cashierName: "Galih",
    });
    expect(text).toContain("Rp 0 (pas)");
    expect(text).not.toContain("*SETORAN*");
  });

  it("deposit gagal → warning setoran belum tercatat", () => {
    const text = buildShiftCloseSummaryText({
      shift: makeShift(),
      summary: makeSummary({
        depositError: { code: "OVERLAP", message: "periode bentrok" },
      }),
      cashierName: "Galih",
    });
    expect(text).toContain("Setoran BELUM tercatat");
  });

  it("settlement null semua → section non-tunai disembunyikan", () => {
    const text = buildShiftCloseSummaryText({
      shift: makeShift({ qrisSettlement: null }),
      summary: makeSummary(),
      cashierName: "Galih",
    });
    expect(text).not.toContain("*NON-TUNAI");
  });

  it("catatan + handover ikut tampil", () => {
    const text = buildShiftCloseSummaryText({
      shift: makeShift({
        notes: "[TUTUP PAKSA owner] kasir lupa tutup",
        handoverMessage: "Galon tinggal 1",
      }),
      summary: makeSummary(),
      cashierName: "Rama",
    });
    expect(text).toContain("Catatan: [TUTUP PAKSA owner] kasir lupa tutup");
    expect(text).toContain("Pesan shift berikut: Galon tinggal 1");
  });
});

describe("normalizePhoneForWa", () => {
  it("0812 → 62812", () => {
    expect(normalizePhoneForWa("0812-3456-789")).toBe("628123456789");
  });
  it("+62 dipertahankan tanpa plus", () => {
    expect(normalizePhoneForWa("+62 812 3456 789")).toBe("628123456789");
  });
  it("sudah 62 → tetap", () => {
    expect(normalizePhoneForWa("628123456789")).toBe("628123456789");
  });
});
