import type { InferSelectModel } from "drizzle-orm";
import type { payrollLines, payrollPeriods } from "@/db/schema";

export type PayrollPeriod = InferSelectModel<typeof payrollPeriods>;
export type PayrollLine = InferSelectModel<typeof payrollLines>;
export type PayrollStatus = "draft" | "finalized" | "paid";

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

export interface PayrollLineWithEmployee extends PayrollLine {
  employeeFullName: string;
  employeeNickname: string | null;
  employeePosition: string | null;
}

export interface PayrollPeriodWithStats extends PayrollPeriod {
  lineCount: number;
  netPayTotal: number;
}

export interface CreatePayrollPeriodInput {
  label: string;
  periodStart: string;
  periodEnd: string;
  notes?: string | null;
}

export interface UpdatePayrollLineInput {
  id: string;
  baseSalary?: number;
  overtimePay?: number;
  lateDeduction?: number;
  bonus?: number;
  otherDeductions?: number;
  notes?: string | null;
}
