/**
 * Sesi AE-62aa — pure helper untuk hitung overtime yang AWARE cross-midnight
 * clock-out.
 *
 * Pre-fix bug (AE-62i mirror logic): detect "overnight schedule"
 * (scheduledEnd < scheduledStart). Tapi MISS case yang lebih umum:
 * schedule normal-day (14:00-22:00) dengan karyawan clock-out PAST midnight
 * (01:00 next day). Naive minutesIntoWibDay(clockOut) - scheduledEnd =
 * 60 - 1320 = -1260 → max(0,-1260) = 0 → undercount 180 min real overtime.
 *
 * Fix: build scheduledEndAt sebagai Date object dari shiftDate+endTime
 * (plus +1 day kalau schedule overnight). Compute overtime = max(0,
 * clockOutAt - scheduledEndAt) dalam menit. Date arithmetic handle wrap.
 *
 * Test cases (verify di unit test):
 *   1. Normal day on-time: schedule 14:00-22:00, clock-out 22:00 → 0 OT
 *   2. Normal day late same-day: schedule 14:00-22:00, clock-out 23:30 → 90 OT
 *   3. Normal day late next-day: schedule 14:00-22:00, clock-out 01:00 → 180 OT
 *      (kasus yang dulu BUG)
 *   4. Overnight on-time: schedule 22:00-06:00, clock-out 06:00 next-day → 0 OT
 *   5. Overnight late: schedule 22:00-06:00, clock-out 07:30 next-day → 90 OT
 *   6. Early clock-out: schedule 14:00-22:00, clock-out 20:00 → 0 OT (no neg)
 */

/** Parse "HH:mm" → minutes-since-midnight. Defensive: NaN → 0. */
function timeStringToMinutes(hms: string): number {
  const [h, m] = hms.split(":").map((s) => parseInt(s, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface OvertimeComputeInput {
  /** Tanggal shift dalam YYYY-MM-DD WIB (from attendanceRecords.shift_date). */
  shiftDate: string;
  /** Jam mulai shift dari schedule, format "HH:mm". */
  scheduledStartTime: string;
  /** Jam akhir shift dari schedule, format "HH:mm". */
  scheduledEndTime: string;
  /** Waktu actual clock-out (UTC Date). */
  clockOutAt: Date;
}

export interface OvertimeComputeResult {
  /** Menit overtime — selalu ≥ 0. */
  overtimeMinutes: number;
  /** True kalau schedule cross-midnight (endTime < startTime). */
  isOvernightSchedule: boolean;
  /** Date scheduledEnd sebagai UTC moment (untuk audit/debug). */
  scheduledEndAt: Date;
}

export function computeOvertimeMinutes(
  input: OvertimeComputeInput,
): OvertimeComputeResult {
  const startMin = timeStringToMinutes(input.scheduledStartTime);
  const endMin = timeStringToMinutes(input.scheduledEndTime);
  const isOvernightSchedule = endMin < startMin;

  /* Build scheduledEndAt sebagai UTC moment. shiftDate dalam WIB; jadi
   * "shiftDate + endTime" di WIB → kalau overnight, geser +1 hari. WIB
   * offset +07:00 (Cisarua, no DST). */
  const baseIsoWib = `${input.shiftDate}T${input.scheduledEndTime.padStart(5, "0")}:00+07:00`;
  let scheduledEndAt = new Date(baseIsoWib);
  if (isOvernightSchedule) {
    scheduledEndAt = new Date(
      scheduledEndAt.getTime() + 24 * 60 * 60 * 1000,
    );
  }

  const diffMs = input.clockOutAt.getTime() - scheduledEndAt.getTime();
  const overtimeMinutes = Math.max(0, Math.floor(diffMs / 60_000));

  return {
    overtimeMinutes,
    isOvernightSchedule,
    scheduledEndAt,
  };
}
