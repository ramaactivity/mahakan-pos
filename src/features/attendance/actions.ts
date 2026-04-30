"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, employees, outlets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { todayWibIso } from "@/features/cash/helpers";
import { fetchScheduleByEmployeeAndDate } from "@/features/schedules/queries";

/** Default minutes of grace before late detection trips. Per-outlet
 * override at outlet.settings.attendance.lateGraceMinutes (Sesi D). */
const DEFAULT_LATE_GRACE_MINUTES = 5;

async function resolveLateGraceMinutes(outletId: string): Promise<number> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const configured = row?.settings?.attendance?.lateGraceMinutes;
  if (typeof configured === "number" && configured >= 0 && configured <= 60) {
    return configured;
  }
  return DEFAULT_LATE_GRACE_MINUTES;
}

/** Convert a Date timestamp + WIB date string into "minutes past
 * 00:00 in WIB". Used to compare clock event vs schedule HH:MM:SS. */
function minutesIntoWibDay(at: Date): number {
  // WIB is UTC+7, no DST.
  const wibHours = (at.getUTCHours() + 7) % 24;
  const wibMinutes = at.getUTCMinutes();
  return wibHours * 60 + wibMinutes;
}

function timeStringToMinutes(hms: string): number {
  const [h, m] = hms.split(":").map((s) => parseInt(s, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}
import {
  fetchAttendance,
  fetchOpenAttendance,
  fetchTodayStatus,
  type ListAttendanceOptions,
} from "./queries";
import {
  clockInSchema,
  clockOutSchema,
  listAttendanceSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type AttendanceRecord,
  type AttendanceRecordWithEmployee,
  type ClockInInput,
  type ClockOutInput,
  type EmployeeAttendanceTodayStatus,
  type Paginated,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listAttendance(
  opts: Omit<ListAttendanceOptions, "outletId"> = {},
): Promise<ApiResult<Paginated<AttendanceRecordWithEmployee>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat absensi");
  }
  const parsed = listAttendanceSchema.safeParse(opts);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Filter tidak valid",
    );
  }
  return ok(
    await fetchAttendance({
      ...parsed.data,
      outletId: session.user.outletId,
    }),
  );
}

export async function getTodayAttendanceStatus(): Promise<
  ApiResult<EmployeeAttendanceTodayStatus[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat absensi");
  }
  const today = todayWibIso();
  return ok(await fetchTodayStatus(session.user.outletId, today));
}

// ---------- Mutations ----------

export async function clockIn(
  input: ClockInInput,
): Promise<ApiResult<AttendanceRecord>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.record")) {
    return fail("FORBIDDEN", "Tidak punya hak catat absensi");
  }

  const parsed = clockInSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, v.employeeId))
    .limit(1);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }
  if (emp.deletedAt !== null) {
    return fail("EMPLOYEE_DELETED", "Karyawan sudah dihapus");
  }
  if (emp.status !== "active") {
    return fail("EMPLOYEE_NOT_ACTIVE", "Karyawan tidak berstatus aktif");
  }

  const today = todayWibIso();

  // Pre-check open record (the partial-unique index is the hard guard;
  // this check yields a nicer error than a 23505).
  const existing = await fetchOpenAttendance(
    session.user.outletId,
    v.employeeId,
    today,
  );
  if (existing) {
    return fail(
      "ALREADY_CLOCKED_IN",
      "Karyawan ini sudah clock-in tapi belum clock-out",
    );
  }

  // Schedule lookup for late detection (C-8). Day-off + missing
  // schedule both fall back to is_late=unknown so reports can ignore
  // these days for late tracking.
  const schedule = await fetchScheduleByEmployeeAndDate(v.employeeId, today);
  let isLate: "yes" | "no" | "unknown" = "unknown";
  let lateMinutes: number | null = null;
  const now = new Date();
  if (schedule && !schedule.dayOff && schedule.startTime) {
    const grace = await resolveLateGraceMinutes(session.user.outletId);
    const scheduledStart = timeStringToMinutes(schedule.startTime);
    const actualStart = minutesIntoWibDay(now);
    const diff = actualStart - scheduledStart;
    if (diff > grace) {
      isLate = "yes";
      lateMinutes = diff;
    } else {
      isLate = "no";
      lateMinutes = 0;
    }
  }

  try {
    const [row] = await db
      .insert(attendanceRecords)
      .values({
        outletId: session.user.outletId,
        employeeId: v.employeeId,
        shiftDate: today,
        clockInAt: now,
        clockedInBy: session.user.id,
        notes: v.notes,
        isLate,
        lateMinutes,
      })
      .returning();

    logAudit({
      eventType: "attendance.clock_in",
      userId: session.user.id,
      entityType: "attendance",
      entityId: row.id,
      payload: {
        summary: `Clock-in: ${emp.fullName}`,
        context: {
          employeeId: emp.id,
          employeeFullName: emp.fullName,
          shiftDate: today,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit attendance.clock_in]", e));

    return ok(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (/ux_attendance_open_per_employee_date|unique/i.test(msg)) {
      return fail(
        "ALREADY_CLOCKED_IN",
        "Karyawan ini sudah clock-in tapi belum clock-out",
      );
    }
    return fail("DB_ERROR", msg);
  }
}

export async function clockOut(
  input: ClockOutInput,
): Promise<ApiResult<AttendanceRecord>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.record")) {
    return fail("FORBIDDEN", "Tidak punya hak catat absensi");
  }

  const parsed = clockOutSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [current] = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.id, v.recordId))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Record tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Record dari outlet lain");
  }
  if (current.clockOutAt !== null) {
    return fail("ALREADY_CLOSED", "Record sudah ditutup");
  }

  const now = new Date();
  const workMinutes = Math.max(
    0,
    Math.floor((now.getTime() - current.clockInAt.getTime()) / 60_000),
  );

  // Overtime detection: lookup schedule for the shift_date; if found
  // + non-day-off + has end_time, compute minutes past scheduled end.
  // Handles overnight shifts where end_time < start_time.
  let overtimeMinutes: number | null = null;
  const schedule = await fetchScheduleByEmployeeAndDate(
    current.employeeId,
    current.shiftDate,
  );
  if (schedule && !schedule.dayOff && schedule.endTime && schedule.startTime) {
    const scheduledEnd = timeStringToMinutes(schedule.endTime);
    const scheduledStart = timeStringToMinutes(schedule.startTime);
    const isOvernight = scheduledEnd < scheduledStart;
    const actualEnd = minutesIntoWibDay(now);
    let diff: number;
    if (isOvernight) {
      // Overnight: scheduledEnd is "tomorrow morning" in real time.
      // If actualEnd already past midnight (< scheduledStart), compare
      // directly; if still pre-midnight (>= scheduledStart), add 1440.
      const adjustedActual =
        actualEnd >= scheduledStart ? actualEnd : actualEnd + 1440;
      diff = adjustedActual - (scheduledEnd + 1440);
    } else {
      diff = actualEnd - scheduledEnd;
    }
    overtimeMinutes = Math.max(0, diff);
  }

  const [row] = await db
    .update(attendanceRecords)
    .set({
      clockOutAt: now,
      clockedOutBy: session.user.id,
      workMinutes,
      overtimeMinutes,
      notes:
        v.notes !== null
          ? [current.notes, v.notes].filter(Boolean).join(" | ")
          : current.notes,
      updatedAt: now,
    })
    .where(eq(attendanceRecords.id, v.recordId))
    .returning();

  logAudit({
    eventType: "attendance.clock_out",
    userId: session.user.id,
    entityType: "attendance",
    entityId: row.id,
    payload: {
      summary: `Clock-out: ${row.employeeId} (${workMinutes}m)`,
      context: {
        employeeId: row.employeeId,
        shiftDate: row.shiftDate,
        workMinutes,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit attendance.clock_out]", e));

  return ok(row);
}
