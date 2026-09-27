import type { InferSelectModel } from "drizzle-orm";
import type { approvalCodes } from "@/db/schema";

export type ApprovalCode = InferSelectModel<typeof approvalCodes>;

export type ApprovalActionType =
  | "pos.transaction.void"
  | "pos.transaction.refund"
  /* Sesi AE-62o — shift rebalancing dengan owner approval. Target =
   * shift_rebalances.id, bukan transactions.id. */
  | "shift.rebalance"
  /* Sesi AE-62r — per-transaction correction (paymentMethod/total swap).
   * Target = transaction_corrections.id (kolom targetTransactionCorrectionId). */
  | "pos.transaction.correction"
  /* Sesi AE-195 — compliment (transaksi 100% gratis). Tanpa target entity:
   * kode diminta saat keranjang masih di layar, transaksi belum dibuat. */
  | "pos.compliment";

export interface RequestApprovalCodeInput {
  /** Untuk pos.transaction.* — transactionId. Untuk shift.rebalance —
   * shiftRebalanceId (di kolom targetShiftRebalanceId, bukan
   * targetTransactionId). Use shiftRebalanceId field below for clarity. */
  transactionId?: string;
  /** Sesi AE-62o — alternative target untuk shift.rebalance action. */
  shiftRebalanceId?: string;
  actionType: ApprovalActionType;
  reason: string;
  /** Sesi AE-235 — crew (employees.id) asking; the tablet login may be someone else. */
  crewId?: string | null;
  /** Sesi AE-235 — requested from the back office (logged-in user acts, no POS crew). */
  fromBackOffice?: boolean;
}

export interface RequestApprovalCodeResult {
  /** Last 2 digits of the code — UI hint only. The full code is in the
   * email; staff inputs all 6 digits. */
  codeFirstTwo: string;
  /** Wall-clock expiry (ISO). */
  expiresAt: string;
  /** Whether the email actually sent (vs dev-mode logged or failed). */
  emailMode: "sent" | "logged" | "failed";
  /** Email destination (display only — masked in UI for privacy). */
  ownerEmailMasked: string;
  /** When emailMode === "failed", the human-readable reason. UI surfaces
   * this so kasir/Owner can self-diagnose (e.g. "Invalid login = App
   * Password salah"). */
  emailError?: string;
  /** Stable error classifier code — UI can branch on this for friendly
   * Indonesian hints. */
  emailErrorCode?:
    | "AUTH_FAILED"
    | "CONNECTION_TIMEOUT"
    | "RATE_LIMITED"
    | "INVALID_RECIPIENT"
    | "UNKNOWN";
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
  return res.success;
}

/**
 * Lockout policy: after this many failed attempts on a single code, the
 * code is treated as expired (server returns LOCKED on further input).
 * Threshold is intentionally low — brute-forcing 6 digits with even 100
 * attempts is feasible without it.
 */
export const FAILED_ATTEMPTS_LOCKOUT_THRESHOLD = 5;

/** Floor TTL — minimum 1 jam supaya request menjelang tengah malam tetap
 *  punya window cukup. Lihat [[computeApprovalCodeExpiry]] untuk policy
 *  lengkap (extend sampai end-of-day WIB). */
export const DEFAULT_CODE_TTL_MS = 60 * 60 * 1000;

/**
 * Owner sering baru online di malam hari (sesi AE-? — staff feedback:
 * kode 1 jam expired sebelum owner sempat baca email). Policy:
 *   expiresAt = max(now + 1 jam floor, 23:59:59.999 WIB hari yang sama)
 *
 * - Request jam 14:00 WIB → expires 23:59 WIB hari itu (~10 jam window).
 * - Request jam 23:30 WIB → expires 00:30 WIB hari berikut (1 jam floor).
 *
 * Floor 1 jam tetap dipertahankan supaya staff tidak terpaksa re-request
 * dalam waktu sangat singkat kalau owner kebetulan online tepat lewat jam
 * 24. Lockout 5 attempt + revoke on reject/cancel masih jaga abuse.
 */
export function computeApprovalCodeExpiry(now: Date = new Date()): Date {
  const floor = new Date(now.getTime() + DEFAULT_CODE_TTL_MS);
  // End of day WIB = 23:59:59.999 pada calendar date "now" di WIB (UTC+7).
  const wibShifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const ymd = wibShifted.toISOString().slice(0, 10);
  const endOfDayWib = new Date(`${ymd}T23:59:59.999+07:00`);
  return endOfDayWib.getTime() > floor.getTime() ? endOfDayWib : floor;
}

/**
 * Generate a 6-digit numeric code with crypto-quality randomness.
 * Pure-style — calls Web Crypto API (works on Edge + Node 16+).
 */
export function generateNumericCode6(): string {
  // 6-digit space = 1,000,000. Use crypto.getRandomValues for quality.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = buf[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** Mask an email like "rama.activity98@gmail.com" → "ra…@g…il.com" so we
 * can show "Email dikirim ke ra…@g…il.com" without leaking address. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const lo = local.length;
  const localMasked =
    lo <= 2 ? local : `${local.slice(0, 2)}…${local.slice(-1)}`;
  const dotIdx = domain.lastIndexOf(".");
  if (dotIdx <= 0) return `${localMasked}@${domain}`;
  const domName = domain.slice(0, dotIdx);
  const tld = domain.slice(dotIdx);
  const dn = domName.length;
  const domMasked = dn <= 2 ? domName : `${domName.slice(0, 1)}…${domName.slice(-2)}`;
  return `${localMasked}@${domMasked}${tld}`;
}
