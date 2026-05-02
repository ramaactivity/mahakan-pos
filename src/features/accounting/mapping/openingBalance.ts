/**
 * mapOpeningBalance — cutover entry per 31 Mei 2026 → balanced opening journal.
 *
 * Per design doc §4.17. One-time, posted by Owner via Cutover Wizard UI
 * (sesi V) atau direct DB sebelum 1 Juni 2026.
 *
 * Inputs Owner type:
 *   - Kas Tunai (drawer + brankas) → 1101 + 1102
 *   - Saldo Bank BCA/BRI/lain → 1110 / 1111 / 1112
 *   - Piutang outstanding per channel (QRIS/EDC/aggregator) → 1120-1124
 *   - Modal Owner → 3101
 *   - Saldo Laba (or 0) → 3301
 *
 * Auto-computed (caller passes):
 *   - Persediaan value per section (kitchen/bar/supporting) → 1140/1141/1142
 *   - Hutang Dagang outstanding (sum purchases pending_payment) → 2101
 *
 * Validates total Dr === Cr; throws OPENING_BALANCE_IMBALANCED kalau mismatch.
 */

import type { JournalLineInput } from "../posting";

export type OpeningBalanceInput = {
  outletId: string;
  /** Always "2026-05-31" untuk Mahakan cutover (configurable for future). */
  entryDate: string;

  // Aset Lancar (Owner inputs)
  kasDrawer: number; // 1101
  kasBrankas: number; // 1102
  bankBca: number; // 1110
  bankBri: number; // 1111
  bankLain: number; // 1112
  piutangQris: number; // 1120
  piutangEdcBca: number; // 1121
  piutangGofood: number; // 1122
  piutangGrabfood: number; // 1123
  piutangShopeefood: number; // 1124
  biayaDibayarDimuka: number; // 1150

  // Persediaan (auto-computed by caller from ingredients × cost)
  persediaanKitchen: number; // 1140
  persediaanBar: number; // 1141
  persediaanPendukung: number; // 1142

  // Kewajiban (auto-computed by caller from purchases pending_payment)
  hutangDagang: number; // 2101

  // Ekuitas (Owner inputs — must balance equation)
  modalOwner: number; // 3101
  saldoLaba: number; // 3301
};

export function mapOpeningBalance(
  input: OpeningBalanceInput,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];

  // ---------- ASET (debit) ----------
  const debitMap: Array<{ code: string; amount: number; label: string }> = [
    { code: "1101", amount: input.kasDrawer, label: "Saldo awal kas drawer" },
    { code: "1102", amount: input.kasBrankas, label: "Saldo awal kas brankas" },
    { code: "1110", amount: input.bankBca, label: "Saldo awal Bank BCA" },
    { code: "1111", amount: input.bankBri, label: "Saldo awal Bank BRI" },
    { code: "1112", amount: input.bankLain, label: "Saldo awal Bank lain" },
    { code: "1120", amount: input.piutangQris, label: "Piutang QRIS outstanding" },
    {
      code: "1121",
      amount: input.piutangEdcBca,
      label: "Piutang EDC BCA outstanding",
    },
    {
      code: "1122",
      amount: input.piutangGofood,
      label: "Piutang GoFood outstanding",
    },
    {
      code: "1123",
      amount: input.piutangGrabfood,
      label: "Piutang GrabFood outstanding",
    },
    {
      code: "1124",
      amount: input.piutangShopeefood,
      label: "Piutang ShopeeFood outstanding",
    },
    {
      code: "1140",
      amount: input.persediaanKitchen,
      label: "Persediaan bahan baku kitchen",
    },
    {
      code: "1141",
      amount: input.persediaanBar,
      label: "Persediaan bahan baku bar",
    },
    {
      code: "1142",
      amount: input.persediaanPendukung,
      label: "Persediaan bahan pendukung",
    },
    {
      code: "1150",
      amount: input.biayaDibayarDimuka,
      label: "Biaya dibayar dimuka",
    },
  ];

  for (const d of debitMap) {
    if (d.amount > 0) {
      lines.push({
        accountCode: d.code,
        debit: d.amount,
        description: d.label,
      });
    }
  }

  // ---------- KEWAJIBAN + EKUITAS (credit) ----------
  const creditMap: Array<{ code: string; amount: number; label: string }> = [
    {
      code: "2101",
      amount: input.hutangDagang,
      label: "Hutang dagang outstanding",
    },
    { code: "3101", amount: input.modalOwner, label: "Modal Owner saldo awal" },
    { code: "3301", amount: input.saldoLaba, label: "Saldo Laba ditahan" },
  ];

  for (const c of creditMap) {
    if (c.amount > 0) {
      lines.push({
        accountCode: c.code,
        credit: c.amount,
        description: c.label,
      });
    }
  }

  // Validate balance
  const totalDr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (totalDr !== totalCr) {
    throw new Error(
      `OPENING_BALANCE_IMBALANCED:debit=${totalDr},credit=${totalCr},diff=${totalDr - totalCr}`,
    );
  }
  if (lines.length < 2) {
    throw new Error("OPENING_BALANCE_TOO_FEW_LINES");
  }

  return lines;
}

/**
 * Helper untuk caller: compute total debit & credit dari draft input
 * (sebelum validate). Owner UI uses this untuk show balance check real-time.
 */
export function computeOpeningBalanceTotals(
  input: OpeningBalanceInput,
): { totalDebit: number; totalCredit: number; diff: number } {
  const totalDebit =
    input.kasDrawer +
    input.kasBrankas +
    input.bankBca +
    input.bankBri +
    input.bankLain +
    input.piutangQris +
    input.piutangEdcBca +
    input.piutangGofood +
    input.piutangGrabfood +
    input.piutangShopeefood +
    input.persediaanKitchen +
    input.persediaanBar +
    input.persediaanPendukung +
    input.biayaDibayarDimuka;
  const totalCredit = input.hutangDagang + input.modalOwner + input.saldoLaba;
  return {
    totalDebit,
    totalCredit,
    diff: totalDebit - totalCredit,
  };
}
