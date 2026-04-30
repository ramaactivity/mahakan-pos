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
import {
  fail,
  ok,
  type ApiResult,
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
  const scheduledCounts = await db
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
        lte(employeeSchedules.scheduleDate, input.to),
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
