export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

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

/** Aggregate attendance per employee within a date range. Drives the
 * Absensi summary table on HR Reports. */
export interface AttendanceSummaryRow {
  employeeId: string;
  employeeFullName: string;
  employeeNickname: string | null;
  employeePosition: string | null;
  workDays: number;
  totalWorkMinutes: number;
  totalLateMinutes: number;
  lateOccurrences: number;
  totalOvertimeMinutes: number;
  /** Days the employee was scheduled but no attendance record exists.
   * Computed against employee_schedules.day_off=false rows. */
  missedScheduledDays: number;
}

export interface AttendanceSummary {
  rangeStart: string;
  rangeEnd: string;
  rows: AttendanceSummaryRow[];
}
