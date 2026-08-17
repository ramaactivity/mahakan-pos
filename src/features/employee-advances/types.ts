import type { InferSelectModel } from "drizzle-orm";
import type {
  employeeAdvanceRepayments,
  employeeAdvances,
} from "@/db/schema";

export type EmployeeAdvance = InferSelectModel<typeof employeeAdvances>;
export type EmployeeAdvanceStatus = EmployeeAdvance["status"];

/** Sesi AE-209 — satu baris cicilan kasbon. */
export type EmployeeAdvanceRepayment = InferSelectModel<
  typeof employeeAdvanceRepayments
>;
export type EmployeeAdvanceRepaymentMethod =
  EmployeeAdvanceRepayment["method"];

export interface EmployeeAdvanceWithEmployee extends EmployeeAdvance {
  employeeName: string;
  createdByName: string | null;
  resolvedByName: string | null;
  /** Period label kalau status='deducted'. Null untuk pending/forgiven. */
  deductedFromPeriodLabel: string | null;
  /** Sesi AE-209 — sisa hutang = amount − repaidAmount. Inilah yang jadi
   * potongan gaji saat payroll di-compute. */
  remainingAmount: number;
  repaymentCount: number;
}

export interface EmployeeAdvanceRepaymentListRow
  extends EmployeeAdvanceRepayment {
  employeeName: string;
  bankLabel: string | null;
  createdByName: string | null;
  /** Nominal kasbon induknya — konteks di tabel riwayat. */
  advanceAmount: number;
  advanceIssuedDate: string;
}

export interface PostEmployeeAdvanceRepaymentInput {
  advanceId: string;
  amount: number;
  method: EmployeeAdvanceRepaymentMethod;
  bankAccountId?: string | null;
  /** YYYY-MM-DD (WIB). */
  occurredAt: string;
  description?: string | null;
  receiptImageUrl?: string | null;
}

export interface ReverseEmployeeAdvanceRepaymentInput {
  id: string;
  reason: string;
}

export interface ListEmployeeAdvanceRepaymentsOptions {
  advanceId?: string;
  employeeId?: string;
  /** Default 100. */
  limit?: number;
}

/** Sesi AE-209b — sumber uang kasbon (menentukan lawan jurnal Dr 1155). */
export type EmployeeAdvanceFundingSource =
  | "cash"
  | "bank"
  | "opening_balance";

export interface CreateEmployeeAdvanceInput {
  employeeId: string;
  amount: number;
  reason?: string | null;
  issuedDate: string; // YYYY-MM-DD
  /** Default 'cash'. 'opening_balance' = kasbon lama, tanpa jurnal. */
  fundingSource?: EmployeeAdvanceFundingSource;
  /** WAJIB kalau fundingSource='bank'. */
  bankAccountId?: string | null;
}

export interface ListEmployeeAdvancesOptions {
  employeeId?: string;
  status?: EmployeeAdvanceStatus | "all";
  /** Default 100. */
  limit?: number;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(code: string, message: string): ApiResult<never> {
  return { success: false, error: { code, message } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}
