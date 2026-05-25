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
  | "pos.transaction.correction";

export interface RequestApprovalCodeInput {
  /** Untuk pos.transaction.* — transactionId. Untuk shift.rebalance —
   * shiftRebalanceId (di kolom targetShiftRebalanceId, bukan
   * targetTransactionId). Use shiftRebalanceId field below for clarity. */
  transactionId?: string;
  /** Sesi AE-62o — alternative target untuk shift.rebalance action. */
  shiftRebalanceId?: string;
  actionType: ApprovalActionType;
  reason: string;
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

/** Default code TTL — 1 jam (sesi AE-150 owner feedback: 10 menit terlalu
 *  sebentar untuk owner yang lagi WA dengan customer/meeting). 1 jam masih
 *  cukup ketat untuk security (bukan code yang menggantung berhari-hari)
 *  + bracket lockout 5 attempt + revoke saat reject/cancel masih jaga. */
export const DEFAULT_CODE_TTL_MS = 60 * 60 * 1000;

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
