import type { InferSelectModel } from "drizzle-orm";
import type { employeeAdvances } from "@/db/schema";

export type EmployeeAdvance = InferSelectModel<typeof employeeAdvances>;
export type EmployeeAdvanceStatus = EmployeeAdvance["status"];

export interface EmployeeAdvanceWithEmployee extends EmployeeAdvance {
  employeeName: string;
  createdByName: string | null;
  resolvedByName: string | null;
  /** Period label kalau status='deducted'. Null untuk pending/forgiven. */
  deductedFromPeriodLabel: string | null;
}

export interface CreateEmployeeAdvanceInput {
  employeeId: string;
  amount: number;
  reason?: string | null;
  issuedDate: string; // YYYY-MM-DD
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
