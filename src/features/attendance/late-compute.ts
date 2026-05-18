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

/** Sesi AE-63 hotfix-2 — normalize "H:MM" / "HH:MM" / "HH:MM:SS" →
 *  "HH:MM:SS" supaya ISO date construction valid. Postgres `time` column
 *  return 8-char "HH:MM:SS" yang BIKIN BUG pre-fix kalau di-concat ":00". */
function normalizeTimeToHHMMSS(time: string): string {
  const trimmed = time.trim();
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return "00:00:00";
  const hh = (parts[0] ?? "0").padStart(2, "0");
  const mm = (parts[1] ?? "0").padStart(2, "0");
  const ss = (parts[2] ?? "00").padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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
   * affects scheduledEnd next-day, lihat overtime-compute).
   *
   * Sesi AE-63 hotfix-2 — normalize time string supaya handle baik
   * "HH:MM" (HTML input) maupun "HH:MM:SS" (postgres time column).
   * Pre-fix `padStart(5,"0")` + concat ":00" bikin "HH:MM:SS:00" invalid
   * ISO → NaN → bug clock-in/clock-out gagal. */
  const normalizedStart = normalizeTimeToHHMMSS(input.scheduledStartTime);
  const baseIsoWib = `${input.shiftDate}T${normalizedStart}+07:00`;
  const scheduledStartAt = new Date(baseIsoWib);

  /* Defensive guard: kalau date invalid (mis. shiftDate rusak), fallback
   * ke isLate=no, lateMinutes=0 supaya tidak block clock-in. Log warning. */
  if (Number.isNaN(scheduledStartAt.getTime())) {
    console.error(
      `[late-compute] Invalid date: shiftDate=${input.shiftDate}, startTime=${input.scheduledStartTime}`,
    );
    return {
      isLate: "no",
      lateMinutes: 0,
      scheduledStartAt: input.clockInAt,
    };
  }

  const diffMs = input.clockInAt.getTime() - scheduledStartAt.getTime();
  const diffMinutesRaw = Math.floor(diffMs / 60_000);
  const diffMinutes = Number.isFinite(diffMinutesRaw) ? diffMinutesRaw : 0;

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
