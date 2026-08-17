/**
 * Sesi AE-209b — Mapping Kasbon Karyawan sebagai PIUTANG (akun 1155).
 *
 * Sebelum ini kasbon sama sekali di luar pembukuan: uang keluar tidak
 * dijurnal, dan potongan gajinya nyangkut di 6105 Potongan Karyawan
 * (kontra-beban) tanpa pasangan debit. Akibatnya kas GL ketinggian sebesar
 * kasbon yang belum lunas dan beban gaji kekecilan. Owner minta dirapikan
 * (sesi AE-209): kasbon jadi piutang, jadi Neraca menunjukkan "uang
 * perusahaan yang sedang dipegang karyawan".
 *
 * Siklus lengkapnya:
 *
 *   1. Kasbon diberikan       Dr 1155 Piutang Kasbon / Cr 1101 Kas atau <bank>
 *   2a. Karyawan nyicil       Dr 1101 Kas atau <bank> / Cr 1155
 *   2b. Dipotong dari gaji    (di mapPayrollPaid)      Cr 1155 sebesar sisa
 *   2c. Di-forgive owner      Dr 6102 Tunjangan & Bonus / Cr 1155
 *
 * Debit 1155 di langkah 1 lah yang "membayar" semua credit di langkah 2 —
 * total 1155 balik ke nol begitu kasbonnya selesai, apa pun jalan
 * penyelesaiannya.
 *
 * ATURAN PENTING (jangan diregresi): kasbon yang TIDAK punya jurnal
 * pembukaan (`employee_advances.journal_entry_id IS NULL` — baris lama
 * pra-AE-209 dan kasbon bertanda "saldo awal") tidak boleh menghasilkan
 * credit 1155 di jalur mana pun. Credit tanpa debit pasangannya bikin
 * saldo piutang MINUS tanpa error apa pun. Untuk baris seperti itu,
 * potongan gajinya tetap ke 6105 seperti perilaku lama.
 */

import type { JournalLineInput } from "../posting";

export const ACCOUNT_PIUTANG_KASBON = "1155";
/** Kasbon yang dimaafkan owner = tunjangan buat karyawan, bukan gaji pokok. */
export const ACCOUNT_BEBAN_KASBON_FORGIVE = "6102";

export interface EmployeeAdvanceIssueMappingInput {
  /** Nominal kasbon (Rupiah). */
  amount: number;
  /** Akun sumber uang: '1101' Kas, atau kode COA bank hasil resolve. */
  sourceAccountCode: string;
  /** Label sumber untuk deskripsi baris ("Kas", "BCA — ...056"). */
  sourceLabel: string;
  employeeName: string;
}

export function mapEmployeeAdvanceIssue(
  input: EmployeeAdvanceIssueMappingInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) throw new Error("MAP_EMP_ADVANCE_ISSUE_NONPOSITIVE");
  return [
    {
      accountCode: ACCOUNT_PIUTANG_KASBON,
      debit: amount,
      description: `Kasbon ${input.employeeName}`,
    },
    {
      accountCode: input.sourceAccountCode,
      credit: amount,
      description: `Kasbon ${input.employeeName} dibayar dari ${input.sourceLabel}`,
    },
  ];
}

export interface EmployeeAdvanceRepaymentMappingInput {
  /** Nominal cicilan (Rupiah). */
  amount: number;
  /** Akun kas/bank penerima setoran. */
  destinationAccountCode: string;
  destinationLabel: string;
  employeeName: string;
}

export function mapEmployeeAdvanceRepayment(
  input: EmployeeAdvanceRepaymentMappingInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) throw new Error("MAP_EMP_ADVANCE_REPAY_NONPOSITIVE");
  return [
    {
      accountCode: input.destinationAccountCode,
      debit: amount,
      description: `Cicilan kasbon ${input.employeeName} masuk ${input.destinationLabel}`,
    },
    {
      accountCode: ACCOUNT_PIUTANG_KASBON,
      credit: amount,
      description: `Piutang kasbon ${input.employeeName} berkurang`,
    },
  ];
}

/** Pembalik cicilan (salah input / uangnya ternyata tidak masuk). */
export function mapEmployeeAdvanceRepaymentReversal(
  input: EmployeeAdvanceRepaymentMappingInput & { reason: string },
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) {
    throw new Error("MAP_EMP_ADVANCE_REPAY_REVERSAL_NONPOSITIVE");
  }
  const reasonShort = input.reason.slice(0, 100);
  return [
    {
      accountCode: ACCOUNT_PIUTANG_KASBON,
      debit: amount,
      description: `Batal cicilan kasbon ${input.employeeName}: ${reasonShort}`,
    },
    {
      accountCode: input.destinationAccountCode,
      credit: amount,
      description: `Batal setoran ke ${input.destinationLabel}: ${reasonShort}`,
    },
  ];
}

export interface EmployeeAdvanceForgiveMappingInput {
  /** SISA kasbon yang dimaafkan (nominal − cicilan yang sudah masuk). */
  amount: number;
  employeeName: string;
}

export function mapEmployeeAdvanceForgive(
  input: EmployeeAdvanceForgiveMappingInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) throw new Error("MAP_EMP_ADVANCE_FORGIVE_NONPOSITIVE");
  return [
    {
      accountCode: ACCOUNT_BEBAN_KASBON_FORGIVE,
      debit: amount,
      description: `Kasbon ${input.employeeName} dimaafkan (jadi tunjangan)`,
    },
    {
      accountCode: ACCOUNT_PIUTANG_KASBON,
      credit: amount,
      description: `Piutang kasbon ${input.employeeName} dihapus`,
    },
  ];
}
