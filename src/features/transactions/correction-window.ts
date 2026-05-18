/**
 * Sesi AE-62r — pure helper untuk validate "transaksi ini bisa dikoreksi
 * dari Riwayat POS atau tidak".
 *
 * Window rules (sinkron dengan Phase 3 rebalance window — feedback_deploy_authorization
 * & user decision di plan dynamic-sparking-swing):
 *  - Eligible kalau transaksi berasal dari shift yang masih OPEN (kasir
 *    aktif sekarang) → source='kasir_active_shift'
 *  - Eligible kalau shift sudah CLOSED tapi closedAt < 24 jam lalu → source='kasir_post_close'
 *  - Selain itu → reject (harus pakai shift-level rebalance Phase 2/3
 *    atau owner manual entry).
 *
 * Pure: no DB call, deterministic. Caller harus inject `now` (untuk testability)
 * dan shift row (dengan field status + closedAt + outletId).
 */

export type CorrectionWindowSource =
  | "kasir_active_shift"
  | "kasir_post_close"
  | "manager_backoffice";

export interface CorrectionWindowInput {
  /** Transaksi yang mau dikoreksi. */
  trx: {
    shiftId: string;
    outletId: string;
  };
  /** Shift row yang me-record transaksi (bisa current active OR closed). */
  shift: {
    id: string;
    status: "open" | "closed";
    closedAt: Date | null;
    outletId: string;
  };
  /** Wall-clock saat eval (server now). Wajib pass eksplisit supaya unit-testable. */
  now: Date;
}

export interface CorrectionWindowResult {
  eligible: boolean;
  source: CorrectionWindowSource | null;
  /** Stable error code untuk surfacing ke UI. */
  reason: string | null;
}

/** Window: transaksi dari shift closed lebih dari ini → tolak. */
export const CORRECTION_POST_CLOSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function getCorrectableTransactionWindow(
  input: CorrectionWindowInput,
): CorrectionWindowResult {
  if (input.trx.shiftId !== input.shift.id) {
    return {
      eligible: false,
      source: null,
      reason: "SHIFT_MISMATCH",
    };
  }
  if (input.trx.outletId !== input.shift.outletId) {
    return {
      eligible: false,
      source: null,
      reason: "OUTLET_MISMATCH",
    };
  }
  if (input.shift.status === "open") {
    return {
      eligible: true,
      source: "kasir_active_shift",
      reason: null,
    };
  }
  // status === 'closed'
  if (!input.shift.closedAt) {
    return {
      eligible: false,
      source: null,
      reason: "CLOSED_WITHOUT_TIMESTAMP",
    };
  }
  const ageMs = input.now.getTime() - input.shift.closedAt.getTime();
  if (ageMs < 0) {
    // closedAt di masa depan — clock drift atau bug. Defensive reject.
    return {
      eligible: false,
      source: null,
      reason: "CLOSED_AT_FUTURE",
    };
  }
  if (ageMs > CORRECTION_POST_CLOSE_WINDOW_MS) {
    return {
      eligible: false,
      source: null,
      reason: "WINDOW_EXPIRED",
    };
  }
  return {
    eligible: true,
    source: "kasir_post_close",
    reason: null,
  };
}
