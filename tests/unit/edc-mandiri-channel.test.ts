import { describe, expect, it } from "vitest";
import {
  defaultBankCodeForChannel,
  piutangCodeForChannel,
  SETTLEMENT_CHANNELS,
  SETTLEMENT_CHANNEL_LABEL,
  type AggregatorChannel,
} from "@/features/accounting/mapping/aggregatorSettlement";
import { PAYMENT_METHOD_TO_ACCOUNT } from "@/features/accounting/mapping/posSale";

/* Sesi AE-254 — POS membukukan penjualan EDC Mandiri ke 1126, tapi
 * settlement-nya dulu ikut channel "edc_other" yang membersihkan 1128. Dua
 * akun sama-sama meleset sebesar nilai yang sama, tanpa ada jurnal yang
 * timpang — di produksi terkumpul Rp 742.000 sebelum ketahuan.
 *
 * Tes ini mengunci PASANGANNYA: akun yang dipakai POS saat menjual harus
 * sama dengan akun yang dibersihkan settlement. */
describe("piutang EDC: POS vs settlement (AE-254)", () => {
  const PASANGAN: Array<[string, AggregatorChannel]> = [
    ["card_bca", "edc_bca"],
    ["card_bni", "edc_bni"],
    ["card_bri", "edc_bri"],
    ["card_mandiri", "edc_mandiri"],
    ["card_other", "edc_other"],
    ["qris", "qris"],
  ];

  for (const [method, channel] of PASANGAN) {
    it(`${method} (POS) dan ${channel} (settlement) memakai akun yang sama`, () => {
      expect(piutangCodeForChannel(channel)).toBe(
        PAYMENT_METHOD_TO_ACCOUNT[
          method as keyof typeof PAYMENT_METHOD_TO_ACCOUNT
        ],
      );
    });
  }

  it("Mandiri secara khusus memakai 1126, bukan 1128", () => {
    expect(piutangCodeForChannel("edc_mandiri")).toBe("1126");
    expect(piutangCodeForChannel("edc_other")).toBe("1128");
  });

  it("Mandiri ikut daftar channel yang bisa diatur rekening tujuannya", () => {
    expect(SETTLEMENT_CHANNELS).toContain("edc_mandiri");
    expect(SETTLEMENT_CHANNEL_LABEL.edc_mandiri).toBe("EDC Mandiri");
  });

  it("tebakan rekening Mandiri BUKAN BCA — Mahakan tak punya rekening Mandiri", () => {
    expect(defaultBankCodeForChannel("edc_mandiri")).toBe("1112");
  });
});
