import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, outlets } from "@/db/schema";
import { computeLateMinutes } from "./late-compute";
import { computeOvertimeMinutes } from "./overtime-compute";

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
    let newIsLate: "yes" | "no" | "unknown" = "unknown";
    let newLateMinutes: number | null = null;
    let newOvertimeMinutes: number | null = null;

    /* Case 1: schedule deleted OR dayOff → no metrics. */
    if (
      !input.newSchedule ||
      input.newSchedule.dayOff ||
      !input.newSchedule.startTime
    ) {
      newIsLate = "unknown";
      newLateMinutes = null;
      newOvertimeMinutes = null;
    } else {
      /* Case 2: active schedule. Re-derive late + OT. */
      const lateRes = computeLateMinutes({
        shiftDate: input.shiftDate,
        scheduledStartTime: input.newSchedule.startTime,
        scheduledEndTime: input.newSchedule.endTime ?? null,
        clockInAt: rec.clockInAt,
        graceMinutes: grace,
      });
      newIsLate = lateRes.isLate;
      newLateMinutes = lateRes.lateMinutes;

      /* Overtime — hanya kalau record sudah clock-out + ada end time. */
      if (rec.clockOutAt && input.newSchedule.endTime) {
        const otRes = computeOvertimeMinutes({
          shiftDate: input.shiftDate,
          scheduledStartTime: input.newSchedule.startTime,
          scheduledEndTime: input.newSchedule.endTime,
          clockOutAt: rec.clockOutAt,
        });
        newOvertimeMinutes = otRes.overtimeMinutes;
      }
    }

    const changed =
      rec.isLate !== newIsLate ||
      rec.lateMinutes !== newLateMinutes ||
      rec.overtimeMinutes !== newOvertimeMinutes;
    if (!changed) continue;

    await db
      .update(attendanceRecords)
      .set({
        isLate: newIsLate,
        lateMinutes: newLateMinutes,
        overtimeMinutes: newOvertimeMinutes,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecords.id, rec.id));

    result.records.push({
      recordId: rec.id,
      isLateBefore: rec.isLate,
      isLateAfter: newIsLate,
      lateMinutesBefore: rec.lateMinutes,
      lateMinutesAfter: newLateMinutes,
      overtimeMinutesBefore: rec.overtimeMinutes,
      overtimeMinutesAfter: newOvertimeMinutes,
    });
    result.recomputedCount += 1;
  }
  return result;
}
