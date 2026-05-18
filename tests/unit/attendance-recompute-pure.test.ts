import { describe, expect, it, vi } from "vitest";
import {
  deriveAttendanceMetrics,
  type DerivedMetrics,
} from "@/features/attendance/recompute-pure";

/**
 * Sesi AE-63 phase3 P3.4 — coverage untuk decision logic recompute
 * attendance (Charlotte case fix). Schedule deleted, dayOff, missing
 * startTime, dan active schedule semua harus map ke metrics yang benar.
 *
 * Compute helpers di-stub supaya isolated dari math correctness (sudah
 * punya test sendiri di late-compute / overtime-compute).
 */

const baseClockIn = new Date("2026-05-19T07:00:00+07:00");
const baseClockOut = new Date("2026-05-19T15:00:00+07:00");

function makeStubs(opts?: {
  lateMinutes?: number;
  isLate?: "yes" | "no";
  overtimeMinutes?: number;
}) {
  const lateMinutes = opts?.lateMinutes ?? 0;
  const overtimeMinutes = opts?.overtimeMinutes ?? 0;
  return {
    computeLate: vi.fn(() => ({
      isLate: opts?.isLate ?? (lateMinutes > 0 ? "yes" : "no"),
      lateMinutes,
      scheduledStartAt: new Date("2026-05-19T07:00:00+07:00"),
    })),
    computeOvertime: vi.fn(() => ({
      overtimeMinutes,
      scheduledEndAt: new Date("2026-05-19T15:00:00+07:00"),
      isOvernightSchedule: false,
    })),
  };
}

describe("deriveAttendanceMetrics — Charlotte recompute logic", () => {
  it("schedule deleted (null) → unknown / null / null", () => {
    const stubs = makeStubs();
    const out: DerivedMetrics = deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: null,
      clockInAt: baseClockIn,
      clockOutAt: baseClockOut,
      graceMinutes: 5,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(out).toEqual({
      isLate: "unknown",
      lateMinutes: null,
      overtimeMinutes: null,
    });
    /* Pure compute tidak boleh ke-call kalau schedule kosong. */
    expect(stubs.computeLate).not.toHaveBeenCalled();
    expect(stubs.computeOvertime).not.toHaveBeenCalled();
  });

  it("schedule.dayOff=true → unknown / null / null", () => {
    const stubs = makeStubs();
    const out = deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: { dayOff: true, startTime: null, endTime: null },
      clockInAt: baseClockIn,
      clockOutAt: baseClockOut,
      graceMinutes: 5,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(out.isLate).toBe("unknown");
    expect(out.lateMinutes).toBeNull();
    expect(out.overtimeMinutes).toBeNull();
    expect(stubs.computeLate).not.toHaveBeenCalled();
  });

  it("schedule.startTime null tanpa dayOff → unknown / null / null", () => {
    const stubs = makeStubs();
    const out = deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: { dayOff: false, startTime: null, endTime: "15:00:00" },
      clockInAt: baseClockIn,
      clockOutAt: baseClockOut,
      graceMinutes: 5,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(out.isLate).toBe("unknown");
    expect(out.lateMinutes).toBeNull();
    expect(out.overtimeMinutes).toBeNull();
    expect(stubs.computeLate).not.toHaveBeenCalled();
  });

  it("Charlotte case: schedule fixed 10:00→14:00, clock-in 12:41 → late metrics from compute helper", () => {
    const stubs = makeStubs({ isLate: "no", lateMinutes: 0 });
    const out = deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: {
        dayOff: false,
        startTime: "14:00:00",
        endTime: "22:00:00",
      },
      clockInAt: new Date("2026-05-19T12:41:00+07:00"),
      clockOutAt: null,
      graceMinutes: 5,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(out.isLate).toBe("no");
    expect(out.lateMinutes).toBe(0);
    /* Tanpa clockOut, OT compute tidak di-call. */
    expect(out.overtimeMinutes).toBeNull();
    expect(stubs.computeOvertime).not.toHaveBeenCalled();
    expect(stubs.computeLate).toHaveBeenCalledTimes(1);
  });

  it("active schedule + clock-out + end-time → OT compute called", () => {
    const stubs = makeStubs({
      isLate: "no",
      lateMinutes: 0,
      overtimeMinutes: 45,
    });
    const out = deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: {
        dayOff: false,
        startTime: "07:00:00",
        endTime: "15:00:00",
      },
      clockInAt: baseClockIn,
      clockOutAt: new Date("2026-05-19T15:45:00+07:00"),
      graceMinutes: 5,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(out.isLate).toBe("no");
    expect(out.lateMinutes).toBe(0);
    expect(out.overtimeMinutes).toBe(45);
    expect(stubs.computeOvertime).toHaveBeenCalledTimes(1);
  });

  it("clock-out exists tapi endTime null → OT compute SKIP (null)", () => {
    const stubs = makeStubs({ isLate: "yes", lateMinutes: 20 });
    const out = deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: {
        dayOff: false,
        startTime: "07:00:00",
        endTime: null, // <-- no end time
      },
      clockInAt: baseClockIn,
      clockOutAt: baseClockOut,
      graceMinutes: 5,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(out.isLate).toBe("yes");
    expect(out.lateMinutes).toBe(20);
    expect(out.overtimeMinutes).toBeNull();
    expect(stubs.computeOvertime).not.toHaveBeenCalled();
  });

  it("late + OT both positive → returned via compute helpers", () => {
    const stubs = makeStubs({
      isLate: "yes",
      lateMinutes: 30,
      overtimeMinutes: 60,
    });
    const out = deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: {
        dayOff: false,
        startTime: "07:00:00",
        endTime: "15:00:00",
      },
      clockInAt: new Date("2026-05-19T07:30:00+07:00"),
      clockOutAt: new Date("2026-05-19T16:00:00+07:00"),
      graceMinutes: 5,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(out).toEqual({
      isLate: "yes",
      lateMinutes: 30,
      overtimeMinutes: 60,
    });
  });

  it("grace + late minutes passed through to compute helper", () => {
    const stubs = makeStubs({ isLate: "no", lateMinutes: 0 });
    deriveAttendanceMetrics({
      shiftDate: "2026-05-19",
      newSchedule: {
        dayOff: false,
        startTime: "07:00:00",
        endTime: "15:00:00",
      },
      clockInAt: baseClockIn,
      clockOutAt: null,
      graceMinutes: 10,
      computeLate: stubs.computeLate,
      computeOvertime: stubs.computeOvertime,
    });
    expect(stubs.computeLate).toHaveBeenCalledWith(
      expect.objectContaining({
        shiftDate: "2026-05-19",
        scheduledStartTime: "07:00:00",
        scheduledEndTime: "15:00:00",
        graceMinutes: 10,
      }),
    );
  });
});
