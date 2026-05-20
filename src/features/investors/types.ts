import type { InferSelectModel } from "drizzle-orm";
import type { investors, capitalMovements } from "@/db/schema";

export type Investor = InferSelectModel<typeof investors>;
export type CapitalMovement = InferSelectModel<typeof capitalMovements>;

export type InvestorStatus = "active" | "inactive" | "exited";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export interface Paginated<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

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

/** Investor + derived metrics (dividen YTD, saldo akhir, dst). */
export interface InvestorWithStats extends Investor {
  /** Total dividen yang sudah di-post tahun ini (Rp). */
  dividendYtd: number;
  /** Total dividen lifetime (Rp). */
  dividendLifetime: number;
  /** Total movement count untuk holder. */
  movementCount: number;
}

export interface CreateInvestorInput {
  fullName: string;
  nickname?: string | null;
  nik?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  occupation?: string | null;
  igHandle?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolderName?: string | null;
  modalDisetor: number;
  status?: InvestorStatus;
  notes?: string | null;
}

export interface UpdateInvestorInput extends Partial<CreateInvestorInput> {
  exitReason?: string | null;
}

export interface ListInvestorsOptions {
  status?: InvestorStatus | "all";
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Bulk CSV import single-row payload. */
export interface BulkImportInvestorRow {
  fullName: string;
  nik?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  occupation?: string | null;
  igHandle?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolderName?: string | null;
  modalDisetor: number;
}

export interface BulkImportInvestorsInput {
  rows: BulkImportInvestorRow[];
  /** Sesi AE-68 — 'insert_only' (default): skip duplicates. 'upsert':
   * update existing kalau match. */
  mode?: "insert_only" | "upsert";
}

export interface BulkImportInvestorsResult {
  totalRows: number;
  inserted: number;
  /** Sesi AE-68 — di mode upsert, count berapa row di-update karena match
   * existing investor (bukan skip). */
  updated: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; reason: string }>;
}
