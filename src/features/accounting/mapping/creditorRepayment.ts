/**
 * Sesi AE-80 — Mapping helper untuk creditor repayment journal.
 *
 * Repayment cicilan ke kreditur dengan split pokok + bunga:
 *   Dr 2150 Hutang Kreditur    principalAmount  (cicilan pokok)
 *   Dr 5301 Beban Bunga Kreditur interestAmount   (skip kalau 0)
 *      Cr <bank account>       principalAmount + interestAmount  (kas keluar)
 *
 * Reversal: swap Dr/Cr.
 *   Dr <bank account>          total      (kas balik)
 *      Cr 2150 Hutang Kreditur principal  (restore liability)
 *      Cr 5301 Beban Bunga     interest   (skip kalau 0)
 *
 * Bank account code di-resolve di caller.
 */

import type { JournalLineInput } from "../posting";

const ACCOUNT_HUTANG_KREDITUR = "2150";
const ACCOUNT_BEBAN_BUNGA = "6701";
/* Sesi AE-208 — modal pengelola/investor pakai akun yang sama dengan
 * konversi investor→kreditur (investorToCreditorConversion.ts). */
const ACCOUNT_MODAL_OWNER = "3101";

/**
 * Audit AE-181 — jurnal pengakuan hutang saat kreditur dibuat/diimport.
 *
 * Mode "uang masuk sekarang" (pinjaman baru, kas masuk rekening bisnis):
 *   Dr <bank account>            principal
 *      Cr 2150 Hutang Kreditur   principal
 *
 * Mode "hutang lama" (import historis, uang sudah masuk sebelum sistem):
 *   Dr 3301 Saldo Laba Ditahan   principal   (penyesuaian saldo)
 *      Cr 2150 Hutang Kreditur   principal
 */
const ACCOUNT_SALDO_LABA = "3301";

export interface CreditorCreateMappingInput {
  /** Nominal hutang yang diakui (Rupiah) — pakai outstanding utk import. */
  principal: number;
  /** Pre-resolved bank COA code kalau uang masuk sekarang; null = historis. */
  bankAccountCode: string | null;
  creditorName: string;
}

export function mapCreditorCreate(
  input: CreditorCreateMappingInput,
): JournalLineInput[] {
  const principal = Math.floor(input.principal);
  if (principal <= 0) {
    throw new Error("MAP_CREDITOR_CREATE_NONPOSITIVE");
  }
  return [
    {
      accountCode: input.bankAccountCode ?? ACCOUNT_SALDO_LABA,
      debit: principal,
      description: input.bankAccountCode
        ? `Uang pinjaman masuk dari ${input.creditorName}`
        : `Penyesuaian saldo — hutang lama ${input.creditorName}`,
    },
    {
      accountCode: ACCOUNT_HUTANG_KREDITUR,
      credit: principal,
      description: `Pengakuan hutang ke ${input.creditorName}`,
    },
  ];
}

/**
 * Sesi AE-208 — sumber dana cicilan.
 *
 * 'company'   : kas perusahaan keluar dari rekening bank → sisi kredit =
 *               akun bank.
 * 'pengelola' : pengelola menalangi pakai uang pribadi. Kas perusahaan
 *               tidak bergerak; hutang ke kreditur berubah jadi modal
 *               pengelola → sisi kredit = 3101 Modal Owner.
 *
 * Keputusan owner (sesi AE-208): cukup dicatat langsung jadi modal
 * pengelola. Secara substansi ini sama dengan "hutang dikonversi jadi
 * saham lalu sahamnya dibeli pengelola" — jurnalnya identik (Dr 2150 /
 * Cr 3101) karena tukar pemilik saham tidak menyentuh total ekuitas.
 * Bedanya cuma record investor bayangan yang modalnya langsung 0, dan itu
 * sengaja tidak dibuat.
 */
export type RepaymentFunding =
  | {
      kind: "company";
      /** Pre-resolved bank COA code. */
      bankAccountCode: string;
      /** Display label untuk description. */
      bankDestinationLabel: string;
    }
  | {
      kind: "pengelola";
      /** Nama pengelola yang menalangi — masuk ke description jurnal. */
      pengelolaName: string;
    };

export interface CreditorRepaymentMappingInput {
  /** Pokok cicilan (Rupiah). Min 0, total > 0. */
  principalAmount: number;
  /** Bunga periode ini (Rupiah). Bisa 0. */
  interestAmount: number;
  /** Creditor name untuk audit trail. */
  creditorName: string;
  /** Sumber dana — menentukan akun sisi kredit. */
  funding: RepaymentFunding;
}

/** Sisi lawan (kredit saat bayar, debit saat reversal) + labelnya. */
function resolveCounterAccount(funding: RepaymentFunding): {
  accountCode: string;
  payLabel: string;
  reversalLabel: string;
} {
  if (funding.kind === "pengelola") {
    return {
      accountCode: ACCOUNT_MODAL_OWNER,
      payLabel: `Modal pengelola ${funding.pengelolaName} (menalangi cicilan)`,
      reversalLabel: `Reversal modal pengelola ${funding.pengelolaName}`,
    };
  }
  return {
    accountCode: funding.bankAccountCode,
    payLabel: `Transfer cicilan ke ${funding.bankDestinationLabel}`,
    reversalLabel: `Reversal cicilan dari ${funding.bankDestinationLabel}`,
  };
}

export function mapCreditorRepayment(
  input: CreditorRepaymentMappingInput,
): JournalLineInput[] {
  const principal = Math.max(0, Math.floor(input.principalAmount));
  const interest = Math.max(0, Math.floor(input.interestAmount));
  const total = principal + interest;
  if (total <= 0) {
    throw new Error("MAP_CREDITOR_REPAYMENT_ZERO_TOTAL");
  }
  const counter = resolveCounterAccount(input.funding);
  const lines: JournalLineInput[] = [];
  if (principal > 0) {
    lines.push({
      accountCode: ACCOUNT_HUTANG_KREDITUR,
      debit: principal,
      description: `Cicilan pokok ke ${input.creditorName}`,
    });
  }
  if (interest > 0) {
    lines.push({
      accountCode: ACCOUNT_BEBAN_BUNGA,
      debit: interest,
      description: `Beban bunga ${input.creditorName}`,
    });
  }
  lines.push({
    accountCode: counter.accountCode,
    credit: total,
    description: counter.payLabel,
  });
  return lines;
}

export function mapCreditorRepaymentReversal(
  input: CreditorRepaymentMappingInput & { reason: string },
): JournalLineInput[] {
  const principal = Math.max(0, Math.floor(input.principalAmount));
  const interest = Math.max(0, Math.floor(input.interestAmount));
  const total = principal + interest;
  if (total <= 0) {
    throw new Error("MAP_CREDITOR_REPAYMENT_REVERSAL_ZERO_TOTAL");
  }
  const reasonShort = input.reason.slice(0, 100);
  const counter = resolveCounterAccount(input.funding);
  const lines: JournalLineInput[] = [
    {
      accountCode: counter.accountCode,
      debit: total,
      description: `${counter.reversalLabel}: ${reasonShort}`,
    },
  ];
  if (principal > 0) {
    lines.push({
      accountCode: ACCOUNT_HUTANG_KREDITUR,
      credit: principal,
      description: `Restore hutang pokok ${input.creditorName}: ${reasonShort}`,
    });
  }
  if (interest > 0) {
    lines.push({
      accountCode: ACCOUNT_BEBAN_BUNGA,
      credit: interest,
      description: `Reversal beban bunga ${input.creditorName}: ${reasonShort}`,
    });
  }
  return lines;
}
