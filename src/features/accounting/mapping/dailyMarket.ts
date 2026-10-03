/**
 * Sesi AE-242 — Mapping jurnal Belanja Daily Market.
 *
 * Top up (uang dikirim ke kurir, belum jadi biaya):
 *   Dr 1103 Saldo Kurir Daily Market   amount
 *      Cr <rekening bank asal>         amount
 *
 * Belanja (kurir memakai saldonya):
 *   Dr 1140/1141/1142 Persediaan       senilai baris bahan
 *   Dr <akun beban kategori>           sisanya
 *      Cr 1103 Saldo Kurir             amount
 *
 * Sesi AE-245 — rupiah yang punya baris bahan masuk PERSEDIAAN, bukan beban,
 * persis seperti Purchasing. Itulah rem anti-dobel-hitungnya: bahan yang
 * nanti dipakai akan jadi biaya lewat COGS/opname, jadi kalau di sini sudah
 * dibebankan juga, satu nota terhitung dua kali. Sisa nota yang tidak punya
 * baris bahan (parkir, plastik, kuli angkut) tetap beban langsung.
 *
 * Jadi saldo 1103 = total top up − total belanja dengan sendirinya, dan
 * saldo bank ikut berkurang tepat saat uangnya ditransfer — bukan saat
 * barangnya dibeli.
 *
 * Reversal = tukar Dr/Cr dari template yang sama.
 */

import type { JournalLineInput } from "../posting";
import {
  persediaanCodeForSection,
  type IngredientSection,
} from "./purchase";

export const ACCOUNT_SALDO_KURIR = "1103";

export interface DailyMarketTopupInput {
  amount: number;
  /** Kode COA rekening asal (hasil resolveBankCodeFromBankName). */
  bankAccountCode: string;
  bankLabel: string;
  courierName: string;
}

export function mapDailyMarketTopup(
  input: DailyMarketTopupInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) throw new Error("MAP_DAILY_MARKET_TOPUP_NONPOSITIVE");
  return [
    {
      accountCode: ACCOUNT_SALDO_KURIR,
      debit: amount,
      description: `Top up saldo belanja ${input.courierName}`,
    },
    {
      accountCode: input.bankAccountCode,
      credit: amount,
      description: `Transfer ke ${input.courierName} via ${input.bankLabel}`,
    },
  ];
}

/** Satu baris bahan, sudah diringkas ke seksi + rupiahnya. */
export interface DailyMarketInventoryLine {
  section: IngredientSection;
  amount: number;
}

export interface DailyMarketSpendInput {
  amount: number;
  /** Akun beban hasil resolusi kategori (prioritas sama dengan menu Kas). */
  expenseAccountCode: string;
  description: string;
  courierName: string;
  /** Sesi AE-245 — bagian nota yang berupa bahan baku. Kosong = nota lama. */
  inventoryLines?: DailyMarketInventoryLine[];
}

const SECTION_LABELS: Record<string, string> = {
  "1140": "Dapur",
  "1141": "Bar",
  "1142": "Pendukung",
};

export function mapDailyMarketSpend(
  input: DailyMarketSpendInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) throw new Error("MAP_DAILY_MARKET_SPEND_NONPOSITIVE");

  /* Rupiah bahan diringkas per akun persediaan dulu, baru sisanya dibebankan.
   * Dijumlahkan dalam bilangan bulat supaya tidak pernah ada sisa pecahan
   * yang membuat jurnal gagal seimbang. */
  const bySection: Record<string, number> = {};
  let inventoryTotal = 0;
  for (const l of input.inventoryLines ?? []) {
    const value = Math.floor(l.amount);
    if (value <= 0) continue;
    const code = persediaanCodeForSection(l.section);
    bySection[code] = (bySection[code] ?? 0) + value;
    inventoryTotal += value;
  }

  if (inventoryTotal > amount) {
    throw new Error(
      `MAP_DAILY_MARKET_SPEND_INVENTORY_EXCEEDS:inv=${inventoryTotal},amount=${amount}`,
    );
  }

  const lines: JournalLineInput[] = Object.entries(bySection).map(
    ([code, value]) => ({
      accountCode: code,
      debit: value,
      description: `Persediaan ${SECTION_LABELS[code] ?? "pendukung"} dari pasar — ${input.description}`,
    }),
  );

  /* Sisa nota = biaya yang memang bukan barang (parkir, plastik, kuli angkut).
   * Kalau seluruh nota sudah terurai jadi bahan, baris beban tidak dibuat
   * sama sekali — jurnal bernilai nol hanya menambah sampah di buku besar. */
  const expenseAmount = amount - inventoryTotal;
  if (expenseAmount > 0) {
    lines.push({
      accountCode: input.expenseAccountCode,
      debit: expenseAmount,
      description:
        inventoryTotal > 0
          ? `${input.description} (di luar bahan)`
          : input.description,
    });
  }

  lines.push({
    accountCode: ACCOUNT_SALDO_KURIR,
    credit: amount,
    description: `Belanja oleh ${input.courierName}: ${input.description}`,
  });

  return lines;
}

/** Pembalik: tukar sisi debit & kredit, keterangan diberi awalan. */
export function reverseDailyMarketLines(
  lines: JournalLineInput[],
): JournalLineInput[] {
  return lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.credit ?? 0,
    credit: l.debit ?? 0,
    description: `Pembalik: ${l.description ?? ""}`.trim(),
  }));
}
