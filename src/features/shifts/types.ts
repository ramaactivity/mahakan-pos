import type { InferSelectModel } from "drizzle-orm";
import type { shifts } from "@/db/schema";

export type Shift = InferSelectModel<typeof shifts>;
export type ShiftStatus = "open" | "closed";

/* Sesi AE-63 phase10 — shift dengan opener name + role untuk UI cross-device
 * (owner di laptop perlu tau "shift dibuka oleh siapa"). Returned by
 * fetchActiveShiftForOutlet + getActiveShift. */
export type ShiftWithOpener = Shift & {
  openedByName: string | null;
  openedByRole: string | null;
};

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

export interface OpenShiftInput {
  openingCash: number;
}

export interface CloseShiftInput {
  shiftId: string;
  actualCash: number;
  notes: string | null;
  /** Pesan untuk shift berikutnya (Galih ask #10). */
  handoverMessage?: string | null;
  /** Kasir-reported settlement amounts for reconciliation (Galih ask #11).
   * All optional + non-negative; outlet boleh skip channel yang gak relevan.
   * Sesi AE-62n — qrisSettlement: kasir input dari HP/app QRIS untuk
   * balance verification (sebelumnya auto-fill server-side dari paidQris). */
  qrisSettlement?: number | null;
  edcSettlement?: number | null;
  gofoodSettlement?: number | null;
  grabfoodSettlement?: number | null;
  shopeefoodSettlement?: number | null;
  /** Phase 2.4 (sesi AB) — Inter-Cash setoran ke owner. Kalau > 0,
   * closeShift auto-create cash_deposit row dengan status pending_verification.
   * Owner verify nanti via Admin → Keuangan → Setoran Tunai. */
  depositAmount?: number | null;
  /** Tujuan setoran (e.g. "Owner Tunai", "BCA Owner 12345"). Free-form
   * sampai bank account master ada (Phase Q deferred). */
  depositBankDestination?: string | null;
  /** Catatan setoran — alasan kalau setor < kas drawer (e.g. "kasir bawa
   * pulang dulu, kembalian kurang"). */
  depositNotes?: string | null;
}

export interface ShiftSummary {
  transactionCount: number;
  paid: {
    count: number;
    cash: number;
    qris: number;
    cardBca: number;
  };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
  /** Sesi AE-49 — petty cash yang affect kas drawer (cash only). Audit
   * trail untuk owner: total expense vs income cash selama shift. */
  pettyExpenseCash: number;
  pettyIncomeCash: number;
  /** Phase 2.4 — set kalau kasir input setoran ke owner saat tutup shift,
   * dan cash_deposit pending sukses dibuat. UI bisa surface "menunggu
   * verifikasi" toast. */
  depositId?: string | null;
  /** Sesi AE-62h — kalau auto-deposit gagal (e.g. period overlap dengan
   * verified deposit), surface error code+message supaya kasir tahu setoran
   * BELUM tercatat. Sebelumnya silent fail → owner cek Setoran Tunai
   * tidak ada pending → cash tracking broken. */
  depositError?: { code: string; message: string } | null;
}

export interface CloseShiftResult {
  shift: Shift;
  summary: ShiftSummary;
}

/* ======================================================================
 * Sesi AE-217 — REM ANTI-LUPA-TUTUP-SHIFT
 * ==================================================================== */

/**
 * Potret gerbang shift menurut SERVER. Klien tidak boleh menghitung sendiri
 * dari jam tablet: tablet kasir sering salah jam (dan staff bisa mengubahnya),
 * sedangkan pengunciannya harus jujur.
 */
export interface ShiftDayGateState {
  /** Tingkat eskalasi hasil hitungan server. */
  level: import("./day-gate-pure").ShiftGateLevel;
  reason: import("./day-gate-pure").ShiftGateReason;
  /** 0 = shift dibuka hari ini, 1 = kemarin, dst. */
  daysStale: number;
  /** Ambang yang berlaku (sudah bersih dari nilai rusak). */
  thresholds: import("./day-gate-pure").ShiftGateThresholds;
  /** Waktu server (ISO) — dipakai klien untuk mengoreksi jam tablet. */
  serverNow: string;
  /** Tanggal WIB hari ini menurut server. */
  todayWib: string;
  /** Shift terbuka di outlet ini, kalau ada. */
  shift: {
    id: string;
    userId: string;
    openedAt: string;
    /** Tanggal WIB saat shift dibuka, "YYYY-MM-DD". */
    openedWib: string;
    openingCash: number;
    openedByName: string | null;
    /** true kalau shift ini dibuka oleh yang sedang melihat. */
    isOwnShift: boolean;
  } | null;
  /** Bill belum dibayar di shift itu — penghalang tutup yang harus dibereskan. */
  openBillCount: number;
  /** true kalau yang melihat boleh menutup paksa tanpa PIN (owner). */
  canForceCloseDirectly: boolean;
}
