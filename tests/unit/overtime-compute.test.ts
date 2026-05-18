import { describe, it, expect } from "vitest";
import { computeOvertimeMinutes } from "@/features/attendance/overtime-compute";

/**
 * Sesi AE-62aa — verify overtime cross-midnight fix.
 *
 * Pre-fix bug: schedule 14:00-22:00, clock-out 01:00 next-day → 0 OT
 * (returned -1260 min via minutesIntoWibDay, then max(0,_) = 0).
 * Real OT should be 180 min (3 jam past scheduled end).
 */

function wibDate(iso: string): Date {
  return new Date(iso);
}

describe("computeOvertimeMinutes — sesi AE-62aa", () => {
  it("normal day, on-time clock-out → 0 OT", () => {
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      scheduledEndTime: "22:00",
      clockOutAt: wibDate("2026-05-20T22:00:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(0);
    expect(res.isOvernightSchedule).toBe(false);
  });

  it("normal day, late clock-out same-day → positive OT", () => {
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      scheduledEndTime: "22:00",
      clockOutAt: wibDate("2026-05-20T23:30:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(90);
    expect(res.isOvernightSchedule).toBe(false);
  });

  it("CASE BUG PRE-FIX: normal day, clock-out past midnight → 180 OT", () => {
    // Schedule end 22:00, actual clock-out 01:00 next day = 3h OT.
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      scheduledEndTime: "22:00",
      clockOutAt: wibDate("2026-05-21T01:00:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(180);
    expect(res.isOvernightSchedule).toBe(false);
  });

  it("normal day, clock-out 03:00 next-day → 300 OT (5h)", () => {
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      scheduledEndTime: "22:00",
      clockOutAt: wibDate("2026-05-21T03:00:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(300);
  });

  it("overnight schedule, on-time → 0 OT", () => {
    // Bar: 22:00 → 06:00. Clock-out at 06:00 next-day = exact, 0 OT.
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "22:00",
      scheduledEndTime: "06:00",
      clockOutAt: wibDate("2026-05-21T06:00:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(0);
    expect(res.isOvernightSchedule).toBe(true);
  });

  it("overnight schedule, late next-morning → OT", () => {
    // Bar: 22:00 → 06:00. Clock-out 07:30 next-day = 90 min OT.
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "22:00",
      scheduledEndTime: "06:00",
      clockOutAt: wibDate("2026-05-21T07:30:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(90);
    expect(res.isOvernightSchedule).toBe(true);
  });

  it("early clock-out → 0 OT (no negative)", () => {
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      scheduledEndTime: "22:00",
      clockOutAt: wibDate("2026-05-20T20:00:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(0);
  });

  it("overnight schedule, early clock-out (before midnight) → 0 OT", () => {
    // Bar: 22:00 → 06:00. Clock-out 23:00 same day = 7h early, 0 OT.
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "22:00",
      scheduledEndTime: "06:00",
      clockOutAt: wibDate("2026-05-20T23:00:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(0);
  });

  it("normal day, exact 1-minute past end → 1 min OT", () => {
    const res = computeOvertimeMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      scheduledEndTime: "22:00",
      clockOutAt: wibDate("2026-05-20T22:01:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(1);
  });

  it("month boundary: shift 2026-04-30 22:00, clock-out 2026-05-01 02:00", () => {
    // Schedule normal-day 14:00-22:00 di 30 April. Clock-out 02:00 1 Mei.
    const res = computeOvertimeMinutes({
      shiftDate: "2026-04-30",
      scheduledStartTime: "14:00",
      scheduledEndTime: "22:00",
      clockOutAt: wibDate("2026-05-01T02:00:00+07:00"),
    });
    expect(res.overtimeMinutes).toBe(240);
  });
});
