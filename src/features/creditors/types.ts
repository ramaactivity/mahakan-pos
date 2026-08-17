import type { InferSelectModel } from "drizzle-orm";
import type { creditors, creditorRepayments } from "@/db/schema";

/**
 * Sesi AE-80 — Creditors types.
 */

export type Creditor = InferSelectModel<typeof creditors>;
export type CreditorRepayment = InferSelectModel<typeof creditorRepayments>;

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export type CreditorStatus = "active" | "settled" | "defaulted";
export type InterestPeriod = "monthly" | "yearly" | "flat";

export interface CreateCreditorInput {
  fullName: string;
  nickname?: string | null;
  nik?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolderName?: string | null;
  /** Pokok awal pinjaman (Rupiah). Required. */
  principalOriginal: number;
  /** Bunga rate % per period. Default 0. */
  interestRatePct?: number;
  interestPeriod?: InterestPeriod;
  /** ISO date YYYY-MM-DD. */
  startDate: string;
  dueDate?: string | null;
  notes?: string | null;
  /** Sesi AE-80 follow-up — link ke investor existing (tanpa convert).
   * Untuk kasus kreditur adalah orang yang sama dengan investor (mis.
   * investor inactive yang minjamin uang baru terpisah). */
  linkedInvestorId?: string | null;
  /** Audit AE-181 — rekening bisnis penerima uang pinjaman. Diisi = Dr
   * bank / Cr 2150 (uang masuk sekarang); kosong = hutang lama → Dr 3301
   * penyesuaian saldo / Cr 2150. */
  receivedBankAccountId?: string | null;
}

export interface UpdateCreditorInput extends Partial<CreateCreditorInput> {
  id: string;
  status?: CreditorStatus;
}

/** Sesi AE-208 — sumber dana cicilan kreditur. */
export type RepaymentFundingSource = "company" | "pengelola";

export interface PostRepaymentInput {
  creditorId: string;
  /** Wajib kalau fundingSource='company' (default). */
  bankAccountId?: string | null;
  /** Sesi AE-208 — 'company' = kas Mahakan, 'pengelola' = uang pribadi
   *  pengelola yang menalangi (modalnya naik sebesar total cicilan). */
  fundingSource?: RepaymentFundingSource;
  /** Wajib kalau fundingSource='pengelola'. */
  paidByPengelolaId?: string | null;
  /** Pokok cicilan (Rupiah). Min 0, total > 0. */
  principalAmount: number;
  /** Bunga periode (Rupiah). Default 0. */
  interestAmount?: number;
  occurredAt?: string | null;
  description?: string | null;
  /** Sesi AE-208 — bukti transfer (URL Google Drive). */
  receiptImageUrl?: string | null;
}

export interface ReverseRepaymentInput {
  id: string;
  reason: string;
}

/* Sesi AE-80 follow-up — CSV bulk import. */
export interface BulkImportCreditorRow {
  fullName: string;
  nickname?: string | null;
  nik?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolderName?: string | null;
  /** Pokok awal pinjaman (Rp). */
  principalOriginal: number;
  /** Sisa pokok berjalan. Default = principalOriginal kalau kosong. */
  principalOutstanding?: number | null;
  interestRatePct?: number;
  interestPeriod?: InterestPeriod;
  startDate: string;
  dueDate?: string | null;
  status?: CreditorStatus;
  notes?: string | null;
}

export interface BulkImportCreditorsInput {
  rows: BulkImportCreditorRow[];
  mode?: "insert_only" | "upsert";
}

export interface BulkImportCreditorsResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; reason: string }>;
}

/* Sesi AE-80 follow-up — convert investor → kreditur input. */
export interface ConvertInvestorToCreditorInput {
  investorId: string;
  /** Override pokok opsional (default = investor.modalDisetor). */
  principalOverride?: number;
  interestRatePct?: number;
  interestPeriod?: InterestPeriod;
  /** ISO date YYYY-MM-DD. */
  startDate: string;
  dueDate?: string | null;
  notes?: string | null;
  exitReason: string;
}

export interface CreditorListRow extends Creditor {
  /** Total cicilan pokok lifetime. */
  totalPaidPrincipal: number;
  /** Total bunga dibayar lifetime. */
  totalPaidInterest: number;
  /** Jumlah cicilan posted. */
  repaymentCount: number;
}

export interface CreditorRepaymentListRow extends CreditorRepayment {
  creditorName: string;
  /** Label rekening sumber. Kosong kalau cicilan ditalangi pengelola. */
  bankLabel: string;
  /** Sesi AE-208 — nama pengelola yang menalangi (null kalau uang perusahaan). */
  paidByPengelolaName: string | null;
  createdByName: string | null;
}
