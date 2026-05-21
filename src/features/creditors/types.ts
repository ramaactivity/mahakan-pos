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
}

export interface UpdateCreditorInput extends Partial<CreateCreditorInput> {
  id: string;
  status?: CreditorStatus;
}

export interface PostRepaymentInput {
  creditorId: string;
  bankAccountId: string;
  /** Pokok cicilan (Rupiah). Min 0, total > 0. */
  principalAmount: number;
  /** Bunga periode (Rupiah). Default 0. */
  interestAmount?: number;
  occurredAt?: string | null;
  description?: string | null;
}

export interface ReverseRepaymentInput {
  id: string;
  reason: string;
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
  bankLabel: string;
  createdByName: string | null;
}
