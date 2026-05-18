import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, outlets } from "@/db/schema";
import { computeLateMinutes } from "./late-compute";
import { computeOvertimeMinutes } from "./overtime-compute";
import { deriveAttendanceMetrics } from "./recompute-pure";

/**
 * Sesi AE-62ab — recompute late + overtime untuk attendance_records yang
 * terdampak ketika schedule di-edit retroactively.
 *
 * Use case: HR salah input jadwal Charlotte (10:00 padahal seharusnya
 * 14:00). Charlotte sudah clock-in jam 12:41 → flagged "telat 2h 41m"
 * (correct vs schedule lama). HR fix schedule → 14:00. Tanpa recompute,
 * record tetap "telat 2h 41m" (stale). Sekarang: setelah schedule edit,
 * caller wajib panggil helper ini supaya attendance records sinkron.
 *
 * Behavior:
 *   - newSchedule.dayOff = true → set isLate='unknown', lateMinutes=null,
 *     overtimeMinutes=null (no schedule = no metrics).
 *   - newSchedule has start+end + non-dayOff → recompute via pure helpers
 *     (computeLateMinutes + computeOvertimeMinutes). Sama logic dengan
 *     clock-in/clock-out path.
 *   - newSchedule = null (deleted) → also unknown (no schedule).
 *
 * Multi-record handling: 1 employee + 1 shiftDate biasanya 1 record. Tapi
 * defensive: kalau ada multiple (edge: re-clock-in after manual fix),
 * loop semua.
 */
export interface RecomputeResult {
  recomputedCount: number;
  records: Array<{
    recordId: string;
    isLateBefore: string | null;
    isLateAfter: string;
    lateMinutesBefore: number | null;
    lateMinutesAfter: number | null;
    overtimeMinutesBefore: number | null;
    overtimeMinutesAfter: number | null;
  }>;
}

export interface RecomputeInput {
  outletId: string;
  employeeId: string;
  shiftDate: string;
  /** Updated schedule values. null kalau schedule deleted. */
  newSchedule: {
    dayOff: boolean;
    startTime: string | null;
    endTime: string | null;
  } | null;
}

export async function recomputeAttendanceForSchedule(
  input: RecomputeInput,
): Promise<RecomputeResult> {
  // Resolve outlet's lateGraceMinutes setting.
  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, input.outletId))
    .limit(1);
  const grace = (() => {
    const v = outletRow?.settings?.attendance?.lateGraceMinutes;
    if (typeof v === "number" && v >= 0 && v <= 60) return v;
    return 5;
  })();

  /* Sesi AE-62ag — outletId di-scope wajib di filter. Tanpa ini, edge case
   * employee yang pernah pindah outlet bisa overwrite attendance dari outlet
   * lain (employeeId stable across outlets — historical records di outlet
   * lama tetap ada). Constraint defensive walaupun schema biasanya 1 emp/outlet. */
  const records = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, input.outletId),
        eq(attendanceRecords.employeeId, input.employeeId),
        eq(attendanceRecords.shiftDate, input.shiftDate),
      ),
    );

  if (records.length === 0) {
    return { recomputedCount: 0, records: [] };
  }

  const result: RecomputeResult = { recomputedCount: 0, records: [] };
  for (const rec of records) {
    /* Sesi AE-63 phase3 P3.4 — decision logic dipindah ke pure helper
     * `deriveAttendanceMetrics` supaya bisa di-unit-test tanpa DB. Pre-fix:
     * 3 branch (schedule null / dayOff / active) di-inline → coverage
     * sulit + duplikasi risk kalau ada caller lain. */
    const derived = deriveAttendanceMetrics({
      shiftDate: input.shiftDate,
      newSchedule: input.newSchedule,
      clockInAt: rec.clockInAt,
      clockOutAt: rec.clockOutAt,
      graceMinutes: grace,
      computeLate: computeLateMinutes,
      computeOvertime: computeOvertimeMinutes,
    });

    const changed =
      rec.isLate !== derived.isLate ||
      rec.lateMinutes !== derived.lateMinutes ||
      rec.overtimeMinutes !== derived.overtimeMinutes;
    if (!changed) continue;

    await db
      .update(attendanceRecords)
      .set({
        isLate: derived.isLate,
        lateMinutes: derived.lateMinutes,
        overtimeMinutes: derived.overtimeMinutes,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecords.id, rec.id));

    result.records.push({
      recordId: rec.id,
      isLateBefore: rec.isLate,
      isLateAfter: derived.isLate,
      lateMinutesBefore: rec.lateMinutes,
      lateMinutesAfter: derived.lateMinutes,
      overtimeMinutesBefore: rec.overtimeMinutes,
      overtimeMinutesAfter: derived.overtimeMinutes,
    });
    result.recomputedCount += 1;
  }
  return result;
}
