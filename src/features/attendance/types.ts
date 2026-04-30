import type { InferSelectModel } from "drizzle-orm";
import type { attendanceRecords } from "@/db/schema";

export type AttendanceRecord = InferSelectModel<typeof attendanceRecords>;
export type LateStatus = "yes" | "no" | "unknown";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export interface Paginated<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

/** Attendance row joined with employee + actor names for the admin
 * table render — saves N joins on the client. */
export interface AttendanceRecordWithEmployee extends AttendanceRecord {
  employeeFullName: string;
  employeeNickname: string | null;
  employeePosition: string | null;
  clockedInByName: string;
  clockedOutByName: string | null;
}

/** Per-employee snapshot used by the kiosk grid + Attendance section
 * "today" view — shows whether they're already clocked in. */
export interface EmployeeAttendanceTodayStatus {
  employeeId: string;
  employeeFullName: string;
  employeeNickname: string | null;
  employeePosition: string | null;
  /** Open record on today's shift_date, if any. */
  openRecordId: string | null;
  openClockInAt: string | null; // ISO
  /** Whether they've already completed at least one in/out cycle today. */
  hasClosedRecordToday: boolean;
}

export interface ClockInInput {
  employeeId: string;
  notes?: string | null;
}

export interface ClockOutInput {
  recordId: string;
  notes?: string | null;
}
