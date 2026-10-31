import { describe, expect, it } from "vitest";
import {
  promoWaivesPinApprover,
  wibWallClock,
  type CartContext,
} from "@/features/promos/eligibility";
import type { Promo } from "@/features/promos/types";

/* Sesi AE-259 — promo "PROMO 20% AL-IKHLAS" (Butuh persetujuan OFF) tetap
 * ditolak "Staff butuh approver untuk apply discount": server dulu menuntut
 * PIN untuk SEMUA diskon staff dan tidak pernah membaca setelan promo. */

const promo: Promo = {
  id: "00000000-0000-0000-0000-000000000001",
  outletId: "00000000-0000-0000-0000-0000000000aa",
  name: "PROMO 20% AL-IKHLAS",
  description: null,
  discountType: "percent",
  discountValue: 20,
  maxDiscountAmount: null,
  scope: "whole_bill",
  scopeCategoryIds: null,
  minSubtotal: null,
  applicableOrderTypes: null,
  applicablePaymentMethods: null,
  startDate: null,
  endDate: null,
  daysOfWeek: null,
  startTime: null,
  endTime: null,
  maxTotalUses: null,
  currentUses: 0,
  requiresApproval: false,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
};

const cart: CartContext = {
  subtotal: 25000,
  lines: [{ categoryId: null, lineSubtotal: 25000 }],
  orderType: "dine_in",
  paymentMethod: "cash",
  now: new Date(2026, 9, 31, 15, 0),
};

describe("promoWaivesPinApprover", () => {
  it("promo tanpa persetujuan + nominal cocok → tidak perlu PIN", () => {
    expect(promoWaivesPinApprover(promo, cart, 5000)).toBe(true);
  });

  it("nominal diskon tidak sama dengan hitungan promo → tetap perlu PIN", () => {
    expect(promoWaivesPinApprover(promo, cart, 10000)).toBe(false);
  });

  it("promo yang butuh persetujuan → tetap perlu PIN", () => {
    expect(
      promoWaivesPinApprover({ ...promo, requiresApproval: true }, cart, 5000),
    ).toBe(false);
  });

  it("promo tidak ditemukan / tidak aktif → tetap perlu PIN", () => {
    expect(promoWaivesPinApprover(null, cart, 5000)).toBe(false);
    expect(
      promoWaivesPinApprover({ ...promo, status: "paused" }, cart, 5000),
    ).toBe(false);
  });

  it("di luar jam promo → tetap perlu PIN", () => {
    expect(
      promoWaivesPinApprover(
        { ...promo, startTime: "09:00", endTime: "12:00" },
        cart,
        5000,
      ),
    ).toBe(false);
  });
});

describe("wibWallClock", () => {
  it("08:30 UTC dibaca sebagai 15:30 WIB lewat getter lokal", () => {
    const d = wibWallClock(new Date("2026-10-31T08:30:00Z"));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 31]);
    expect([d.getHours(), d.getMinutes()]).toEqual([15, 30]);
  });

  it("20:00 UTC sudah hari berikutnya di WIB", () => {
    const d = wibWallClock(new Date("2026-10-31T20:00:00Z"));
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(3);
  });
});
