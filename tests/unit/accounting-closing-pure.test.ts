import { describe, expect, it } from "vitest";
import {
  collectPeriodCloseBalances,
  periodBalanceCheck,
  periodBounds,
  periodLabelId,
  summarizeClosingNominals,
  type RawAccountBalance,
} from "@/features/accounting/closing-pure";
import { mapPeriodClose } from "@/features/accounting/mapping/periodClose";

/* Sesi AE-211 — Tutup Buku bulanan. Pratinjau di layar dan jurnal penutup yang
 * benar-benar diposting memakai fungsi yang sama; tes ini menjaga janji itu. */

function bal(
  code: string,
  name: string,
  type: RawAccountBalance["type"],
  normalBalance: RawAccountBalance["normalBalance"],
  debitTotal: number,
  creditTotal: number,
): RawAccountBalance {
  return {
    accountId: `acc-${code}`,
    code,
    name,
    type,
    normalBalance,
    debitTotal,
    creditTotal,
  };
}

/** Sebulan sederhana: jual 10jt, HPP 4jt, beban 3jt, diskon 500rb. */
const BULAN: RawAccountBalance[] = [
  bal("1101", "Kas Tunai", "asset", "debit", 10_000_000, 7_000_000),
  bal("2101", "Hutang Dagang", "liability", "credit", 0, 1_000_000),
  bal("3101", "Modal Owner", "equity", "credit", 0, 50_000_000),
  bal("4101", "Penjualan Makanan", "revenue", "credit", 0, 10_000_000),
  bal("4110", "Diskon Penjualan", "revenue", "debit", 500_000, 0),
  bal("5101", "HPP Kitchen", "cogs", "debit", 4_000_000, 0),
  bal("6202", "Listrik", "expense", "debit", 3_000_000, 0),
  bal("6901", "Lain-lain", "expense", "debit", 0, 0),
];

describe("collectPeriodCloseBalances", () => {
  it("hanya akun nominal yang diambil — akun riil lanjut ke bulan berikutnya", () => {
    const codes = collectPeriodCloseBalances(BULAN).map((b) => b.code);
    expect(codes).toEqual(
      expect.arrayContaining(["4101", "4110", "5101", "6202"]),
    );
    expect(codes).not.toContain("1101");
    expect(codes).not.toContain("2101");
    expect(codes).not.toContain("3101");
  });

  it("akun nominal bersaldo nol dibuang — tidak ada yang perlu ditutup", () => {
    expect(collectPeriodCloseBalances(BULAN).map((b) => b.code)).not.toContain(
      "6901",
    );
  });

  it("saldo dinormalkan ke arah normal akunnya", () => {
    const rows = collectPeriodCloseBalances(BULAN);
    expect(rows.find((r) => r.code === "4101")!.balance).toBe(10_000_000);
    expect(rows.find((r) => r.code === "6202")!.balance).toBe(3_000_000);
  });

  it("akun terbalik dari kelaziman ikut terbawa dengan saldo negatif", () => {
    /* Beban bersaldo kredit itu janggal, tapi menyembunyikannya justru
     * membuat jurnal penutup tidak menyapu habis akunnya. */
    const aneh = [bal("6203", "Air", "expense", "debit", 0, 250_000)];
    expect(collectPeriodCloseBalances(aneh)[0].balance).toBe(-250_000);
  });
});

describe("summarizeClosingNominals", () => {
  const s = summarizeClosingNominals(BULAN);

  it("memisahkan pendapatan, kontra-pendapatan, HPP, dan beban", () => {
    expect(s.revenueTotal).toBe(10_000_000);
    expect(s.contraRevenueTotal).toBe(500_000);
    expect(s.cogsTotal).toBe(4_000_000);
    expect(s.expenseTotal).toBe(3_000_000);
  });

  it("laba bersih = pendapatan − diskon − HPP − beban", () => {
    expect(s.netIncome).toBe(2_500_000);
  });

  it("4110 ditandai kontra-pendapatan (aturannya sama dengan jurnal penutup)", () => {
    expect(s.accounts.find((a) => a.code === "4110")!.isContraRevenue).toBe(true);
    expect(s.accounts.find((a) => a.code === "4101")!.isContraRevenue).toBe(
      false,
    );
  });

  it("akun diurut per kode & memakai nama dari bagan akun", () => {
    expect(s.accounts.map((a) => a.code)).toEqual([
      "4101",
      "4110",
      "5101",
      "6202",
    ]);
    expect(s.accounts[0].name).toBe("Penjualan Makanan");
  });

  it("bulan tanpa mutasi nominal → tidak ada yang ditutup, laba nol", () => {
    const kosong = summarizeClosingNominals([BULAN[0], BULAN[2]]);
    expect(kosong.accounts).toEqual([]);
    expect(kosong.netIncome).toBe(0);
  });
});

describe("pratinjau = jurnal penutup yang diposting", () => {
  it("laba bersih di ringkasan sama dengan yang masuk 3301 Saldo Laba", () => {
    const s = summarizeClosingNominals(BULAN);
    const lines = mapPeriodClose({
      outletId: "outlet-1",
      entryDate: "2026-06-30",
      periodLabel: "2026-06",
      balances: collectPeriodCloseBalances(BULAN),
    });
    const saldoLaba = lines.filter((l) => l.accountCode === "3301");
    expect(saldoLaba).toHaveLength(1);
    expect(saldoLaba[0].credit).toBe(s.netIncome);

    const totalDebit = lines.reduce((t, l) => t + (l.debit ?? 0), 0);
    const totalCredit = lines.reduce((t, l) => t + (l.credit ?? 0), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("bulan rugi → 3301 didebit sebesar ruginya", () => {
    const rugi: RawAccountBalance[] = [
      bal("4101", "Penjualan", "revenue", "credit", 0, 1_000_000),
      bal("6202", "Listrik", "expense", "debit", 3_000_000, 0),
    ];
    const s = summarizeClosingNominals(rugi);
    expect(s.netIncome).toBe(-2_000_000);
    const lines = mapPeriodClose({
      outletId: "outlet-1",
      entryDate: "2026-06-30",
      periodLabel: "2026-06",
      balances: collectPeriodCloseBalances(rugi),
    });
    expect(lines.find((l) => l.accountCode === "3301")!.debit).toBe(2_000_000);
  });
});

describe("periodBalanceCheck", () => {
  it("buku seimbang → tidak ada peringatan", () => {
    const seimbang = periodBalanceCheck([
      bal("1101", "Kas", "asset", "debit", 5_000_000, 0),
      bal("4101", "Penjualan", "revenue", "credit", 0, 5_000_000),
    ]);
    expect(seimbang.balanced).toBe(true);
    expect(seimbang.diff).toBe(0);
  });

  it("debit ≠ kredit terdeteksi sebelum buku ditutup", () => {
    const timpang = periodBalanceCheck([
      bal("1101", "Kas", "asset", "debit", 5_000_000, 0),
      bal("4101", "Penjualan", "revenue", "credit", 0, 4_000_000),
    ]);
    expect(timpang.balanced).toBe(false);
    expect(timpang.diff).toBe(1_000_000);
  });
});

describe("periodBounds", () => {
  it("hari terakhir bulan benar, termasuk Februari kabisat", () => {
    expect(periodBounds(2026, 6)).toEqual({
      firstDay: "2026-06-01",
      lastDay: "2026-06-30",
    });
    expect(periodBounds(2026, 7).lastDay).toBe("2026-07-31");
    expect(periodBounds(2026, 2).lastDay).toBe("2026-02-28");
    expect(periodBounds(2024, 2).lastDay).toBe("2024-02-29");
  });

  it("bulan satu digit tetap dua digit", () => {
    expect(periodBounds(2026, 1).firstDay).toBe("2026-01-01");
    expect(periodBounds(2026, 12).lastDay).toBe("2026-12-31");
  });
});

describe("periodLabelId", () => {
  it("nama bulan Bahasa Indonesia", () => {
    expect(periodLabelId(2026, 6)).toBe("Juni 2026");
    expect(periodLabelId(2026, 12)).toBe("Desember 2026");
  });
});
