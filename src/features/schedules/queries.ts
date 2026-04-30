import "server-only";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { employeeSchedules, employees } from "@/db/schema";
import type { EmployeeSchedule, ScheduleWithEmployee } from "./types";

export interface ListSchedulesOptions {
  outletId: string;
  from: string;
  to: string;
  employeeId?: string;
}

export async function fetchSchedules(
  opts: ListSchedulesOptions,
): Promise<ScheduleWithEmployee[]> {
  const conds = [
    eq(employeeSchedules.outletId, opts.outletId),
    gte(employeeSchedules.scheduleDate, opts.from),
    lte(employeeSchedules.scheduleDate, opts.to),
  ];
  if (opts.employeeId) {
    conds.push(eq(employeeSchedules.employeeId, opts.employeeId));
  }
  const rows = await db
    .select({
      schedule: employeeSchedules,
      employeeFullName: employees.fullName,
      employeeNickname: employees.nickname,
      employeePosition: employees.position,
    })
    .from(employeeSchedules)
    .innerJoin(employees, eq(employeeSchedules.employeeId, employees.id))
    .where(and(...conds))
    .orderBy(
      asc(employeeSchedules.scheduleDate),
      asc(employees.fullName),
    );
  return rows.map((r) => ({
    ...r.schedule,
    employeeFullName: r.employeeFullName,
    employeeNickname: r.employeeNickname,
    employeePosition: r.employeePosition,
  }));
}

export async function fetchScheduleByEmployeeAndDate(
  employeeId: string,
  scheduleDate: string,
): Promise<EmployeeSchedule | null> {
  const [row] = await db
    .select()
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.employeeId, employeeId),
        eq(employeeSchedules.scheduleDate, scheduleDate),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Returns all active employees at the outlet, used as the rows of
 * the schedule planner grid. */
export async function fetchActiveEmployeesForOutlet(
  outletId: string,
): Promise<
  Array<{
    id: string;
    fullName: string;
    nickname: string | null;
    position: string | null;
  }>
> {
  return db
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
        eq(employees.status, "active"),
        isNull(employees.deletedAt),
      ),
    )
    .orderBy(asc(employees.fullName));
}
