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
  /* Sesi AE-80 — Override payout ratio % per distribution (v2 only).
   * Range 0..100. Kalau undefined, pakai outlet.settings.dividen.defaultPayoutRatioPct
   * atau DEFAULT_V2_CONFIG (10). V1 ignore field ini. */
  payoutRatioOverride?: number | null;
}

/* Sesi AE-63e — Laporan Perubahan Modal types. Extracted dari
 * capital-changes-report.ts karena file itu pakai "use server"
 * directive yang tidak boleh export non-async values. */
export interface CapitalChangeRow {
  holderType: "investor" | "pengelola";
  holderId: string;
  holderName: string;
  modalDisetor: number;
  saldoAwal: number;
  setoran: number;
  dividen: number;
  withdrawal: number;
  adjustment: number;
  saldoAkhir: number;
}

export interface CapitalChangesReport {
  periodStart: string;
  periodEnd: string;
  investors: CapitalChangeRow[];
  pengelola: CapitalChangeRow[];
  totals: {
    saldoAwalInvestor: number;
    saldoAwalPengelola: number;
    setoranTotal: number;
    dividenTotal: number;
    withdrawalTotal: number;
    saldoAkhirInvestor: number;
    saldoAkhirPengelola: number;
  };
}
