"use server";

import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, employees, outlets } from "@/db/schema";
import { logAudit } from "@/lib/audit/logger";

/**
 * Phase 4 (sesi AB) — server actions untuk mobile attendance route
 * `/absenkaryawan`. Tidak pakai NextAuth session; auth via PIN absensi
 * yang di-set Owner/Manager di tab Karyawan.
 *
 * Phase 4-B scope: verifyAttendancePin only. Clock-in/out submission
 * dengan selfie + GPS akan masuk Phase 4-C.
 */

export interface VerifiedKaryawan {
  employeeId: string;
  outletId: string;
  fullName: string;
  position: string | null;
  hasOpenRecord: boolean;
  /** Existing open record info kalau hasOpenRecord=true. */
  openRecord?: {
    id: string;
    clockInAt: string;
    isLate: "yes" | "no" | "unknown";
    lateMinutes: number | null;
  };
  outletGpsCenter: {
    lat: number;
    lng: number;
    radiusMeters: number;
  };
}

export type VerifyResult =
  | { ok: true; data: VerifiedKaryawan }
  | { ok: false; error: { code: string; message: string } };

const DEFAULT_GPS = { lat: -6.6753234, lng: 106.9298715, radiusMeters: 50 };

/**
 * Lookup karyawan by attendance PIN. Returns active employee + today's
 * open attendance record (kalau ada — buat decide flow clock-in vs
 * clock-out di mobile UI) + outlet GPS center config.
 *
 * Anti-brute-force: TODO Phase 4-D add rate-limit per IP. Untuk MVP,
 * audit log every fail attempt + slow response 500ms via setTimeout.
 */
export async function verifyAttendancePin(pin: string): Promise<VerifyResult> {
  if (!/^\d{4,6}$/.test(pin)) {
    return {
      ok: false,
      error: { code: "VALIDATION", message: "PIN harus 4-6 digit angka" },
    };
  }

  // Pull all employees with non-null attendance_pin_hash (active outlets only).
  // Bcrypt compare sequential — typical kafe punya < 50 karyawan, no perf issue.
  const candidates = await db
    .select({
      id: employees.id,
      outletId: employees.outletId,
      fullName: employees.fullName,
      position: employees.position,
      pinHash: employees.attendancePinHash,
      status: employees.status,
      deletedAt: employees.deletedAt,
    })
    .from(employees)
    .where(
      and(
        isNotNull(employees.attendancePinHash),
        isNull(employees.deletedAt),
      ),
    );

  const bcrypt = (await import("bcryptjs")).default;
  let matched: (typeof candidates)[number] | null = null;
  for (const emp of candidates) {
    if (!emp.pinHash) continue;
    const isMatch = await bcrypt.compare(pin, emp.pinHash);
    if (isMatch) {
      matched = emp;
      break;
    }
  }

  // Slow response untuk semua hasil (success + fail) — mitigate timing attack.
  await new Promise((r) => setTimeout(r, 300));

  if (!matched) {
    /* Sesi AE-62ag — audit log PIN fail untuk Owner visibility anti-brute.
     * Catatan: tidak ada session/userId di endpoint mobile (PIN-only auth);
     * pakai null userId, entityId NULL — context cuma PIN prefix masked. */
    logAudit({
      eventType: "attendance_mobile.pin_invalid",
      userId: null,
      entityType: "attendance",
      entityId: null,
      payload: {
        summary: `Mobile PIN tidak dikenali (digit count: ${pin.length})`,
      },
    }).catch((e) => console.error("[audit attendance_mobile.pin_invalid]", e));
    return {
      ok: false,
      error: {
        code: "INVALID_PIN",
        message: "PIN tidak dikenali. Hubungi Owner kalau lupa PIN.",
      },
    };
  }

  if (matched.status !== "active") {
    logAudit({
      eventType: "attendance_mobile.pin_inactive_employee",
      userId: null,
      entityType: "employee",
      entityId: matched.id,
      payload: {
        summary: `Mobile PIN cocok tapi karyawan tidak aktif: ${matched.fullName} (status=${matched.status})`,
      },
      metadata: { outletId: matched.outletId },
    }).catch((e) =>
      console.error("[audit attendance_mobile.pin_inactive_employee]", e),
    );
    return {
      ok: false,
      error: {
        code: "EMPLOYEE_NOT_ACTIVE",
        message: `Karyawan ${matched.fullName} tidak berstatus aktif`,
      },
    };
  }

  // Pull outlet config + today's open record (parallel)
  const [outletRow, openRow] = await Promise.all([
    db
      .select({ settings: outlets.settings })
      .from(outlets)
      .where(eq(outlets.id, matched.outletId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: attendanceRecords.id,
        clockInAt: attendanceRecords.clockInAt,
        isLate: attendanceRecords.isLate,
        lateMinutes: attendanceRecords.lateMinutes,
      })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.employeeId, matched.id),
          isNull(attendanceRecords.clockOutAt),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const gpsCenter =
    outletRow?.settings?.attendance?.gpsCenter ?? DEFAULT_GPS;

  return {
    ok: true,
    data: {
      employeeId: matched.id,
      outletId: matched.outletId,
      fullName: matched.fullName,
      position: matched.position,
      hasOpenRecord: openRow !== null,
      openRecord: openRow
        ? {
            id: openRow.id,
            clockInAt: openRow.clockInAt.toISOString(),
            isLate: openRow.isLate,
            lateMinutes: openRow.lateMinutes,
          }
        : undefined,
      outletGpsCenter: gpsCenter,
    },
  };
}
