"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, employees } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { todayWibIso } from "@/features/cash/helpers";
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

  try {
    const [row] = await db
      .insert(attendanceRecords)
      .values({
        outletId: session.user.outletId,
        employeeId: v.employeeId,
        shiftDate: today,
        clockedInBy: session.user.id,
        notes: v.notes,
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

  const [row] = await db
    .update(attendanceRecords)
    .set({
      clockOutAt: now,
      clockedOutBy: session.user.id,
      workMinutes,
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
