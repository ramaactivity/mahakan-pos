import { describe, expect, it } from "vitest";
import {
  computeExpectedCash,
  computeShiftCashSummary,
  type ShiftTxnRow,
} from "@/features/shifts/close-pure";

const txn = (
  status: ShiftTxnRow["status"],
  paymentMethod: string,
  total: number,
  refundedAmount = 0,
): ShiftTxnRow => ({ status, paymentMethod, total, refundedAmount });

describe("computeShiftCashSummary — paid status", () => {
  it("counts cash payment di paidCash + paidCount", () => {
    const summary = computeShiftCashSummary([
      txn("paid", "cash", 50_000),
      txn("paid", "cash", 30_000),
    ]);
    expect(summary.paidCount).toBe(2);
    expect(summary.paidCash).toBe(80_000);
    expect(summary.paidQris).toBe(0);
    expect(summary.paidCard).toBe(0);
    expect(summary.refundedCount).toBe(0);
    expect(summary.refundedCash).toBe(0);
  });

  it("separates qris vs cash vs card", () => {
    const summary = computeShiftCashSummary([
      txn("paid", "cash", 50_000),
      txn("paid", "qris", 30_000),
      txn("paid", "card_bca", 20_000),
    ]);
    expect(summary.paidCash).toBe(50_000);
    expect(summary.paidQris).toBe(30_000);
    expect(summary.paidCard).toBe(20_000);
  });
});

describe("computeShiftCashSummary — voided status", () => {
  it("voided tidak masuk paidCash atau refundedCash", () => {
    const summary = computeShiftCashSummary([
      txn("voided", "cash", 50_000),
      txn("paid", "cash", 30_000),
    ]);
    expect(summary.voidedCount).toBe(1);
    expect(summary.voidedAmount).toBe(50_000);
    expect(summary.paidCount).toBe(1);
    expect(summary.paidCash).toBe(30_000);
  });
});

describe("computeShiftCashSummary — refunded (full) status (sesi AE-45 FIX)", () => {
  // Sebelum AE-45: full refund cuma count refundedCash += total tanpa
  // add original payment ke paidCash → expectedCash bias -total dari
  // physical drawer → variance +total alarm palsu.

  it("full refund cash: paidCash counts original + refundedCash counts refund (net 0)", () => {
    const summary = computeShiftCashSummary([
      txn("refunded", "cash", 50_000, 50_000),
    ]);
    expect(summary.refundedCount).toBe(1);
    expect(summary.paidCount).toBe(1); // AE-45: count original payment
    expect(summary.refundedAmount).toBe(50_000);
    expect(summary.refundedCash).toBe(50_000);
    expect(summary.paidCash).toBe(50_000); // AE-45: original payment came in drawer
    // Net cash drawer impact = paidCash - refundedCash = 0 ✓ matches physical
  });

  it("full refund qris: paidQris counts original, refundedCash tidak terpengaruh", () => {
    const summary = computeShiftCashSummary([
      txn("refunded", "qris", 30_000, 30_000),
    ]);
    expect(summary.refundedAmount).toBe(30_000);
    expect(summary.refundedCash).toBe(0);
    expect(summary.paidQris).toBe(30_000); // AE-45: original qris counted
  });

  it("full refund card: paidCard counts original", () => {
    const summary = computeShiftCashSummary([
      txn("refunded", "card_bca", 75_000, 75_000),
    ]);
    expect(summary.paidCard).toBe(75_000);
    expect(summary.refundedAmount).toBe(75_000);
    expect(summary.refundedCash).toBe(0);
  });

  it("multiple full cash refunds — variance net 0", () => {
    const summary = computeShiftCashSummary([
      txn("refunded", "cash", 50_000, 50_000),
      txn("refunded", "cash", 30_000, 30_000),
      txn("refunded", "cash", 20_000, 20_000),
    ]);
    expect(summary.paidCash).toBe(100_000);
    expect(summary.refundedCash).toBe(100_000);
    // Net drawer = 0 ✓
  });
});

describe("computeShiftCashSummary — partially_refunded status (sesi AE-44 FIX)", () => {
  // Sebelum AE-44: branch ini tidak ada → partial refund LOST in calc.
  // expectedCash = openingCash + paidCash - refundedCash → variance alarm
  // palsu untuk kasir yang sudah balikin cash refund (tampak kurang setor).

  it("partial cash refund: paidCash counts total + refundedCash counts refunded", () => {
    // Transaksi total 50k cash, partial refund 20k cash. Drawer net = +30k.
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "cash", 50_000, 20_000),
    ]);
    expect(summary.paidCount).toBe(1);
    expect(summary.refundedCount).toBe(1);
    expect(summary.paidCash).toBe(50_000); // original payment
    expect(summary.refundedCash).toBe(20_000); // partial refund out
    expect(summary.refundedAmount).toBe(20_000);
    // Net drawer impact = paidCash - refundedCash = 30_000 (matches physical).
  });

  it("partial qris refund: paidQris counts total, refundedCash NOT affected (qris bukan cash)", () => {
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "qris", 50_000, 15_000),
    ]);
    expect(summary.paidQris).toBe(50_000);
    expect(summary.refundedCash).toBe(0);
    expect(summary.refundedAmount).toBe(15_000);
  });

  it("partial refundedAmount=0 (edge: status set but no actual refund) — safe", () => {
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "cash", 50_000, 0),
    ]);
    expect(summary.paidCash).toBe(50_000);
    expect(summary.refundedCash).toBe(0);
  });
});

describe("computeShiftCashSummary — mixed scenario", () => {
  it("real-world shift: paid + voided + full refund + partial refund (post-AE-45 net 0)", () => {
    const summary = computeShiftCashSummary([
      txn("paid", "cash", 50_000),
      txn("paid", "qris", 30_000),
      txn("voided", "cash", 25_000),
      txn("refunded", "cash", 40_000, 40_000),
      txn("partially_refunded", "cash", 60_000, 25_000),
    ]);
    // Paid: cash 50k + full-refund-original 40k + partial-original 60k = 150k cash
    // Qris: 30k
    // Refunded: full 40k cash + partial 25k cash = 65k cash refund.
    // Voided: 25k tracked.
    expect(summary.paidCount).toBe(4); // 2 paid + 1 full refund + 1 partial
    expect(summary.paidCash).toBe(150_000);
    expect(summary.paidQris).toBe(30_000);
    expect(summary.voidedCount).toBe(1);
    expect(summary.voidedAmount).toBe(25_000);
    expect(summary.refundedCount).toBe(2);
    expect(summary.refundedAmount).toBe(65_000);
    expect(summary.refundedCash).toBe(65_000);

    // Net drawer cash: paidCash - refundedCash = 150k - 65k = 85k
    // Physical reality:
    //   paid: +50k → drawer +50k
    //   partial: +60k - 25k = +35k → drawer +35k
    //   refund (full): +40k - 40k = 0 → drawer 0
    //   voided: 0 (assume cancelled before settle)
    // Total drawer = +85k ✓ formula matches physical (no variance bias).
  });

  it("multiple partial refunds — accumulates correctly", () => {
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "cash", 50_000, 10_000),
      txn("partially_refunded", "cash", 80_000, 20_000),
      txn("partially_refunded", "cash", 100_000, 35_000),
    ]);
    expect(summary.paidCount).toBe(3);
    expect(summary.refundedCount).toBe(3);
    expect(summary.paidCash).toBe(230_000);
    expect(summary.refundedCash).toBe(65_000);
    expect(summary.refundedAmount).toBe(65_000);
  });
});

describe("computeShiftCashSummary — petty cash (sesi AE-49 FIX)", () => {
  // Owner bug report: petty cash expense -Rp 38.000 tampil di modal tutup
  // shift TAPI tidak dikurangi dari Kas Harusnya. Result: variance alarm
  // palsu (kasir tampak punya lebihan padahal udah balikin uang ke petty).

  it("default empty petty — fields default 0 (backward-compat)", () => {
    const s = computeShiftCashSummary([txn("paid", "cash", 50_000)]);
    expect(s.pettyExpenseCash).toBe(0);
    expect(s.pettyIncomeCash).toBe(0);
  });

  it("petty expense passed-through ke summary field", () => {
    const s = computeShiftCashSummary(
      [txn("paid", "cash", 605_000)],
      { expenseCash: 38_000, incomeCash: 0 },
    );
    expect(s.pettyExpenseCash).toBe(38_000);
    expect(s.pettyIncomeCash).toBe(0);
  });

  it("petty income passed-through ke summary field", () => {
    const s = computeShiftCashSummary(
      [txn("paid", "cash", 100_000)],
      { expenseCash: 0, incomeCash: 50_000 },
    );
    expect(s.pettyExpenseCash).toBe(0);
    expect(s.pettyIncomeCash).toBe(50_000);
  });

  it("both petty expense + income", () => {
    const s = computeShiftCashSummary(
      [txn("paid", "cash", 200_000)],
      { expenseCash: 20_000, incomeCash: 5_000 },
    );
    expect(s.pettyExpenseCash).toBe(20_000);
    expect(s.pettyIncomeCash).toBe(5_000);
  });
});

describe("computeExpectedCash (sesi AE-49)", () => {
  it("formula tanpa petty: opening + paid - refunded", () => {
    const s = computeShiftCashSummary([txn("paid", "cash", 605_000)]);
    expect(computeExpectedCash(200_000, s)).toBe(605_000);
  });

  it("formula dengan petty expense: opening + paid - refunded - pettyExpense", () => {
    // Reproduce owner bug scenario:
    // Opening 200k + Penjualan Tunai 605k = 805k
    // Minus petty cash expense 38k = 767k expected
    const s = computeShiftCashSummary(
      [txn("paid", "cash", 605_000)],
      { expenseCash: 38_000, incomeCash: 0 },
    );
    expect(computeExpectedCash(200_000, s)).toBe(567_000);
  });

  it("formula dengan petty income: opening + paid - refunded + pettyIncome", () => {
    // Tip Customer cash 50k masuk laci → kas harusnya +50k
    const s = computeShiftCashSummary(
      [txn("paid", "cash", 100_000)],
      { expenseCash: 0, incomeCash: 50_000 },
    );
    expect(computeExpectedCash(200_000, s)).toBe(150_000);
  });

  it("formula dengan both petty + partial refund", () => {
    // Mixed real-world: paid 605k + partial refund 30k cash (return 30k drawer)
    // + petty expense 38k + petty income 10k
    // Expected = 200 + 605 - 30 - 38 + 10 = 747k
    const s = computeShiftCashSummary(
      [
        txn("paid", "cash", 575_000),
        txn("partially_refunded", "cash", 30_000, 30_000),
      ],
      { expenseCash: 38_000, incomeCash: 10_000 },
    );
    expect(computeExpectedCash(200_000, s)).toBe(547_000);
  });

  it("edge: petty expense > paid → expectedCash bisa negatif (owner liat alarm)", () => {
    // Theoretical edge case (kasir hutang lebih besar dari penjualan)
    const s = computeShiftCashSummary(
      [txn("paid", "cash", 10_000)],
      { expenseCash: 50_000, incomeCash: 0 },
    );
    expect(computeExpectedCash(20_000, s)).toBe(-40_000);
  });
});

/* Sesi AE-155 — Split metode payment aggregation. */
describe("computeShiftCashSummary — split payment method", () => {
  const splitTxn = (
    total: number,
    splits: Array<{ paymentMethod: string; amount: number }>,
  ): ShiftTxnRow => ({
    status: "paid",
    paymentMethod: "split",
    total,
    refundedAmount: 0,
    splits,
  });

  it("split cash + QRIS allocates per-method bukan ke total bucket", () => {
    const s = computeShiftCashSummary([
      splitTxn(135_000, [
        { paymentMethod: "cash", amount: 100_000 },
        { paymentMethod: "qris", amount: 35_000 },
      ]),
    ]);
    expect(s.paidCount).toBe(1);
    expect(s.paidCash).toBe(100_000);
    expect(s.paidQris).toBe(35_000);
    expect(s.paidCard).toBe(0);
  });

  it("split cash + EDC card allocates per-method", () => {
    const s = computeShiftCashSummary([
      splitTxn(200_000, [
        { paymentMethod: "cash", amount: 50_000 },
        { paymentMethod: "card_bca", amount: 150_000 },
      ]),
    ]);
    expect(s.paidCash).toBe(50_000);
    expect(s.paidQris).toBe(0);
    expect(s.paidCard).toBe(150_000);
  });

  it("3-way split (cash + QRIS + EDC) sum exact = total", () => {
    const s = computeShiftCashSummary([
      splitTxn(300_000, [
        { paymentMethod: "cash", amount: 100_000 },
        { paymentMethod: "qris", amount: 100_000 },
        { paymentMethod: "card_bri", amount: 100_000 },
      ]),
    ]);
    expect(s.paidCash + s.paidQris + s.paidCard).toBe(300_000);
  });

  it("mix split + non-split trx accurate aggregation", () => {
    const s = computeShiftCashSummary([
      txn("paid", "cash", 50_000),
      splitTxn(135_000, [
        { paymentMethod: "cash", amount: 100_000 },
        { paymentMethod: "qris", amount: 35_000 },
      ]),
      txn("paid", "qris", 60_000),
    ]);
    expect(s.paidCount).toBe(3);
    expect(s.paidCash).toBe(50_000 + 100_000);
    expect(s.paidQris).toBe(35_000 + 60_000);
  });

  it("expectedCash includes split cash allocation", () => {
    /* Bill split: cash 100k + QRIS 35k. Drawer harusnya naik 100k. */
    const s = computeShiftCashSummary([
      splitTxn(135_000, [
        { paymentMethod: "cash", amount: 100_000 },
        { paymentMethod: "qris", amount: 35_000 },
      ]),
    ]);
    /* Opening 200k + paidCash 100k - refunds 0 - petty 0 = 300k */
    expect(computeExpectedCash(200_000, s)).toBe(100_000);
  });

  it("defensive fallback: split trx tanpa splits array → paidCard (avoid lose total)", () => {
    /* Data lama atau anomaly: paymentMethod=split tapi splits undefined.
     * Pure helper fallback ke paidCard supaya total tetap tracked. */
    const s = computeShiftCashSummary([
      {
        status: "paid",
        paymentMethod: "split",
        total: 100_000,
        refundedAmount: 0,
      },
    ]);
    expect(s.paidCash).toBe(0);
    expect(s.paidQris).toBe(0);
    expect(s.paidCard).toBe(100_000);
  });
});

/* ============================================================
 * Sesi AE-228 — SPLIT BILL.
 *
 * Laporan owner: "Bagian split bill tidak masuk ke laporan shift, tidak
 * terdetect." Transaksi split menyimpan literal "split" di `paymentMethod`
 * dan pecahannya di `splits`. Sebelum sesi ini hanya cabang `paid` yang
 * mengerti itu; cabang refund menyaring `paymentMethod === "cash"` yang tidak
 * pernah cocok, jadi seluruh nilainya jatuh ke ember kartu diam-diam.
 * ============================================================ */

function splitTxn(
  status: "paid" | "refunded" | "partially_refunded",
  total: number,
  legs: Array<{ paymentMethod: string; amount: number }>,
  refundedAmount = 0,
) {
  return {
    status,
    paymentMethod: "split" as const,
    total,
    refundedAmount,
    splits: legs,
  };
}

describe("computeShiftCashSummary — split bill", () => {
  /* Kejadian nyata di produksi: Rp 132.000 dibayar Rp 100.000 tunai +
   * Rp 32.000 QRIS. Layar tutup shift tidak menghitung satu pun. */
  const NYATA = splitTxn("paid", 132_000, [
    { paymentMethod: "cash", amount: 100_000 },
    { paymentMethod: "qris", amount: 32_000 },
  ]);

  it("bagian tunai masuk Kas Harusnya, bagian QRIS masuk QRIS", () => {
    const sum = computeShiftCashSummary([NYATA]);
    expect(sum.paidCash).toBe(100_000);
    expect(sum.paidQris).toBe(32_000);
    expect(sum.paidCard).toBe(0);
    expect(sum.paidCount).toBe(1);
  });

  it("Kas Harusnya naik sebesar bagian TUNAI-nya saja", () => {
    const sum = computeShiftCashSummary([NYATA]);
    expect(computeExpectedCash(500_000, sum)).toBe(100_000);
  });

  it("rincian kanal selalu berjumlah sama dengan nilai transaksinya", () => {
    const sum = computeShiftCashSummary([NYATA]);
    expect(sum.paidCash + sum.paidQris + sum.paidCard).toBe(132_000);
  });

  it("pecahan kartu masuk ember kartu, bukan tunai", () => {
    const sum = computeShiftCashSummary([
      splitTxn("paid", 200_000, [
        { paymentMethod: "cash", amount: 50_000 },
        { paymentMethod: "card_bca", amount: 100_000 },
        { paymentMethod: "qris", amount: 50_000 },
      ]),
    ]);
    expect(sum.paidCash).toBe(50_000);
    expect(sum.paidCard).toBe(100_000);
    expect(sum.paidQris).toBe(50_000);
  });

  it("split yang di-refund penuh: hanya bagian tunai yang keluar dari laci", () => {
    /* Bagian QRIS/kartu kembali lewat kanalnya sendiri, bukan dari laci —
     * kalau ikut dipotong, kasir dituduh kurang uang sebesar bagian itu. */
    const sum = computeShiftCashSummary([
      splitTxn("refunded", 132_000, [
        { paymentMethod: "cash", amount: 100_000 },
        { paymentMethod: "qris", amount: 32_000 },
      ]),
    ]);
    expect(sum.paidCash).toBe(100_000);
    expect(sum.paidQris).toBe(32_000);
    expect(sum.refundedCash).toBe(100_000);
    expect(sum.refundedAmount).toBe(132_000);
    /* Uang masuk lalu keluar lagi → penjualan tunai bersihnya nol.
     * Sesi AE-232: kas awal tidak lagi ikut, jadi hasilnya 0, bukan modal. */
    expect(computeExpectedCash(500_000, sum)).toBe(0);
  });

  it("split refund sebagian tidak pernah mengembalikan tunai lebih dari yang masuk", () => {
    /* Refund Rp 120.000 padahal tunai yang masuk cuma Rp 100.000 — sisanya
     * pasti kembali lewat QRIS, bukan dari laci. */
    const sum = computeShiftCashSummary([
      splitTxn(
        "partially_refunded",
        132_000,
        [
          { paymentMethod: "cash", amount: 100_000 },
          { paymentMethod: "qris", amount: 32_000 },
        ],
        120_000,
      ),
    ]);
    expect(sum.refundedCash).toBe(100_000);
    expect(sum.refundedAmount).toBe(120_000);
  });

  it("split refund sebagian di bawah nilai tunai dipotong apa adanya", () => {
    const sum = computeShiftCashSummary([
      splitTxn(
        "partially_refunded",
        132_000,
        [
          { paymentMethod: "cash", amount: 100_000 },
          { paymentMethod: "qris", amount: 32_000 },
        ],
        40_000,
      ),
    ]);
    expect(sum.refundedCash).toBe(40_000);
    expect(computeExpectedCash(0, sum)).toBe(60_000);
  });

  it("split tanpa baris pecahan (data lama) tetap utuh, tidak hilang", () => {
    const sum = computeShiftCashSummary([
      { status: "paid", paymentMethod: "split", total: 90_000, refundedAmount: 0 },
    ]);
    expect(sum.paidCash + sum.paidQris + sum.paidCard).toBe(90_000);
  });

  it("transaksi biasa tidak berubah perilakunya", () => {
    /* Penjagaan regresi: perbaikan split tidak boleh menggeser jalur lama. */
    const sum = computeShiftCashSummary([
      { status: "paid", paymentMethod: "cash", total: 50_000, refundedAmount: 0 },
      { status: "paid", paymentMethod: "qris", total: 25_000, refundedAmount: 0 },
      { status: "refunded", paymentMethod: "qris", total: 10_000, refundedAmount: 0 },
      {
        status: "partially_refunded",
        paymentMethod: "cash",
        total: 30_000,
        refundedAmount: 12_000,
      },
    ]);
    expect(sum.paidCash).toBe(80_000);
    expect(sum.paidQris).toBe(35_000);
    expect(sum.refundedCash).toBe(12_000);
  });
});

/* Sesi AE-232 — kas awal dikeluarkan dari Kas Harusnya atas arahan owner:
 * modal laci sering tercampur petty cash sehingga rekonsiliasi jadi rancu. */
describe("computeExpectedCash — kas awal tidak ikut dihitung", () => {
  const sum = {
    paidCount: 1,
    paidCash: 113_000,
    paidQris: 0,
    paidCard: 0,
    voidedCount: 0,
    voidedAmount: 0,
    refundedCount: 0,
    refundedAmount: 0,
    refundedCash: 0,
    pettyExpenseCash: 0,
    pettyIncomeCash: 0,
  };

  it("berapa pun modal lacinya, hasilnya sama", () => {
    expect(computeExpectedCash(0, sum)).toBe(113_000);
    expect(computeExpectedCash(200_000, sum)).toBe(113_000);
    expect(computeExpectedCash(1_000_000, sum)).toBe(113_000);
  });
});
