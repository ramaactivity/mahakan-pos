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

/** Sesi AE-20 — calendar matrix view. Rows = employees, cols = dates,
 *  cell = status enum. Owner request: tabel jelas per-tanggal staff
 *  masuk/izin/cuti/off — supaya quick eyeball siapa bolong di hari mana. */
export type AttendanceDayStatus =
  /** Ada clock-in record. */
  | "hadir"
  /** Hadir tapi telat (lateMinutes > 0). */
  | "telat"
  /** Schedule day-off (libur kerja). */
  | "off"
  /** Schedule kerja, tidak ada record (alpa). */
  | "alpa"
  /** Sesi AE-61 — schedule kerja tapi tanggalnya masa depan (belum bisa
   *  dianggap alpa karena harinya belum tiba). Compared against server
   *  WIB "today". */
  | "upcoming"
  /** Tidak ada schedule + tidak ada record (no expectation). */
  | "kosong";

export interface AttendanceCalendarCell {
  status: AttendanceDayStatus;
  /** Filled untuk hadir/telat. */
  workMinutes?: number;
  lateMinutes?: number;
  overtimeMinutes?: number;
  /** Sesi AE-50 — info detail dari attendance_records untuk modal HR.
   * Semua optional karena kiosk/legacy records mungkin tidak punya. */
  clockInAt?: string | null;
  clockOutAt?: string | null;
  selfieDriveUrl?: string | null;
  /** Folder URL Drive `ABSENSI/{Nama}/{date}/` — HR klik buat browse
   * semua selfie hari itu (clock-in + clock-out). */
  selfieDriveFolderUrl?: string | null;
  gpsDistanceMeters?: number | null;
  /** Sesi AE-63 phase8 — needed by HR manual-edit dialog. NULL kalau
   * cell ga punya attendance record (status=off/alpa/kosong). */
  recordId?: string | null;
  isLate?: "yes" | "no" | "unknown" | null;
  /** Indicator HR sudah edit manual record ini. UI tampilkan badge "edited". */
  manualEditAt?: string | null;
  manualEditReason?: string | null;
}

export interface AttendanceCalendarRow {
  employeeId: string;
  employeeFullName: string;
  employeeNickname: string | null;
  employeePosition: string | null;
  /** Per-date map. Key = "YYYY-MM-DD". */
  days: Record<string, AttendanceCalendarCell>;
}

export interface AttendanceCalendar {
  rangeStart: string;
  rangeEnd: string;
  /** Inclusive list of dates in range, ordered. */
  dates: string[];
  rows: AttendanceCalendarRow[];
}
