"use server";

import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecords,
  employeeSchedules,
  employees,
  outlets,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
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
  bulkBackfillAttendanceSchema,
  clockInSchema,
  clockOutSchema,
  createManualAttendanceSchema,
  deleteManualAttendanceSchema,
  editAttendanceManualSchema,
  listAttendanceSchema,
  type BulkBackfillAttendanceInput,
  type CreateManualAttendanceInput,
  type DeleteManualAttendanceInput,
  type EditAttendanceManualInput,
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
    return fail("DB_ERROR", logAndSanitize(e, "attendance", "Operasi database gagal"));
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
  //
  // Sesi AE-62aa — pakai pure helper computeOvertimeMinutes yang aware
  // cross-midnight clock-out (Date-arithmetic based). Pre-fix logic
  // (minutesIntoWibDay-based) MISS case schedule normal-day + clock-out
  // past midnight → overtime undercount. Helper unit-tested 10 cases.
  let overtimeMinutes: number | null = null;
  const schedule = await fetchScheduleByEmployeeAndDate(
    current.employeeId,
    current.shiftDate,
  );
  if (schedule && !schedule.dayOff && schedule.endTime && schedule.startTime) {
    const { computeOvertimeMinutes } = await import("./overtime-compute");
    const otResult = computeOvertimeMinutes({
      shiftDate: current.shiftDate,
      scheduledStartTime: schedule.startTime,
      scheduledEndTime: schedule.endTime,
      clockOutAt: now,
    });
    overtimeMinutes = otResult.overtimeMinutes;
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

/**
 * Sesi AE-63 phase8 — HR Bayu request: manual edit attendance status +
 * late/overtime minutes per record. Use case: karyawan konfirmasi izin,
 * sakit, mendadak kerja shift overlap, force majeure → HR adjust isLate
 * + lateMinutes supaya payroll calc benar.
 *
 * Guards:
 *  - RBAC attendance.manual_edit (owner + manager)
 *  - outletId scope (defense-in-depth)
 *  - Record must exist + same outlet
 *  - reason wajib min 3 char (audit trail)
 *
 * Behavior:
 *  - Force-set isLate, lateMinutes, overtimeMinutes ke nilai input
 *  - Stamp manualEditAt, manualEditBy, manualEditReason
 *  - Subsequent schedule recompute belum aware manual-edit (future enhancement)
 */
export async function editAttendanceManual(
  input: EditAttendanceManualInput,
): Promise<ApiResult<AttendanceRecord>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.manual_edit")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner / Manager yang dapat edit attendance manual",
    );
  }

  const parsed = editAttendanceManualSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  /* Fetch current state untuk audit before/after. */
  const [current] = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.id, v.recordId))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Record tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Record dari outlet lain");
  }

  const now = new Date();
  try {
    const [row] = await db
      .update(attendanceRecords)
      .set({
        isLate: v.isLate,
        lateMinutes: v.lateMinutes,
        overtimeMinutes: v.overtimeMinutes,
        manualEditAt: now,
        manualEditBy: session.user.id,
        manualEditReason: v.reason,
        updatedAt: now,
      })
      .where(eq(attendanceRecords.id, v.recordId))
      .returning();

    logAudit({
      eventType: "attendance.manual_edit",
      userId: session.user.id,
      entityType: "attendance",
      entityId: v.recordId,
      payload: {
        summary: `Manual edit attendance ${current.employeeId} (${current.shiftDate}): ${current.isLate} → ${v.isLate}, late ${current.lateMinutes ?? "-"}m → ${v.lateMinutes ?? "-"}m`,
        before: {
          isLate: current.isLate,
          lateMinutes: current.lateMinutes,
          overtimeMinutes: current.overtimeMinutes,
        },
        after: {
          isLate: v.isLate,
          lateMinutes: v.lateMinutes,
          overtimeMinutes: v.overtimeMinutes,
        },
        context: { reason: v.reason },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) =>
      console.error("[audit attendance.manual_edit]", e),
    );

    return ok(row);
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "attendance", "Operasi database gagal"),
    );
  }
}

// ---------- Manual entry / backfill (Sesi AE-162) ----------

/** Bangun instant dari tanggal WIB + "HH:MM[:SS]". WIB = UTC+7 (no DST). */
function buildWibInstant(dateStr: string, hms: string): Date {
  const norm = hms.length === 5 ? `${hms}:00` : hms;
  return new Date(`${dateStr}T${norm}+07:00`);
}

/** Tanggal +1 hari (YYYY-MM-DD), untuk shift lewat tengah malam. */
function nextDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Turunkan clock-in/out + workMinutes dari shift terjadwal. NULL kalau
 * tidak ada jadwal kerja (day-off / tanpa jam). Sadar cross-midnight. */
function deriveManualShiftTimes(
  shiftDate: string,
  schedule: { dayOff: boolean; startTime: string | null; endTime: string | null } | null,
): { clockInAt: Date; clockOutAt: Date | null; workMinutes: number | null } {
  if (!schedule || schedule.dayOff || !schedule.startTime || !schedule.endTime) {
    /* Fallback defensif (mestinya tak terpakai — UI hanya izinkan hari
     * Alpa yang pasti terjadwal): catat siang hari, tanpa jam keluar. */
    return {
      clockInAt: buildWibInstant(shiftDate, "12:00:00"),
      clockOutAt: null,
      workMinutes: null,
    };
  }
  const startMin = timeStringToMinutes(schedule.startTime);
  const endMin = timeStringToMinutes(schedule.endTime);
  const clockInAt = buildWibInstant(shiftDate, schedule.startTime);
  const crossMidnight = endMin <= startMin;
  const clockOutAt = buildWibInstant(
    crossMidnight ? nextDateStr(shiftDate) : shiftDate,
    schedule.endTime,
  );
  const workMinutes = Math.max(
    0,
    Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60_000),
  );
  return { clockInAt, clockOutAt, workMinutes };
}

/**
 * Sesi AE-162 — CREATE record absen manual untuk satu hari yang tidak ada
 * clock-in (status "alpa"). Jam diturunkan dari shift terjadwal; HR set
 * telat/lembur opsional + alasan wajib. is_manual_entry=true.
 */
export async function createManualAttendance(
  input: CreateManualAttendanceInput,
): Promise<ApiResult<AttendanceRecord>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.manual_edit")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner / Manager yang dapat input absen manual",
    );
  }
  const parsed = createManualAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  if (v.shiftDate > todayWibIso()) {
    return fail(
      "FUTURE_DATE",
      "Tidak bisa input absen untuk tanggal yang belum tiba",
    );
  }

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

  /* Cegah dobel — kalau sudah ada record (open / closed) di tanggal itu,
   * arahkan ke Edit, bukan create baru. */
  const [existing] = await db
    .select({ id: attendanceRecords.id })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, session.user.outletId),
        eq(attendanceRecords.employeeId, v.employeeId),
        eq(attendanceRecords.shiftDate, v.shiftDate),
      ),
    )
    .limit(1);
  if (existing) {
    return fail(
      "ALREADY_EXISTS",
      "Sudah ada record absen di tanggal ini — pakai Edit, bukan input baru",
    );
  }

  const schedule = await fetchScheduleByEmployeeAndDate(
    v.employeeId,
    v.shiftDate,
  );
  const derived = deriveManualShiftTimes(v.shiftDate, schedule);

  /* Sesi AE-244 — kalau HR mengisi jam SEBENARNYA, pakai itu dan biarkan
   * sistem menghitung telat + lemburnya. Tanpa jam nyata, jam diturunkan
   * dari jadwal (perilaku lama) dan angka telat/lembur memang mustahil
   * berbeda dari nol — jadi yang dipakai nilai ketikan HR. */
  let clockInAt = derived.clockInAt;
  let clockOutAt = derived.clockOutAt;
  let workMinutes = derived.workMinutes;
  let isLate = v.isLate;
  let lateMinutes = v.lateMinutes;
  let overtimeMinutes = v.overtimeMinutes;

  if (v.clockInTime) {
    clockInAt = buildWibInstant(v.shiftDate, `${v.clockInTime}:00`);
    if (v.clockOutTime) {
      /* Pulang lebih pagi dari masuk = shift melewati tengah malam. */
      const crossMidnight = v.clockOutTime <= v.clockInTime;
      clockOutAt = buildWibInstant(
        crossMidnight ? nextDateStr(v.shiftDate) : v.shiftDate,
        `${v.clockOutTime}:00`,
      );
      workMinutes = Math.max(
        0,
        Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60_000),
      );
    } else {
      clockOutAt = null;
      workMinutes = null;
    }

    const { deriveAttendanceMetrics } = await import("./recompute-pure");
    const { computeLateMinutes } = await import("./late-compute");
    const { computeOvertimeMinutes } = await import("./overtime-compute");
    const metrics = deriveAttendanceMetrics({
      shiftDate: v.shiftDate,
      newSchedule: schedule
        ? {
            dayOff: schedule.dayOff,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
          }
        : null,
      clockInAt,
      clockOutAt,
      graceMinutes: await resolveLateGraceMinutes(session.user.outletId),
      computeLate: computeLateMinutes,
      computeOvertime: computeOvertimeMinutes,
    });
    isLate = metrics.isLate;
    lateMinutes = metrics.lateMinutes;
    overtimeMinutes = metrics.overtimeMinutes;
  }

  const now = new Date();
  try {
    const [row] = await db
      .insert(attendanceRecords)
      .values({
        outletId: session.user.outletId,
        employeeId: v.employeeId,
        shiftDate: v.shiftDate,
        clockInAt,
        clockOutAt,
        clockedInBy: session.user.id,
        clockedOutBy: clockOutAt ? session.user.id : null,
        workMinutes,
        isLate,
        lateMinutes,
        overtimeMinutes,
        isManualEntry: true,
        manualEditAt: now,
        manualEditBy: session.user.id,
        manualEditReason: v.reason,
      })
      .returning();

    logAudit({
      eventType: "attendance.manual_create",
      userId: session.user.id,
      entityType: "attendance",
      entityId: row.id,
      payload: {
        summary: `Input absen manual (Hadir): ${emp.fullName} ${v.shiftDate}`,
        after: {
          shiftDate: v.shiftDate,
          isLate,
          lateMinutes,
          overtimeMinutes,
          workMinutes,
          /* Jejak: angka ini dihitung sistem atau diketik HR? */
          autoComputed: Boolean(v.clockInTime),
          clockInTime: v.clockInTime ?? null,
          clockOutTime: v.clockOutTime ?? null,
        },
        context: { reason: v.reason, employeeId: emp.id },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit attendance.manual_create]", e));

    return ok(row);
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "attendance", "Operasi database gagal"),
    );
  }
}

/**
 * Sesi AE-162 — hapus entri absen yang DIBUAT manual (revert ke Alpa).
 * Guard: hanya is_manual_entry=true; record clock-in asli tidak bisa dihapus.
 */
export async function deleteManualAttendance(
  input: DeleteManualAttendanceInput,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.manual_edit")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner / Manager yang dapat hapus absen manual",
    );
  }
  const parsed = deleteManualAttendanceSchema.safeParse(input);
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
  if (!current.isManualEntry) {
    return fail(
      "NOT_MANUAL",
      "Hanya entri manual yang bisa dihapus. Record clock-in asli cuma bisa di-edit statusnya.",
    );
  }

  try {
    await db
      .delete(attendanceRecords)
      .where(eq(attendanceRecords.id, v.recordId));

    logAudit({
      eventType: "attendance.manual_delete",
      userId: session.user.id,
      entityType: "attendance",
      entityId: v.recordId,
      payload: {
        summary: `Hapus entri absen manual ${current.employeeId} (${current.shiftDate})`,
        before: {
          shiftDate: current.shiftDate,
          isLate: current.isLate,
          workMinutes: current.workMinutes,
        },
        context: { reason: v.reason ?? null },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit attendance.manual_delete]", e));

    return ok({ id: v.recordId });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "attendance", "Operasi database gagal"),
    );
  }
}

/**
 * Sesi AE-162 — backfill massal: tandai HADIR semua hari Alpa (terjadwal,
 * lewat, belum ada record) dalam rentang tanggal untuk karyawan terpilih.
 * Jam ikut shift terjadwal. Skip hari off / sudah ada record / masa depan.
 */
export async function bulkBackfillAttendance(
  input: BulkBackfillAttendanceInput,
): Promise<ApiResult<{ created: number; scanned: number; skipped: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.manual_edit")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner / Manager yang dapat backfill absen",
    );
  }
  const parsed = bulkBackfillAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  if (v.to < v.from) {
    return fail("VALIDATION_ERROR", "Tanggal akhir harus >= tanggal mulai");
  }

  /* Enumerate tanggal (inclusive), cap 62 hari. */
  const dates: string[] = [];
  for (let d = v.from; d <= v.to; d = nextDateStr(d)) {
    dates.push(d);
    if (dates.length > 62) {
      return fail("VALIDATION_ERROR", "Rentang maksimal 62 hari");
    }
  }
  const today = todayWibIso();

  /* Karyawan aktif (opsional difilter ke subset). */
  const empConds = [
    eq(employees.outletId, session.user.outletId),
    isNull(employees.deletedAt),
  ];
  if (v.employeeIds && v.employeeIds.length > 0) {
    empConds.push(inArray(employees.id, v.employeeIds));
  }
  const emps = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(and(...empConds));
  if (emps.length === 0) {
    return ok({ created: 0, scanned: 0, skipped: 0 });
  }

  const schedules = await db
    .select({
      employeeId: employeeSchedules.employeeId,
      scheduleDate: employeeSchedules.scheduleDate,
      dayOff: employeeSchedules.dayOff,
      startTime: employeeSchedules.startTime,
      endTime: employeeSchedules.endTime,
    })
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.outletId, session.user.outletId),
        gte(employeeSchedules.scheduleDate, v.from),
        lte(employeeSchedules.scheduleDate, v.to),
      ),
    );
  const scheduleMap = new Map<string, (typeof schedules)[number]>();
  for (const s of schedules) {
    scheduleMap.set(`${s.employeeId}|${s.scheduleDate}`, s);
  }

  const existing = await db
    .select({
      employeeId: attendanceRecords.employeeId,
      shiftDate: attendanceRecords.shiftDate,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, session.user.outletId),
        gte(attendanceRecords.shiftDate, v.from),
        lte(attendanceRecords.shiftDate, v.to),
      ),
    );
  const existingSet = new Set(
    existing.map((r) => `${r.employeeId}|${r.shiftDate}`),
  );

  const now = new Date();
  const toInsert: (typeof attendanceRecords.$inferInsert)[] = [];
  let scanned = 0;
  for (const emp of emps) {
    for (const date of dates) {
      scanned += 1;
      if (date > today) continue;
      const sched = scheduleMap.get(`${emp.id}|${date}`);
      if (!sched || sched.dayOff) continue; // hanya hari kerja terjadwal
      if (existingSet.has(`${emp.id}|${date}`)) continue; // sudah ada record
      const { clockInAt, clockOutAt, workMinutes } = deriveManualShiftTimes(
        date,
        sched,
      );
      toInsert.push({
        outletId: session.user.outletId,
        employeeId: emp.id,
        shiftDate: date,
        clockInAt,
        clockOutAt,
        clockedInBy: session.user.id,
        clockedOutBy: clockOutAt ? session.user.id : null,
        workMinutes,
        isLate: v.isLate,
        lateMinutes: v.isLate === "yes" ? null : 0,
        overtimeMinutes: 0,
        isManualEntry: true,
        manualEditAt: now,
        manualEditBy: session.user.id,
        manualEditReason: v.reason,
      });
    }
  }

  if (toInsert.length === 0) {
    return ok({ created: 0, scanned, skipped: scanned });
  }

  try {
    await db.insert(attendanceRecords).values(toInsert);

    logAudit({
      eventType: "attendance.manual_backfill",
      userId: session.user.id,
      entityType: "attendance",
      entityId: session.user.outletId,
      payload: {
        summary: `Backfill absen massal ${v.from}..${v.to}: ${toInsert.length} hari ditandai Hadir (${emps.length} karyawan)`,
        after: { created: toInsert.length, from: v.from, to: v.to },
        context: { reason: v.reason, employeeIds: v.employeeIds ?? "all" },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit attendance.manual_backfill]", e));

    return ok({
      created: toInsert.length,
      scanned,
      skipped: scanned - toInsert.length,
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "attendance", "Operasi database gagal"),
    );
  }
}
