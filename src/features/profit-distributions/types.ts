import type { InferSelectModel } from "drizzle-orm";
import type {
  profitDistributions,
  profitDistributionLines,
} from "@/db/schema";

export type ProfitDistribution = InferSelectModel<typeof profitDistributions>;
export type ProfitDistributionLine = InferSelectModel<
  typeof profitDistributionLines
>;

export type DistributionStatus =
  | "draft"
  | "approved"
  | "posted"
  | "cancelled";

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

/** Distribution + lines + holder display metadata. */
export interface DistributionLineWithHolder extends ProfitDistributionLine {
  holderName: string;
  holderEmail: string | null;
}

export interface DistributionWithLines extends ProfitDistribution {
  lines: DistributionLineWithHolder[];
  /** Aggregated total dari lines (untuk verifikasi vs pool). */
  totalLinesAmount: number;
}

export interface ComputeDistributionInput {
  periodYear: number;
  periodMonth: number;
  /** Optional override Net Profit (kalau owner mau test angka). Kalau
   *  null/undefined, server fetch dari Income Statement. */
  netProfitOverride?: number | null;
}
