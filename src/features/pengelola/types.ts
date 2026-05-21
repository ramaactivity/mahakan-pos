import type { InferSelectModel } from "drizzle-orm";
import type { pengelola } from "@/db/schema";

export type Pengelola = InferSelectModel<typeof pengelola>;
export type PengelolaStatus = "active" | "inactive" | "exited";

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

export interface PengelolaWithStats extends Pengelola {
  dividendYtd: number;
  dividendLifetime: number;
  /** %-share dalam pengelola pool (modal_disetor / total_modal_pengelola).
   *  Derived saat fetchPengelola; readonly. */
  sharePct: number;
}

export interface CreatePengelolaInput {
  fullName: string;
  nickname?: string | null;
  nik?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolderName?: string | null;
  modalDisetor: number;
  userId?: string | null;
  status?: PengelolaStatus;
  notes?: string | null;
}

export interface UpdatePengelolaInput extends Partial<CreatePengelolaInput> {
  exitReason?: string | null;
}

/* Sesi AE-80 follow-up — CSV bulk import. */
export interface BulkImportPengelolaRow {
  fullName: string;
  nickname?: string | null;
  nik?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolderName?: string | null;
  modalDisetor: number;
  dividendBalance?: number | null;
  status?: PengelolaStatus;
}

export interface BulkImportPengelolaInput {
  rows: BulkImportPengelolaRow[];
  mode?: "insert_only" | "upsert";
}

export interface BulkImportPengelolaResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; reason: string }>;
}
