/**
 * Sesi AE-63 phase3 P3.4 — pure helper untuk deriving attendance metrics
 * dari schedule + clock-in/out. Extracted dari `recomputeAttendanceForSchedule`
 * supaya bisa di-unit-test tanpa DB.
 *
 * 3 case yang di-handle:
 *  1. Schedule deleted (`null`) → metrics = unknown / null / null
 *  2. Schedule dayOff atau missing startTime → metrics = unknown / null / null
 *  3. Active schedule → derive via inject-able compute functions
 *
 * Helper functions di-inject untuk testability: tests bisa kasih stub kalau
 * mau verify decision logic tanpa exercise lateness math (sudah punya test
 * sendiri di late-compute.test.ts / overtime-compute.test.ts).
 */

import type {
  computeLateMinutes as RealComputeLate,
  LateComputeResult,
} from "./late-compute";
import type {
  computeOvertimeMinutes as RealComputeOT,
  OvertimeComputeResult,
} from "./overtime-compute";

export interface DeriveMetricsInput {
  shiftDate: string;
  newSchedule: {
    dayOff: boolean;
    startTime: string | null;
    endTime: string | null;
  } | null;
  clockInAt: Date;
  clockOutAt: Date | null;
  graceMinutes: number;
  /* Inject pure compute helpers. Default: real implementations. */
  computeLate: typeof RealComputeLate;
  computeOvertime: typeof RealComputeOT;
}

export interface DerivedMetrics {
  isLate: "yes" | "no" | "unknown";
  lateMinutes: number | null;
  overtimeMinutes: number | null;
}

export function deriveAttendanceMetrics(
  input: DeriveMetricsInput,
): DerivedMetrics {
  /* Case 1+2: schedule null OR dayOff OR no startTime → no metrics. */
  if (
    !input.newSchedule ||
    input.newSchedule.dayOff ||
    !input.newSchedule.startTime
  ) {
    return { isLate: "unknown", lateMinutes: null, overtimeMinutes: null };
  }

  /* Case 3: active schedule — derive late + OT. */
  const lateRes: LateComputeResult = input.computeLate({
    shiftDate: input.shiftDate,
    scheduledStartTime: input.newSchedule.startTime,
    scheduledEndTime: input.newSchedule.endTime ?? null,
    clockInAt: input.clockInAt,
    graceMinutes: input.graceMinutes,
  });

  let overtimeMinutes: number | null = null;
  if (input.clockOutAt && input.newSchedule.endTime) {
    const otRes: OvertimeComputeResult = input.computeOvertime({
      shiftDate: input.shiftDate,
      scheduledStartTime: input.newSchedule.startTime,
      scheduledEndTime: input.newSchedule.endTime,
      clockOutAt: input.clockOutAt,
    });
    overtimeMinutes = otRes.overtimeMinutes;
  }

  return {
    isLate: lateRes.isLate,
    lateMinutes: lateRes.lateMinutes,
    overtimeMinutes,
  };
}
