"use server";

import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecords,
  employeeSchedules,
  employees,
  payrollLines,
  payrollPeriods,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { toJakartaDateOnly } from "@/lib/date";
import {
  fail,
  ok,
  type ApiResult,
  type AttendanceCalendar,
  type AttendanceCalendarCell,
  type AttendanceCalendarRow,
  type AttendanceDayStatus,
  type AttendanceSummary,
  type AttendanceSummaryRow,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** Aggregate attendance per employee for date range. One employee row
 * per active+resigned employee at the outlet (resigned shown for
 * historical periods).
 *
 * Implementation: 4 query batches stitched in JS — keeps SQL readable
 * and avoids window-function variation across drizzle dialects.
 */
export async function getAttendanceSummary(input: {
  from: string;
  to: string;
}): Promise<ApiResult<AttendanceSummary>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat laporan absensi");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.to)
  ) {
    return fail("VALIDATION_ERROR", "Tanggal tidak valid");
  }
  if (input.to < input.from) {
    return fail("VALIDATION_ERROR", "to harus >= from");
  }

  const employeeRows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      nickname: employees.nickname,
      position: employees.position,
    })
    .from(employees)
    .where(
      and(
        eq(employees.outletId, session.user.outletId),
        isNull(employees.deletedAt),
      ),
    )
    .orderBy(asc(employees.fullName));

  if (employeeRows.length === 0) {
    return ok({
      rangeStart: input.from,
      rangeEnd: input.to,
      rows: [],
    });
  }

  const aggregates = await db
    .select({
      employeeId: attendanceRecords.employeeId,
      workDays: sql<number>`COUNT(DISTINCT ${attendanceRecords.shiftDate})::int`,
      totalWorkMinutes: sql<number>`COALESCE(SUM(${attendanceRecords.workMinutes}), 0)::int`,
      totalLateMinutes: sql<number>`COALESCE(SUM(${attendanceRecords.lateMinutes}), 0)::int`,
      lateOccurrences: sql<number>`COUNT(*) FILTER (WHERE ${attendanceRecords.isLate} = 'yes')::int`,
      totalOvertimeMinutes: sql<number>`COALESCE(SUM(${attendanceRecords.overtimeMinutes}), 0)::int`,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, session.user.outletId),
        gte(attendanceRecords.shiftDate, input.from),
        lte(attendanceRecords.shiftDate, input.to),
      ),
    )
    .groupBy(attendanceRecords.employeeId);

  // Scheduled non-day-off vs attended, to compute missed days.
  // Sesi AE-61 — cap upper bound dengan today WIB supaya future schedule
  // tidak ke-count sebagai missed (bug HR: future days dianggap alpa).
  const todayWib = toJakartaDateOnly(new Date());
  const effectiveTo = input.to < todayWib ? input.to : todayWib;
  const scheduledCounts =
    effectiveTo < input.from
      ? []
      : await db
          .select({
            employeeId: employeeSchedules.employeeId,
            scheduledDays: sql<number>`COUNT(*)::int`,
          })
          .from(employeeSchedules)
          .where(
            and(
              eq(employeeSchedules.outletId, session.user.outletId),
              eq(employeeSchedules.dayOff, false),
              gte(employeeSchedules.scheduleDate, input.from),
              lte(employeeSchedules.scheduleDate, effectiveTo),
            ),
          )
          .groupBy(employeeSchedules.employeeId);

  const aggMap = new Map(aggregates.map((a) => [a.employeeId, a]));
  const schedMap = new Map(
    scheduledCounts.map((s) => [s.employeeId, s.scheduledDays]),
  );

  const rows: AttendanceSummaryRow[] = employeeRows.map((e) => {
    const agg = aggMap.get(e.id);
    const scheduled = schedMap.get(e.id) ?? 0;
    const workDays = agg?.workDays ?? 0;
    const missedScheduledDays = Math.max(0, scheduled - workDays);
    return {
      employeeId: e.id,
      employeeFullName: e.fullName,
      employeeNickname: e.nickname,
      employeePosition: e.position,
      workDays,
      totalWorkMinutes: agg?.totalWorkMinutes ?? 0,
      totalLateMinutes: agg?.totalLateMinutes ?? 0,
      lateOccurrences: agg?.lateOccurrences ?? 0,
      totalOvertimeMinutes: agg?.totalOvertimeMinutes ?? 0,
      missedScheduledDays,
    };
  });

  return ok({
    rangeStart: input.from,
    rangeEnd: input.to,
    rows,
  });
}

/** Sesi AE-20 — calendar matrix view (per-employee × per-date status).
 * Owner request: laporan HR ingin tabel jelas per tanggal masuk/off/alpa.
 *
 * Status derivation:
 *   - "hadir" / "telat": ada attendanceRecord di tanggal itu (telat kalau
 *     isLate=yes atau lateMinutes>0)
 *   - "off": ada employeeSchedule.dayOff=true
 *   - "alpa": ada schedule kerja (dayOff=false) tapi tidak ada record DAN
 *     tanggalnya <= today WIB
 *   - "upcoming": ada schedule kerja tapi tanggalnya masa depan (> today WIB)
 *     — Sesi AE-61 bug fix: HR complain "hari ini tanggal 15 tapi sabtu 16
 *     dianggap alpa di historis". Future schedule belum boleh dianggap alpa.
 *   - "kosong": tidak ada schedule + tidak ada record (rest day off-radar)
 *
 * Range capped 62 hari (≈ 2 bulan) supaya UI tidak overload.
 */
export async function getAttendanceCalendar(input: {
  from: string;
  to: string;
}): Promise<ApiResult<AttendanceCalendar>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat laporan absensi");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.to)
  ) {
    return fail("VALIDATION_ERROR", "Tanggal tidak valid");
  }
  if (input.to < input.from) {
    return fail("VALIDATION_ERROR", "to harus >= from");
  }

  const dates = enumerateDates(input.from, input.to);
  if (dates.length > 62) {
    return fail(
      "VALIDATION_ERROR",
      "Range maksimal 62 hari (sekitar 2 bulan)",
    );
  }

  const employeeRows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      nickname: employees.nickname,
      position: employees.position,
    })
    .from(employees)
    .where(
      and(
        eq(employees.outletId, session.user.outletId),
        isNull(employees.deletedAt),
      ),
    )
    .orderBy(asc(employees.fullName));

  if (employeeRows.length === 0) {
    return ok({
      rangeStart: input.from,
      rangeEnd: input.to,
      dates,
      rows: [],
    });
  }

  // Sesi AE-50 — tambah field clockIn/Out, selfie URL/folder URL, GPS
  // untuk modal detail absen di Back Office (HR request).
  const records = await db
    .select({
      id: attendanceRecords.id,
      employeeId: attendanceRecords.employeeId,
      shiftDate: attendanceRecords.shiftDate,
      workMinutes: attendanceRecords.workMinutes,
      lateMinutes: attendanceRecords.lateMinutes,
      isLate: attendanceRecords.isLate,
      overtimeMinutes: attendanceRecords.overtimeMinutes,
      clockInAt: attendanceRecords.clockInAt,
      clockOutAt: attendanceRecords.clockOutAt,
      selfieDriveUrl: attendanceRecords.selfieDriveUrl,
      selfieDriveFolderUrl: attendanceRecords.selfieDriveFolderUrl,
      gpsDistanceMeters: attendanceRecords.gpsDistanceMeters,
      manualEditAt: attendanceRecords.manualEditAt,
      manualEditReason: attendanceRecords.manualEditReason,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, session.user.outletId),
        gte(attendanceRecords.shiftDate, input.from),
        lte(attendanceRecords.shiftDate, input.to),
      ),
    );

  const schedules = await db
    .select({
      employeeId: employeeSchedules.employeeId,
      scheduleDate: employeeSchedules.scheduleDate,
      dayOff: employeeSchedules.dayOff,
    })
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.outletId, session.user.outletId),
        gte(employeeSchedules.scheduleDate, input.from),
        lte(employeeSchedules.scheduleDate, input.to),
      ),
    );

  const recordMap = new Map<string, (typeof records)[number]>();
  for (const r of records) {
    recordMap.set(`${r.employeeId}|${r.shiftDate}`, r);
  }
  const scheduleMap = new Map<string, (typeof schedules)[number]>();
  for (const s of schedules) {
    scheduleMap.set(`${s.employeeId}|${s.scheduleDate}`, s);
  }

  // Sesi AE-61 — server WIB "today" untuk distinguish alpa vs upcoming.
  // Tanggal di masa depan tidak boleh dianggap alpa (HR bug report).
  const todayWib = toJakartaDateOnly(new Date());

  const rows: AttendanceCalendarRow[] = employeeRows.map((e) => {
    const days: Record<string, AttendanceCalendarCell> = {};
    for (const date of dates) {
      const rec = recordMap.get(`${e.id}|${date}`);
      const sched = scheduleMap.get(`${e.id}|${date}`);
      let status: AttendanceDayStatus;
      const cell: AttendanceCalendarCell = { status: "kosong" };
      if (rec) {
        const isLate =
          rec.isLate === "yes" || (rec.lateMinutes ?? 0) > 0;
        status = isLate ? "telat" : "hadir";
        cell.workMinutes = rec.workMinutes ?? undefined;
        cell.lateMinutes = rec.lateMinutes ?? undefined;
        cell.overtimeMinutes = rec.overtimeMinutes ?? undefined;
        // Sesi AE-50 — propagate detail fields untuk modal Back Office.
        cell.clockInAt = rec.clockInAt
          ? new Date(rec.clockInAt).toISOString()
          : null;
        cell.clockOutAt = rec.clockOutAt
          ? new Date(rec.clockOutAt).toISOString()
          : null;
        cell.selfieDriveUrl = rec.selfieDriveUrl;
        cell.selfieDriveFolderUrl = rec.selfieDriveFolderUrl;
        cell.gpsDistanceMeters = rec.gpsDistanceMeters;
        // Sesi AE-63 phase8 — needed by HR manual-edit modal
        cell.recordId = rec.id;
        cell.isLate = rec.isLate;
        cell.manualEditAt = rec.manualEditAt
          ? new Date(rec.manualEditAt).toISOString()
          : null;
        cell.manualEditReason = rec.manualEditReason;
      } else if (sched && sched.dayOff) {
        status = "off";
      } else if (sched && !sched.dayOff) {
        // Sesi AE-61 — kalau tanggal masa depan, status = upcoming.
        // Boundary: tanggal > today WIB = upcoming. Hari ini tetap bisa
        // alpa kalau staff belum clock-in (defensive: HR yang notice).
        status = date > todayWib ? "upcoming" : "alpa";
      } else {
        status = "kosong";
      }
      cell.status = status;
      days[date] = cell;
    }
    return {
      employeeId: e.id,
      employeeFullName: e.fullName,
      employeeNickname: e.nickname,
      employeePosition: e.position,
      days,
    };
  });

  return ok({
    rangeStart: input.from,
    rangeEnd: input.to,
    dates,
    rows,
  });
}

/** Enumerate inclusive YYYY-MM-DD list between from..to. */
function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const cursor = new Date(fromDate.getTime());
  while (cursor.getTime() <= toDate.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Returns a CSV string for attendance records within range. Includes
 * header + one row per attendance event. Dates rendered as YYYY-MM-DD,
 * times as HH:MM in WIB. */
export async function exportAttendanceCsv(input: {
  from: string;
  to: string;
}): Promise<ApiResult<{ csv: string; filename: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "attendance.view")) {
    return fail("FORBIDDEN", "Tidak punya hak export absensi");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.to)
  ) {
    return fail("VALIDATION_ERROR", "Tanggal tidak valid");
  }

  const rows = await db
    .select({
      record: attendanceRecords,
      employeeFullName: employees.fullName,
      employeePosition: employees.position,
    })
    .from(attendanceRecords)
    .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
    .where(
      and(
        eq(attendanceRecords.outletId, session.user.outletId),
        gte(attendanceRecords.shiftDate, input.from),
        lte(attendanceRecords.shiftDate, input.to),
      ),
    )
    .orderBy(
      asc(attendanceRecords.shiftDate),
      asc(employees.fullName),
    );

  const lines: string[] = [
    "tanggal,karyawan,posisi,clock_in,clock_out,durasi_menit,telat,telat_menit,overtime_menit,catatan",
  ];
  for (const r of rows) {
    const inWib = formatWibTime(r.record.clockInAt);
    const outWib = r.record.clockOutAt ? formatWibTime(r.record.clockOutAt) : "";
    const cells = [
      r.record.shiftDate,
      csvEscape(r.employeeFullName),
      csvEscape(r.employeePosition ?? ""),
      inWib,
      outWib,
      String(r.record.workMinutes ?? ""),
      r.record.isLate,
      String(r.record.lateMinutes ?? ""),
      String(r.record.overtimeMinutes ?? ""),
      csvEscape(r.record.notes ?? ""),
    ];
    lines.push(cells.join(","));
  }

  return ok({
    csv: lines.join("\n"),
    filename: `attendance_${input.from}_to_${input.to}.csv`,
  });
}

/** CSV export for one payroll period — joined with employee meta.
 * Useful to forward to accounting / banking system. */
export async function exportPayrollCsv(
  periodId: string,
): Promise<ApiResult<{ csv: string; filename: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.view")) {
    return fail("FORBIDDEN", "Tidak punya hak export payroll");
  }
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Period tidak ditemukan");
  if (period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period dari outlet lain");
  }

  const rows = await db
    .select({
      line: payrollLines,
      employeeFullName: employees.fullName,
      employeeNumber: employees.employeeNumber,
      employeePosition: employees.position,
      employeeEmail: employees.email,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(payrollLines.employeeId, employees.id))
    .where(eq(payrollLines.periodId, periodId))
    .orderBy(asc(employees.fullName));

  const lines: string[] = [
    "no_karyawan,nama,posisi,email,hari_kerja,total_menit,telat_menit,overtime_menit,base_salary,overtime_pay,bonus,late_deduction,other_deductions,gross_pay,net_pay,catatan",
  ];
  for (const r of rows) {
    const cells = [
      csvEscape(r.employeeNumber ?? ""),
      csvEscape(r.employeeFullName),
      csvEscape(r.employeePosition ?? ""),
      csvEscape(r.employeeEmail ?? ""),
      String(r.line.workDays),
      String(r.line.totalWorkMinutes),
      String(r.line.totalLateMinutes),
      String(r.line.totalOvertimeMinutes),
      String(r.line.baseSalary),
      String(r.line.overtimePay),
      String(r.line.bonus),
      String(r.line.lateDeduction),
      String(r.line.otherDeductions),
      String(r.line.grossPay),
      String(r.line.netPay),
      csvEscape(r.line.notes ?? ""),
    ];
    lines.push(cells.join(","));
  }

  return ok({
    csv: lines.join("\n"),
    filename: `payroll_${period.periodStart}_to_${period.periodEnd}.csv`,
  });
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatWibTime(at: Date): string {
  // WIB = UTC+7. Render HH:MM (24-hour).
  const wibMinutes = at.getUTCHours() * 60 + at.getUTCMinutes() + 7 * 60;
  const wrapped = ((wibMinutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const m = String(wrapped % 60).padStart(2, "0");
  return `${h}:${m}`;
}
