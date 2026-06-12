import type { InferSelectModel } from "drizzle-orm";
import type {
  internalDebtParties,
  internalDebtEntries,
  internalDebtRepayments,
} from "@/db/schema";

/**
 * Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola) types.
 */

export type InternalDebtParty = InferSelectModel<typeof internalDebtParties>;
export type InternalDebtEntry = InferSelectModel<typeof internalDebtEntries>;
export type InternalDebtRepayment = InferSelectModel<
  typeof internalDebtRepayments
>;

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

export type InternalDebtPartyType = "owner" | "manager" | "staff" | "other";
export type InternalDebtEntryKind = "expense_advance" | "cash_loan";

export const PARTY_TYPE_LABELS: Record<InternalDebtPartyType, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  other: "Lainnya",
};

export interface CreateInternalDebtPartyInput {
  name: string;
  partyType?: InternalDebtPartyType;
  phone?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolderName?: string | null;
  notes?: string | null;
}

export interface UpdateInternalDebtPartyInput
  extends Partial<CreateInternalDebtPartyInput> {
  id: string;
}

export interface PostInternalDebtEntryInput {
  partyId: string;
  kind: InternalDebtEntryKind;
  /** Nominal hutang baru (Rupiah). */
  amount: number;
  /** ISO date YYYY-MM-DD. Default hari ini. */
  occurredAt?: string | null;
  description: string;
  /** WAJIB untuk kind='expense_advance' — kategori pengeluaran. */
  categoryId?: string | null;
  /** WAJIB untuk kind='cash_loan' — rekening bisnis penerima. */
  bankAccountId?: string | null;
}

export interface PostInternalDebtRepaymentInput {
  partyId: string;
  bankAccountId: string;
  /** Nominal cicilan (Rupiah). */
  amount: number;
  occurredAt?: string | null;
  description?: string | null;
}

export interface ReverseInternalDebtInput {
  id: string;
  reason: string;
}

export interface InternalDebtPartyListRow extends InternalDebtParty {
  /** Total hutang lifetime (entries posted). */
  totalDebt: number;
  /** Total cicilan lifetime (repayments posted). */
  totalRepaid: number;
  entryCount: number;
  repaymentCount: number;
}

export interface InternalDebtEntryListRow extends InternalDebtEntry {
  partyName: string;
  categoryName: string | null;
  bankLabel: string | null;
  createdByName: string | null;
}

export interface InternalDebtRepaymentListRow extends InternalDebtRepayment {
  partyName: string;
  bankLabel: string;
  createdByName: string | null;
}
