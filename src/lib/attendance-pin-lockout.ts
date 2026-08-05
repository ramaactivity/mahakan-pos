import "server-only";

import {
  checkRateLimit,
  clearRateLimit,
  recordFailedAttempt,
} from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit/logger";

/**
 * Shared lockout untuk attendance-PIN brute force — dipakai OLEH DUA
 * entrypoint yang sama-sama auth via PIN tanpa session:
 *   1. POST /api/v1/attendance/clock-mobile (route.ts) — sesi AE-44.
 *   2. verifyAttendancePin server action (attendance-mobile/actions.ts) —
 *      sebelumnya TANPA rate limit sama sekali (TODO Phase 4-D).
 *
 * Storage mechanism = persis yang sudah dipakai route: in-memory bucket
 * di src/lib/rate-limit.ts (module-scoped Map, shared antar importer di
 * 1 container instance), key `attendance:<clientIp>`, 10 fail / 15 menit.
 * Karena key-nya sama, fail di route dan fail di action saling menghitung
 * ke bucket yang sama — attacker tidak bisa split budget antar endpoint.
 */

function attendanceRateKey(clientIp: string): string {
  return `attendance:${clientIp}`;
}

export interface AttendanceLockoutState {
  locked: boolean;
  /** Menit tunggu sampai lockout selesai (min 1). 0 kalau tidak locked. */
  waitMinutes: number;
  /** Staff-friendly message siap tampil. "" kalau tidak locked. */
  message: string;
}

/**
 * Cek lockout TANPA increment — panggil sebelum bcrypt/heavy work.
 * Kalau locked: audit log (owner visibility) + return message siap pakai.
 */
export async function checkAttendancePinLockout(
  clientIp: string,
): Promise<AttendanceLockoutState> {
  const rateState = checkRateLimit(attendanceRateKey(clientIp));
  if (!rateState.locked) {
    return { locked: false, waitMinutes: 0, message: "" };
  }
  await logAudit({
    eventType: "attendance.mobile_rejected",
    userId: null,
    entityType: "attendance",
    payload: {
      summary: `IP ${clientIp} di-lockout (terlalu banyak PIN salah)`,
      context: {
        ip: clientIp,
        until: new Date(rateState.resetAt).toISOString(),
      },
    },
    metadata: { actorRole: "system" },
  }).catch((e) => console.error("[audit rate limit]", e));
  const waitMinutes = Math.max(
    1,
    Math.ceil((rateState.resetAt - Date.now()) / 60_000),
  );
  return {
    locked: true,
    waitMinutes,
    message: `Terlalu banyak percobaan PIN salah. Tunggu ${waitMinutes} menit lagi, atau hubungi Owner kalau lupa PIN.`,
  };
}

/**
 * Record satu failed PIN attempt. Kalau attempt ini menyentuh threshold,
 * audit log lockout event. `context` optional untuk extra fields
 * (mis. mode "in"/"out" dari route).
 */
export async function recordAttendancePinFailure(
  clientIp: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const afterFail = recordFailedAttempt(attendanceRateKey(clientIp));
  if (afterFail.locked) {
    await logAudit({
      eventType: "attendance.mobile_rejected",
      userId: null,
      entityType: "attendance",
      entityId: null,
      payload: {
        summary: `IP ${clientIp} hit lockout threshold (PIN salah ${afterFail.remaining === 0 ? "10+" : ""}× berturut-turut)`,
        context: {
          ip: clientIp,
          until: new Date(afterFail.resetAt).toISOString(),
          ...context,
        },
      },
      metadata: { actorRole: "system" },
    }).catch((e) => console.error("[audit pin lockout]", e));
  }
}

/**
 * PIN benar → reset counter supaya legit user yg sempat typo tidak
 * ke-lock di session ini.
 */
export function clearAttendancePinLockout(clientIp: string): void {
  clearRateLimit(attendanceRateKey(clientIp));
}
