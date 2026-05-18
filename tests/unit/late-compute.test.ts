import { describe, it, expect } from "vitest";
import { computeLateMinutes } from "@/features/attendance/late-compute";

function wibDate(iso: string): Date {
  return new Date(iso);
}

describe("computeLateMinutes — sesi AE-62ab", () => {
  it("clock-in early → not late, 0 min", () => {
    const res = computeLateMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      clockInAt: wibDate("2026-05-20T13:30:00+07:00"),
      graceMinutes: 5,
    });
    expect(res.isLate).toBe("no");
    expect(res.lateMinutes).toBe(0);
  });

  it("clock-in tepat waktu → not late", () => {
    const res = computeLateMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      clockInAt: wibDate("2026-05-20T14:00:00+07:00"),
      graceMinutes: 5,
    });
    expect(res.isLate).toBe("no");
    expect(res.lateMinutes).toBe(0);
  });

  it("clock-in within grace (3 menit) → not late", () => {
    const res = computeLateMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      clockInAt: wibDate("2026-05-20T14:03:00+07:00"),
      graceMinutes: 5,
    });
    expect(res.isLate).toBe("no");
    expect(res.lateMinutes).toBe(3);
  });

  it("clock-in past grace → late dengan menit aktual", () => {
    // 30 menit telat
    const res = computeLateMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      clockInAt: wibDate("2026-05-20T14:30:00+07:00"),
      graceMinutes: 5,
    });
    expect(res.isLate).toBe("yes");
    expect(res.lateMinutes).toBe(30);
  });

  it("CASE BUG (Charlotte): clock-in 12:41, schedule 10:00 → late 161 min", () => {
    const res = computeLateMinutes({
      shiftDate: "2026-05-18",
      scheduledStartTime: "10:00",
      clockInAt: wibDate("2026-05-18T12:41:00+07:00"),
      graceMinutes: 5,
    });
    expect(res.isLate).toBe("yes");
    expect(res.lateMinutes).toBe(161);
  });

  it("AFTER schedule fix (Charlotte case fixed): schedule moved to 14:00 → not late", () => {
    // Schedule diubah jadi 14:00, clock-in 12:41 = 79 min early → not late.
    const res = computeLateMinutes({
      shiftDate: "2026-05-18",
      scheduledStartTime: "14:00",
      clockInAt: wibDate("2026-05-18T12:41:00+07:00"),
      graceMinutes: 5,
    });
    expect(res.isLate).toBe("no");
    expect(res.lateMinutes).toBe(0);
  });

  it("grace 0 (strict) — exact-time clock-in → not late", () => {
    const res = computeLateMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      clockInAt: wibDate("2026-05-20T14:00:00+07:00"),
      graceMinutes: 0,
    });
    expect(res.isLate).toBe("no");
    expect(res.lateMinutes).toBe(0);
  });

  it("grace 0 — 1 menit late → late 1", () => {
    const res = computeLateMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "14:00",
      clockInAt: wibDate("2026-05-20T14:01:00+07:00"),
      graceMinutes: 0,
    });
    expect(res.isLate).toBe("yes");
    expect(res.lateMinutes).toBe(1);
  });

  it("overnight schedule shouldn't affect lateness (start time only)", () => {
    // Bar shift 22:00 → 06:00. Clock-in 22:15 → late 15 min (past grace 5).
    const res = computeLateMinutes({
      shiftDate: "2026-05-20",
      scheduledStartTime: "22:00",
      scheduledEndTime: "06:00",
      clockInAt: wibDate("2026-05-20T22:15:00+07:00"),
      graceMinutes: 5,
    });
    expect(res.isLate).toBe("yes");
    expect(res.lateMinutes).toBe(15);
  });
});
