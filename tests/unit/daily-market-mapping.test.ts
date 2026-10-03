import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SALDO_KURIR,
  mapDailyMarketSpend,
  mapDailyMarketTopup,
  reverseDailyMarketLines,
} from "@/features/accounting/mapping/dailyMarket";

/* Sesi AE-242 — yang gampang salah di sini arah debit/kreditnya. Kalau
 * terbalik, saldo bank justru NAIK saat uang ditransfer ke kurir, dan tidak
 * ada error apa pun yang muncul. */

const sum = (lines: ReturnType<typeof mapDailyMarketTopup>) => ({
  debit: lines.reduce((s, l) => s + (l.debit ?? 0), 0),
  credit: lines.reduce((s, l) => s + (l.credit ?? 0), 0),
});

describe("mapDailyMarketTopup", () => {
  const lines = mapDailyMarketTopup({
    amount: 2_000_000,
    bankAccountCode: "1110",
    bankLabel: "BCA — Operasional",
    courierName: "Pak Dedi",
  });

  it("saldo kurir BERTAMBAH, bank BERKURANG", () => {
    const kurir = lines.find((l) => l.accountCode === ACCOUNT_SALDO_KURIR)!;
    const bank = lines.find((l) => l.accountCode === "1110")!;
    expect(kurir.debit).toBe(2_000_000);
    expect(kurir.credit ?? 0).toBe(0);
    expect(bank.credit).toBe(2_000_000);
    expect(bank.debit ?? 0).toBe(0);
  });

  it("seimbang", () => {
    const t = sum(lines);
    expect(t.debit).toBe(t.credit);
  });

  it("nol / minus ditolak, bukan diam-diam jadi jurnal kosong", () => {
    expect(() =>
      mapDailyMarketTopup({
        amount: 0,
        bankAccountCode: "1110",
        bankLabel: "BCA",
        courierName: "X",
      }),
    ).toThrow();
    expect(() =>
      mapDailyMarketTopup({
        amount: -5,
        bankAccountCode: "1110",
        bankLabel: "BCA",
        courierName: "X",
      }),
    ).toThrow();
  });
});

describe("mapDailyMarketSpend", () => {
  const lines = mapDailyMarketSpend({
    amount: 350_000,
    expenseAccountCode: "6201",
    description: "sayur + ayam",
    courierName: "Pak Dedi",
  });

  it("beban BERTAMBAH, saldo kurir BERKURANG", () => {
    const beban = lines.find((l) => l.accountCode === "6201")!;
    const kurir = lines.find((l) => l.accountCode === ACCOUNT_SALDO_KURIR)!;
    expect(beban.debit).toBe(350_000);
    expect(kurir.credit).toBe(350_000);
  });

  it("belanja TIDAK menyentuh rekening bank — uangnya sudah pindah saat top up", () => {
    expect(lines.some((l) => (l.accountCode ?? "").startsWith("111"))).toBe(false);
  });

  it("seimbang", () => {
    const t = sum(lines);
    expect(t.debit).toBe(t.credit);
  });
});

describe("reverseDailyMarketLines", () => {
  it("menukar sisi dan tetap seimbang", () => {
    const asli = mapDailyMarketTopup({
      amount: 1_000_000,
      bankAccountCode: "1110",
      bankLabel: "BCA",
      courierName: "Pak Dedi",
    });
    const balik = reverseDailyMarketLines(asli);
    const kurir = balik.find((l) => l.accountCode === ACCOUNT_SALDO_KURIR)!;
    const bank = balik.find((l) => l.accountCode === "1110")!;
    expect(kurir.credit).toBe(1_000_000);
    expect(bank.debit).toBe(1_000_000);
    const t = sum(balik);
    expect(t.debit).toBe(t.credit);
  });

  it("top up lalu dibalik = saldo kurir kembali nol", () => {
    const asli = mapDailyMarketTopup({
      amount: 750_000,
      bankAccountCode: "1110",
      bankLabel: "BCA",
      courierName: "X",
    });
    const balik = reverseDailyMarketLines(asli);
    const net = [...asli, ...balik]
      .filter((l) => l.accountCode === ACCOUNT_SALDO_KURIR)
      .reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
    expect(net).toBe(0);
  });
});

describe("akun saldo kurir masuk pola kas & bank Buku Kas", () => {
  it("1103 cocok dengan regex ^11[01][0-9]$", () => {
    expect(new RegExp("^11[01][0-9]$").test(ACCOUNT_SALDO_KURIR)).toBe(true);
  });
});

/* Sesi AE-245 — belanja pasar kini bisa berisi bahan baku. Yang gampang salah
 * di sini: rupiah bahan ikut dibebankan JUGA (selain masuk persediaan), yang
 * membuat satu nota terhitung dua kali tanpa jurnal yang tidak seimbang —
 * jadi tidak ada yang kelihatan rusak sampai laba rugi dibaca. */
describe("mapDailyMarketSpend dengan baris bahan (AE-245)", () => {
  const lines = mapDailyMarketSpend({
    amount: 500_000,
    expenseAccountCode: "6201",
    description: "Pasar Cisarua",
    courierName: "Pak Dedi",
    inventoryLines: [
      { section: "kitchen", amount: 300_000 },
      { section: "bar", amount: 150_000 },
      { section: "cleaning", amount: 20_000 },
    ],
  });

  it("bahan masuk PERSEDIAAN, bukan beban", () => {
    expect(lines.find((l) => l.accountCode === "1140")!.debit).toBe(300_000);
    expect(lines.find((l) => l.accountCode === "1141")!.debit).toBe(150_000);
    // cleaning dan supporting berbagi 1142 — harus dijumlahkan, bukan 2 baris.
    expect(lines.filter((l) => l.accountCode === "1142")).toHaveLength(1);
    expect(lines.find((l) => l.accountCode === "1142")!.debit).toBe(20_000);
  });

  it("sisanya saja yang jadi beban — bukan seluruh nota", () => {
    const beban = lines.find((l) => l.accountCode === "6201")!;
    expect(beban.debit).toBe(30_000); // 500rb − 470rb
  });

  it("saldo kurir berkurang sebesar NOTA, bukan sebesar bahannya", () => {
    const kurir = lines.find((l) => l.accountCode === ACCOUNT_SALDO_KURIR)!;
    expect(kurir.credit).toBe(500_000);
  });

  it("seimbang", () => {
    const t = sum(lines);
    expect(t.debit).toBe(t.credit);
    expect(t.debit).toBe(500_000);
  });

  it("nota yang seluruhnya bahan tidak membuat baris beban Rp 0", () => {
    const all = mapDailyMarketSpend({
      amount: 100_000,
      expenseAccountCode: "6201",
      description: "Sayur",
      courierName: "Pak Dedi",
      inventoryLines: [{ section: "kitchen", amount: 100_000 }],
    });
    expect(all.find((l) => l.accountCode === "6201")).toBeUndefined();
    expect(sum(all).debit).toBe(sum(all).credit);
  });

  it("tanpa baris bahan tetap seperti dulu: seluruh nota jadi beban", () => {
    const plain = mapDailyMarketSpend({
      amount: 75_000,
      expenseAccountCode: "6201",
      description: "Parkir + kuli angkut",
      courierName: "Pak Dedi",
    });
    expect(plain.find((l) => l.accountCode === "6201")!.debit).toBe(75_000);
    expect(plain.some((l) => l.accountCode?.startsWith("114"))).toBe(false);
  });

  it("nilai bahan melebihi nota DITOLAK, bukan bikin beban minus", () => {
    expect(() =>
      mapDailyMarketSpend({
        amount: 100_000,
        expenseAccountCode: "6201",
        description: "Salah ketik",
        courierName: "Pak Dedi",
        inventoryLines: [{ section: "kitchen", amount: 150_000 }],
      }),
    ).toThrow(/INVENTORY_EXCEEDS/);
  });

  it("pembalik mengembalikan persediaan, bukan mengkredit beban", () => {
    const rev = reverseDailyMarketLines(lines);
    expect(rev.find((l) => l.accountCode === "1140")!.credit).toBe(300_000);
    expect(rev.find((l) => l.accountCode === "1140")!.debit).toBe(0);
    expect(rev.find((l) => l.accountCode === ACCOUNT_SALDO_KURIR)!.debit).toBe(
      500_000,
    );
    const t = sum(rev);
    expect(t.debit).toBe(t.credit);
  });
});
