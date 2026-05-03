import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  attendanceRecords,
  employees,
  users,
} from "@/db/schema";
import type {
  AttendanceRecord,
  AttendanceRecordWithEmployee,
  EmployeeAttendanceTodayStatus,
  Paginated,
} from "./types";

const clockedInByUser = alias(users, "clocked_in_by_user");
const clockedOutByUser = alias(users, "clocked_out_by_user");

export interface ListAttendanceOptions {
  outletId: string;
  date?: string;
  employeeId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export async function fetchAttendance(
  opts: ListAttendanceOptions,
): Promise<Paginated<AttendanceRecordWithEmployee>> {
  const limit = opts.limit ?? 200;
  const conds = [eq(attendanceRecords.outletId, opts.outletId)];
  if (opts.date) {
    conds.push(eq(attendanceRecords.shiftDate, opts.date));
  } else {
    if (opts.from) conds.push(gte(attendanceRecords.shiftDate, opts.from));
    if (opts.to) conds.push(lte(attendanceRecords.shiftDate, opts.to));
  }
  if (opts.employeeId) {
    conds.push(eq(attendanceRecords.employeeId, opts.employeeId));
  }

  const rows = await db
    .select({
      record: attendanceRecords,
      employeeFullName: employees.fullName,
      employeeNickname: employees.nickname,
      employeePosition: employees.position,
      clockedInByName: clockedInByUser.name,
      clockedOutByName: clockedOutByUser.name,
    })
    .from(attendanceRecords)
    .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
    .innerJoin(
      clockedInByUser,
      eq(attendanceRecords.clockedInBy, clockedInByUser.id),
    )
    .leftJoin(
      clockedOutByUser,
      eq(attendanceRecords.clockedOutBy, clockedOutByUser.id),
    )
    .where(and(...conds))
    .orderBy(desc(attendanceRecords.shiftDate), desc(attendanceRecords.clockInAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: sliced.map((r) => ({
      ...r.record,
      employeeFullName: r.employeeFullName,
      employeeNickname: r.employeeNickname,
      employeePosition: r.employeePosition,
      clockedInByName: r.clockedInByName,
      clockedOutByName: r.clockedOutByName,
    })),
    total: rows.length,
    hasMore,
  };
}

export async function fetchOpenAttendance(
  outletId: string,
  employeeId: string,
  shiftDate: string,
): Promise<AttendanceRecord | null> {
  const [row] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, outletId),
        eq(attendanceRecords.employeeId, employeeId),
        eq(attendanceRecords.shiftDate, shiftDate),
        isNull(attendanceRecords.clockOutAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Today snapshot per active employee at the outlet — drives the kiosk
 * grid. One query: leftJoin attendance to find each employee's open
 * record (if any) plus a flag for "did they already finish a cycle". */
export async function fetchTodayStatus(
  outletId: string,
  shiftDate: string,
): Promise<EmployeeAttendanceTodayStatus[]> {
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
        eq(employees.outletId, outletId),
        isNull(employees.deletedAt),
        eq(employees.status, "active"),
      ),
    )
    .orderBy(asc(employees.fullName));

  if (employeeRows.length === 0) return [];

  const employeeIds = employeeRows.map((e) => e.id);
  const records = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, outletId),
        eq(attendanceRecords.shiftDate, shiftDate),
        inArray(attendanceRecords.employeeId, employeeIds),
      ),
    );

  const openByEmployee = new Map<string, AttendanceRecord>();
  const closedByEmployee = new Set<string>();
  for (const r of records) {
    if (r.clockOutAt === null) {
      openByEmployee.set(r.employeeId, r);
    } else {
      closedByEmployee.add(r.employeeId);
    }
  }

  return employeeRows.map((e) => {
    const open = openByEmployee.get(e.id) ?? null;
    return {
      employeeId: e.id,
      employeeFullName: e.fullName,
      employeeNickname: e.nickname,
      employeePosition: e.position,
      openRecordId: open?.id ?? null,
      openClockInAt: open ? open.clockInAt.toISOString() : null,
      hasClosedRecordToday: closedByEmployee.has(e.id),
    };
  });
}
