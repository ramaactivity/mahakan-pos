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
