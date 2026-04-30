import type { InferSelectModel } from "drizzle-orm";
import type { employeeSchedules } from "@/db/schema";

export type EmployeeSchedule = InferSelectModel<typeof employeeSchedules>;

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

export interface ScheduleWithEmployee extends EmployeeSchedule {
  employeeFullName: string;
  employeeNickname: string | null;
  employeePosition: string | null;
}

export interface UpsertScheduleInput {
  employeeId: string;
  scheduleDate: string;
  startTime?: string | null;
  endTime?: string | null;
  dayOff: boolean;
  notes?: string | null;
}
