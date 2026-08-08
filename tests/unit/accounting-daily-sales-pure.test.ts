import { describe, expect, it } from "vitest";
import {
  DailyAggregateError,
  datesTouchedByShift,
  isDailyJournalDate,
  jakartaDateOf,
  toDailyComplimentInput,
  toDailySaleInput,
  totalCogsOf,
  type DailySalesAggregate,
} from "@/features/accounting/daily-sales-pure";
import { mapPosSale } from "@/features/accounting/mapping/posSale";
import { mapPosCompliment } from "@/features/accounting/mapping/posCompliment";

const BATCH = "11111111-1111-4111-8111-111111111111";

function agg(over: Partial<DailySalesAggregate> = {}): DailySalesAggregate {
  return {
    entryDate: "2026-08-08",
    outletId: "out-1",
    transactionCount: 3,
    total: 90_000,
    subtotal: 100_000,
    discountAmount: 10_000,
    payments: [
      { paymentMethod: "cash", amount: 50_000 },
      { paymentMethod: "qris", amount: 40_000 },
    ],
    categories: [
      { itemCategoryName: "Coffee", amount: 60_000, cogs: 18_000 },
      { itemCategoryName: "Snack", amount: 40_000, cogs: 12_000 },
    ],
    ...over,
  };
}

describe("jakartaDateOf", () => {
  it("memakai kalender WIB, bukan UTC", () => {
    // 23:30 WIB masih hari yang sama walau di UTC sudah/belum berganti.
    expect(jakartaDateOf("2026-08-08T16:30:00.000Z")).toBe("2026-08-08");
    // 00:30 WIB tanggal 9 = 17:30 UTC tanggal 8.
    expect(jakartaDateOf("2026-08-08T17:30:00.000Z")).toBe("2026-08-09");
  });
});

describe("datesTouchedByShift", () => {
  const now = new Date("2026-08-09T12:00:00.000Z");

  it("shift dalam satu hari → satu tanggal", () => {
    expect(
      datesTouchedByShift(
        "2026-08-08T03:00:00.000Z", // 10:00 WIB
        "2026-08-08T14:00:00.000Z", // 21:00 WIB
        now,
      ),
    ).toEqual(["2026-08-08"]);
  });

  it("shift lewat tengah malam → DUA tanggal", () => {
    // buka 09 Agu 10:00 WIB, tutup 10 Agu 01:30 WIB
    expect(
      datesTouchedByShift(
        "2026-08-09T03:00:00.000Z",
        "2026-08-09T18:30:00.000Z",
        now,
      ),
    ).toEqual(["2026-08-09", "2026-08-10"]);
  });

  it("shift belum ditutup dihitung sampai sekarang", () => {
    expect(
      datesTouchedByShift("2026-08-08T03:00:00.000Z", null, now),
    ).toEqual(["2026-08-08", "2026-08-09"]);
  });

  it("dibatasi supaya shift yatim tidak membangkitkan ribuan tanggal", () => {
    expect(
      datesTouchedByShift(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        now,
      ),
    ).toHaveLength(31);
  });
});

describe("isDailyJournalDate", () => {
  it("false kalau cutover belum diset — perilaku lama dipertahankan", () => {
    expect(isDailyJournalDate("2026-08-08", null)).toBe(false);
    expect(isDailyJournalDate("2026-08-08", undefined)).toBe(false);
  });

  it("berlaku sejak tanggal cutover, inklusif", () => {
    expect(isDailyJournalDate("2026-08-07", "2026-08-08")).toBe(false);
    expect(isDailyJournalDate("2026-08-08", "2026-08-08")).toBe(true);
    expect(isDailyJournalDate("2026-08-09", "2026-08-08")).toBe(true);
  });
});

describe("toDailySaleInput", () => {
  it("menghasilkan jurnal yang seimbang lewat mapPosSale", () => {
    const lines = mapPosSale(toDailySaleInput(agg(), BATCH));
    const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debit).toBe(credit);
  });

  it("kas + piutang sesuai metode bayar hari itu", () => {
    const lines = mapPosSale(toDailySaleInput(agg(), BATCH));
    const kas = lines.find((l) => l.accountCode === "1101");
    const qris = lines.find((l) => l.accountCode === "1120");
    expect(kas?.debit).toBe(50_000);
    expect(qris?.debit).toBe(40_000);
  });

  it("pendapatan dikredit bruto, diskon jadi kontra terpisah", () => {
    const lines = mapPosSale(toDailySaleInput(agg(), BATCH));
    const drink = lines.find((l) => l.accountCode === "4102");
    const food = lines.find((l) => l.accountCode === "4101");
    const diskon = lines.find((l) => l.accountCode === "4110");
    expect(drink?.credit).toBe(60_000);
    expect(food?.credit).toBe(40_000);
    expect(diskon?.debit).toBe(10_000);
  });

  it("menolak kalau total tidak sama dengan jumlah metode bayar", () => {
    expect(() =>
      toDailySaleInput(
        agg({ payments: [{ paymentMethod: "cash", amount: 1_000 }] }),
        BATCH,
      ),
    ).toThrow(DailyAggregateError);
  });

  it("menolak kalau total ≠ subtotal - diskon", () => {
    expect(() => toDailySaleInput(agg({ discountAmount: 5_000 }), BATCH)).toThrow(
      /DAILY_SALES_TOTAL_MISMATCH/,
    );
  });

  it("menolak kalau jumlah kategori tidak sama dengan subtotal", () => {
    expect(() =>
      toDailySaleInput(
        agg({
          categories: [
            { itemCategoryName: "Coffee", amount: 10_000, cogs: 0 },
          ],
        }),
        BATCH,
      ),
    ).toThrow(/DAILY_SALES_CATEGORY_MISMATCH/);
  });

  it("menolak hari tanpa metode bayar sama sekali", () => {
    expect(() => toDailySaleInput(agg({ payments: [] }), BATCH)).toThrow(
      /DAILY_SALES_NO_PAYMENTS/,
    );
  });

  it("label jurnal memuat tanggal & jumlah transaksi, bukan UUID", () => {
    const input = toDailySaleInput(agg(), BATCH);
    expect(input.transactionNumber).toBe("2026-08-08 (3 transaksi)");
    expect(input.transactionNumber).not.toContain(BATCH);
  });

  it("hari dengan satu metode bayar saja tetap valid", () => {
    const oneMethod = agg({
      payments: [{ paymentMethod: "cash", amount: 90_000 }],
    });
    const lines = mapPosSale(toDailySaleInput(oneMethod, BATCH));
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(90_000);
  });
});

describe("toDailyComplimentInput", () => {
  it("hanya membebankan HPP ke marketing, tanpa pendapatan", () => {
    const lines = mapPosCompliment(
      toDailyComplimentInput(
        {
          entryDate: "2026-08-08",
          outletId: "out-1",
          transactionCount: 2,
          categories: [
            { itemCategoryName: "Coffee", amount: 0, cogs: 7_000 },
          ],
        },
        BATCH,
      ),
    );
    expect(lines.find((l) => l.accountCode === "6304")?.debit).toBe(7_000);
    expect(lines.find((l) => l.accountCode === "1141")?.credit).toBe(7_000);
    expect(lines.some((l) => l.accountCode?.startsWith("41"))).toBe(false);
  });

  it("tanpa HPP → tidak ada baris (jangan posting entry kosong)", () => {
    const lines = mapPosCompliment(
      toDailyComplimentInput(
        {
          entryDate: "2026-08-08",
          outletId: "out-1",
          transactionCount: 1,
          categories: [{ itemCategoryName: "Coffee", amount: 0, cogs: 0 }],
        },
        BATCH,
      ),
    );
    expect(lines).toEqual([]);
  });
});

describe("totalCogsOf", () => {
  it("menjumlah HPP semua kategori", () => {
    expect(totalCogsOf(agg().categories)).toBe(30_000);
    expect(totalCogsOf([])).toBe(0);
  });
});
