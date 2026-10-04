/**
 * mapAggregatorSettlement — manual settlement entry → channel-aware journal.
 *
 * 5 channels, 2 patterns:
 *
 * (A) qris / edc_bca / edc_bni / edc_bri / edc_mandiri / edc_other — POS dah create
 *     piutang (1120/1121/1125/1127/1128). Settlement =
 *     piutang clearing event. Per design doc §4.10:
 *       Dr <bank account>                  net
 *       Dr 6402 Biaya QRIS / EDC (MDR)     fee
 *          Cr 1120 / 1121 Piutang          gross
 *
 * (B) gofood / grabfood / shopeefood — POS GAK record per-order (Q1 decision).
 *     Settlement = revenue recognition + bank inflow. Per Q1:
 *       Dr <bank account>                  net
 *       Dr 6401 Biaya Aggregator           fee
 *          Cr 4104 Penjualan via Aggregator  gross
 *
 *     COGS gak di-recognize (acceptable gap, P&L footnote menjelaskan).
 *
 * Bank account resolution sama seperti cashDeposit: bankAccountId atau fallback
 * default 1110 Bank BCA (aggregator settlements masuk ke BCA per default).
 */

import type { JournalLineInput } from "../posting";

export type AggregatorChannel =
  | "edc_bca"
  | "edc_bni"
  | "edc_bri"
  | "edc_mandiri"
  | "edc_other"
  | "gofood"
  | "grabfood"
  | "shopeefood"
  | "qris";

export type AggregatorSettlementInput = {
  settlementId: string;
  outletId: string;
  /** Date bank credited (YYYY-MM-DD WIB). Pakai bank_credited_at kalau ada,
   * else use settlement.created_at fallback. */
  entryDate: string;
  channel: AggregatorChannel;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  /** Pre-resolved bank account code (default 1110 kalau bankAccountId null). */
  bankAccountCode: string;
  /** Period label "Apr 1-30, 2026" — untuk description. */
  periodLabel: string;
  referenceNo?: string | null;
};

export function isPiutangChannel(channel: AggregatorChannel): boolean {
  return piutangCodeForChannel(channel) !== null;
}

/**
 * Sesi AE-182 — rekening tujuan default per channel. Mesin EDC bank X
 * menyetor ke rekening bank X; QRIS + kartu lain jatuh ke BCA (rekening
 * utama). Dipakai kalau settlement tidak menyimpan bankAccountId eksplisit
 * DAN outlet belum mengatur pemetaannya sendiri.
 */
export function defaultBankCodeForChannel(channel: AggregatorChannel): string {
  switch (channel) {
    case "edc_bni":
      return "1113"; // Bank BNI
    case "edc_bri":
      return "1111"; // Bank BRI
    case "edc_mandiri":
      /* Sesi AE-254 — Mahakan belum punya rekening Mandiri di bagan akun;
       * uangnya mendarat di rekening lain. Tebakan ini sengaja "Bank
       * Lain-lain", bukan BCA, supaya salahnya kelihatan kalau owner belum
       * mengatur tujuan channel ini. */
      return "1112"; // Bank Lain-lain
    default:
      return "1110"; // Bank BCA
  }
}

/**
 * Sesi AE-219 — pemetaan rekening tujuan yang DIATUR OWNER, per channel.
 *
 * Tebakan bawaan di atas ("mesin EDC bank X menyetor ke rekening bank X")
 * tidak berlaku universal: QRIS Mahakan justru cair ke BNI, sementara
 * jurnalnya bertahun-tahun mendebit BCA. Salahnya tidak pernah memunculkan
 * error apa pun — cuma saldo BCA yang membengkak dan saldo BNI yang kurang,
 * dan baru ketahuan saat rekening koran dicocokkan.
 *
 * Karena itu tujuan settlement kini dapat diatur per channel dan disimpan di
 * `outlets.settings.cashless.bankAccountByChannel`. Ganti mesin EDC atau ganti
 * bank akuisisi cukup mengubah pengaturannya, tanpa deploy.
 *
 * Urutan penentuan, dari yang paling khusus:
 *   1. `bankAccountId` di baris settlement itu sendiri (kasus khusus, mis.
 *      satu pencairan yang memang masuk ke rekening lain),
 *   2. pemetaan outlet per channel (yang diatur owner),
 *   3. tebakan bawaan per channel.
 */
export type SettlementBankMapping = Partial<
  Record<AggregatorChannel, string | undefined>
>;

export function resolveSettlementBankCode(
  channel: AggregatorChannel,
  mapping?: SettlementBankMapping | null,
  explicitCode?: string | null,
): string {
  if (explicitCode) return explicitCode;
  const mapped = mapping?.[channel];
  if (mapped && mapped.trim().length > 0) return mapped.trim();
  return defaultBankCodeForChannel(channel);
}

/** Semua channel yang bisa diatur rekening tujuannya (urutan tampilan). */
export const SETTLEMENT_CHANNELS: AggregatorChannel[] = [
  "qris",
  "edc_bca",
  "edc_bni",
  "edc_bri",
  "edc_mandiri",
  "edc_other",
  "gofood",
  "grabfood",
  "shopeefood",
];

export const SETTLEMENT_CHANNEL_LABEL: Record<AggregatorChannel, string> = {
  qris: "QRIS",
  edc_bca: "EDC BCA",
  edc_bni: "EDC BNI",
  edc_bri: "EDC BRI",
  edc_mandiri: "EDC Mandiri",
  edc_other: "EDC Lainnya",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
};

/**
 * Map channel ke piutang account code.
 *
 * Note: gofood/grabfood/shopeefood TIDAK punya piutang account active —
 * mereka langsung Cr revenue 4104 di settlement entry.
 */
export function piutangCodeForChannel(
  channel: AggregatorChannel,
): string | null {
  switch (channel) {
    case "qris":
      return "1120";
    case "edc_bca":
      return "1121";
    case "edc_bni":
      return "1125";
    case "edc_bri":
      return "1127";
    case "edc_mandiri":
      return "1126";
    case "edc_other":
      return "1128";
    default:
      return null;
  }
}

export function mapAggregatorSettlement(
  input: AggregatorSettlementInput,
): JournalLineInput[] {
  if (input.grossAmount <= 0) {
    throw new Error("MAP_AGG_SETTLE_NONPOSITIVE");
  }
  if (input.feeAmount < 0 || input.feeAmount > input.grossAmount) {
    throw new Error("MAP_AGG_SETTLE_FEE_BOUNDS");
  }
  if (input.netAmount !== input.grossAmount - input.feeAmount) {
    throw new Error(
      `MAP_AGG_SETTLE_NET_MISMATCH:gross=${input.grossAmount},fee=${input.feeAmount},net=${input.netAmount}`,
    );
  }

  const lines: JournalLineInput[] = [];

  // Dr Bank net
  lines.push({
    accountCode: input.bankAccountCode,
    debit: input.netAmount,
    description: `Settlement ${input.channel} ${input.periodLabel}${input.referenceNo ? ` (${input.referenceNo})` : ""}`,
  });

  // Dr Fee (kalau > 0)
  if (input.feeAmount > 0) {
    if (isPiutangChannel(input.channel)) {
      // QRIS/EDC fee = MDR
      lines.push({
        accountCode: "6402",
        debit: input.feeAmount,
        description: `Biaya MDR ${input.channel}`,
      });
    } else {
      // GoFood/Grab/Shopee fee = aggregator commission
      lines.push({
        accountCode: "6401",
        debit: input.feeAmount,
        description: `Biaya aggregator ${input.channel}`,
      });
    }
  }

  // Cr side: piutang clearing OR revenue recognition
  if (isPiutangChannel(input.channel)) {
    const piutangCode = piutangCodeForChannel(input.channel)!;
    lines.push({
      accountCode: piutangCode,
      credit: input.grossAmount,
      description: `Clear piutang ${input.channel}`,
    });
  } else {
    lines.push({
      accountCode: "4104",
      credit: input.grossAmount,
      description: `Penjualan via ${input.channel}`,
    });
  }

  return lines;
}
