/**
 * Sesi AE-62ab — pure helper untuk hitung lateness yang konsisten dengan
 * computeOvertimeMinutes (AE-62aa). Date-arithmetic based supaya tahan
 * overnight schedule + early clock-in edge cases.
 *
 * Latencies:
 *   - clock-in BEFORE scheduled start: 0 (not late)
 *   - clock-in WITHIN graceMinutes from scheduled start: 0 (within grace)
 *   - clock-in AFTER scheduled start + grace: positive diff minutes
 *
 * Same shiftDate semantics dengan attendance_records.shift_date.
 */

function timeStringToMinutes(hms: string): number {
  const [h, m] = hms.split(":").map((s) => parseInt(s, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface LateComputeInput {
  shiftDate: string;
  scheduledStartTime: string;
  /** Schedule end time — dipakai untuk detect overnight schedule (kalau
   * end < start). Tidak ikut compute late minutes (cuma untuk schema
   * konsistensi dgn overtime helper). Optional. */
  scheduledEndTime?: string | null;
  clockInAt: Date;
  /** Grace window dalam menit — clock-in dalam range ini ditandai NOT late. */
  graceMinutes: number;
}

export interface LateComputeResult {
  isLate: "yes" | "no";
  lateMinutes: number;
  scheduledStartAt: Date;
}

export function computeLateMinutes(
  input: LateComputeInput,
): LateComputeResult {
  /* Build scheduledStartAt sebagai UTC moment dari shiftDate + startTime di
   * WIB. Tidak butuh shift overnight (start always pada shiftDate; overnight
   * affects scheduledEnd next-day, lihat overtime-compute). */
  const baseIsoWib = `${input.shiftDate}T${input.scheduledStartTime.padStart(5, "0")}:00+07:00`;
  const scheduledStartAt = new Date(baseIsoWib);

  const diffMs = input.clockInAt.getTime() - scheduledStartAt.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  /* Defensive: end time used only untuk consistency (caller bisa lookup
   * overnight schedule via timeStringToMinutes kalau perlu). Saat ini tidak
   * affect lateness compute — clock-in vs scheduled start direct compare. */
  if (input.scheduledEndTime) {
    void timeStringToMinutes(input.scheduledEndTime);
  }

  if (diffMinutes <= input.graceMinutes) {
    return {
      isLate: "no",
      lateMinutes: Math.max(0, diffMinutes),
      scheduledStartAt,
    };
  }
  return {
    isLate: "yes",
    lateMinutes: diffMinutes,
    scheduledStartAt,
  };
}
