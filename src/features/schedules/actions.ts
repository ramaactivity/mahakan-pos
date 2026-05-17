"use server";

import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { employeeSchedules, employees, payrollPeriods } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  fetchActiveEmployeesForOutlet,
  fetchSchedules,
} from "./queries";
import { listSchedulesSchema, upsertScheduleSchema } from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type EmployeeSchedule,
  type ScheduleWithEmployee,
  type UpsertScheduleInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listSchedules(opts: {
  from: string;
  to: string;
  employeeId?: string;
}): Promise<ApiResult<ScheduleWithEmployee[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "schedule.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat jadwal");
  }
  const parsed = listSchedulesSchema.safeParse(opts);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Filter tidak valid",
    );
  }
  return ok(
    await fetchSchedules({
      ...parsed.data,
      outletId: session.user.outletId,
    }),
  );
}

/**
 * Sesi AD-12 — staff-scoped read. Returns ONLY the calling user's own
 * schedule for a given week. No `schedule.view` admin permission check —
 * any authenticated user can see their own jadwal di /m/jadwal.
 *
 * Maps session.user.id → employees.userId → employeeSchedules. If the
 * user record isn't linked to an employee row, returns NOT_LINKED so
 * the UI can show a helpful "minta owner link akun-mu" state.
 */
export async function getMyScheduleWeek(input: {
  weekStart: string;
}): Promise<
  ApiResult<{
    employeeName: string;
    weekStart: string;
    weekEnd: string;
    entries: EmployeeSchedule[];
  }>
> {
  const session = await requireSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart)) {
    return fail("VALIDATION_ERROR", "Format tanggal minggu tidak valid");
  }

  const [emp] = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      nickname: employees.nickname,
      outletId: employees.outletId,
    })
    .from(employees)
    .where(
      and(
        eq(employees.userId, session.user.id),
        isNull(employees.deletedAt),
      ),
    )
    .limit(1);

  if (!emp) {
    return fail(
      "NOT_LINKED",
      "Akun kamu belum di-link ke data karyawan. Minta owner / manager link dulu di Back Office.",
    );
  }
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Outlet tidak cocok");
  }

  // Compute week end (start + 6 days), all UTC date math on YYYY-MM-DD.
  const start = new Date(`${input.weekStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.employeeId, emp.id),
        gte(employeeSchedules.scheduleDate, input.weekStart),
        lte(employeeSchedules.scheduleDate, weekEnd),
      ),
    )
    .orderBy(asc(employeeSchedules.scheduleDate));

  return ok({
    employeeName: emp.nickname ?? emp.fullName,
    weekStart: input.weekStart,
    weekEnd,
    entries: rows,
  });
}

export async function listActiveEmployees(): Promise<
  ApiResult<
    Array<{
      id: string;
      fullName: string;
      nickname: string | null;
      position: string | null;
    }>
  >
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "schedule.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat jadwal");
  }
  return ok(await fetchActiveEmployeesForOutlet(session.user.outletId));
}

// ---------- Mutations ----------

/** Idempotent — if a row already exists for (employee, date), update it
 * in place; else insert. Lets the planner UI just "save" each cell. */
export async function upsertSchedule(
  input: UpsertScheduleInput,
): Promise<ApiResult<EmployeeSchedule>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "schedule.update")) {
    return fail("FORBIDDEN", "Tidak punya hak set jadwal");
  }

  const parsed = upsertScheduleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, v.employeeId))
    .limit(1);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }

  // Sesi AE-62i — block edit jadwal yang fall di periode payroll yang sudah
  // finalize/paid. Sebelumnya: owner bisa retroactively edit jadwal lama →
  // attendance vs schedule audit trail rusak, payroll pakai numbers berbeda
  // dari current state → reconciliation broken.
  const lockedPeriods = await db
    .select({
      id: payrollPeriods.id,
      status: payrollPeriods.status,
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
    })
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.outletId, session.user.outletId),
        inArray(payrollPeriods.status, ["finalized", "paid"]),
        lte(payrollPeriods.periodStart, v.scheduleDate),
        gte(payrollPeriods.periodEnd, v.scheduleDate),
      ),
    )
    .limit(1);
  if (lockedPeriods.length > 0) {
    const p = lockedPeriods[0];
    return fail(
      "PAYROLL_PERIOD_LOCKED",
      `Jadwal ${v.scheduleDate} masuk periode payroll ${p.periodStart}..${p.periodEnd} yang sudah ${p.status}. Tidak boleh diedit retroaktif.`,
    );
  }

  const [existing] = await db
    .select()
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.employeeId, v.employeeId),
        eq(employeeSchedules.scheduleDate, v.scheduleDate),
      ),
    )
    .limit(1);

  let row: EmployeeSchedule;
  if (existing) {
    [row] = await db
      .update(employeeSchedules)
      .set({
        startTime: v.startTime,
        endTime: v.endTime,
        dayOff: v.dayOff,
        notes: v.notes,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(eq(employeeSchedules.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(employeeSchedules)
      .values({
        outletId: session.user.outletId,
        employeeId: v.employeeId,
        scheduleDate: v.scheduleDate,
        startTime: v.startTime,
        endTime: v.endTime,
        dayOff: v.dayOff,
        notes: v.notes,
        createdBy: session.user.id,
      })
      .returning();
  }

  logAudit({
    eventType: "schedule.upsert",
    userId: session.user.id,
    entityType: "schedule",
    entityId: row.id,
    payload: {
      summary: `Jadwal ${emp.fullName} ${row.scheduleDate} ${row.dayOff ? "OFF" : `${row.startTime}–${row.endTime}`}`,
      after: {
        employeeId: emp.id,
        scheduleDate: row.scheduleDate,
        dayOff: row.dayOff,
        startTime: row.startTime,
        endTime: row.endTime,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit schedule.upsert]", e));

  return ok(row);
}

export async function deleteSchedule(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "schedule.update")) {
    return fail("FORBIDDEN", "Tidak punya hak set jadwal");
  }
  const [row] = await db
    .select()
    .from(employeeSchedules)
    .where(eq(employeeSchedules.id, id))
    .limit(1);
  if (!row) return fail("NOT_FOUND", "Jadwal tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Jadwal dari outlet lain");
  }
  await db.delete(employeeSchedules).where(eq(employeeSchedules.id, id));
  return ok({ id });
}

/**
 * Sesi AE-53 — bulk assign template ke multiple employees + multiple dates.
 * HR ngomong: "saya mau apply Sore ke Galih + Parhan untuk Senin-Sabtu
 * sekaligus". Mode existing per-cell edit terlalu lambat.
 *
 * Skip dates yang sudah punya schedule (jangan overwrite — defensive).
 * Owner clear manual dulu kalau mau replace.
 *
 * Permission: schedule.update. Audit log fire dengan count created/skipped.
 */
export async function bulkAssignSchedule(input: {
  employeeIds: string[];
  /** Array of YYYY-MM-DD dates (caller decides which dates di range). */
  dates: string[];
  template:
    | { dayOff: true }
    | { dayOff: false; startTime: string; endTime: string };
  notes?: string | null;
}): Promise<ApiResult<{ created: number; skipped: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "schedule.update")) {
    return fail("FORBIDDEN", "Tidak punya hak set jadwal");
  }
  if (input.employeeIds.length === 0) {
    return fail("VALIDATION_ERROR", "Pilih minimal 1 karyawan");
  }
  if (input.dates.length === 0) {
    return fail("VALIDATION_ERROR", "Pilih minimal 1 tanggal");
  }
  if (input.dates.length > 62) {
    return fail("VALIDATION_ERROR", "Maksimal 62 tanggal per bulk apply");
  }
  if (input.employeeIds.length > 30) {
    return fail("VALIDATION_ERROR", "Maksimal 30 karyawan per bulk apply");
  }

  // Validate semua employees milik outlet user.
  const empRows = await db
    .select({ id: employees.id, outletId: employees.outletId })
    .from(employees)
    .where(inArray(employees.id, input.employeeIds));
  if (empRows.length !== input.employeeIds.length) {
    return fail("NOT_FOUND", "Sebagian karyawan tidak ditemukan");
  }
  for (const e of empRows) {
    if (e.outletId !== session.user.outletId) {
      return fail("FORBIDDEN", "Karyawan dari outlet lain");
    }
  }

  // Fetch existing schedules untuk skip dates yang sudah ada.
  const existingRows = await db
    .select({
      employeeId: employeeSchedules.employeeId,
      scheduleDate: employeeSchedules.scheduleDate,
    })
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.outletId, session.user.outletId),
        inArray(employeeSchedules.employeeId, input.employeeIds),
        inArray(employeeSchedules.scheduleDate, input.dates),
      ),
    );
  const existingKey = new Set(
    existingRows.map((r) => `${r.employeeId}::${r.scheduleDate}`),
  );

  const inserts: Array<typeof employeeSchedules.$inferInsert> = [];
  let skipped = 0;
  for (const empId of input.employeeIds) {
    for (const date of input.dates) {
      const key = `${empId}::${date}`;
      if (existingKey.has(key)) {
        skipped++;
        continue;
      }
      inserts.push({
        outletId: session.user.outletId,
        employeeId: empId,
        scheduleDate: date,
        startTime: input.template.dayOff ? null : input.template.startTime,
        endTime: input.template.dayOff ? null : input.template.endTime,
        dayOff: input.template.dayOff,
        notes: input.notes ?? null,
        createdBy: session.user.id,
      });
    }
  }

  if (inserts.length > 0) {
    await db.insert(employeeSchedules).values(inserts);
  }

  logAudit({
    eventType: "schedule.copy_week",
    userId: session.user.id,
    entityType: "schedule",
    entityId: null,
    payload: {
      summary: `Bulk assign ${input.employeeIds.length} karyawan × ${input.dates.length} hari: ${inserts.length} dibuat, ${skipped} dilewati`,
      context: {
        employeeCount: input.employeeIds.length,
        dateCount: input.dates.length,
        created: inserts.length,
        skipped,
        template: input.template,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit schedule.bulk_assign]", e));

  return ok({ created: inserts.length, skipped });
}

/** Bulk-copy a week's schedules from one start date to another (e.g.
 * copy last week → this week). Skips dates that already exist on the
 * target side; Owner can manually clear first if they want full
 * overwrite. */
export async function copyWeekSchedules(input: {
  fromStart: string;
  toStart: string;
}): Promise<ApiResult<{ copied: number; skipped: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "schedule.update")) {
    return fail("FORBIDDEN", "Tidak punya hak set jadwal");
  }

  const fromStart = new Date(input.fromStart);
  const toStart = new Date(input.toStart);
  if (isNaN(fromStart.getTime()) || isNaN(toStart.getTime())) {
    return fail("VALIDATION_ERROR", "Tanggal tidak valid");
  }
  const fromEnd = new Date(fromStart);
  fromEnd.setUTCDate(fromEnd.getUTCDate() + 6);
  const toEnd = new Date(toStart);
  toEnd.setUTCDate(toEnd.getUTCDate() + 6);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);

  const sourceRows = await db
    .select()
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.outletId, session.user.outletId),
        gte(employeeSchedules.scheduleDate, toIso(fromStart)),
        lte(employeeSchedules.scheduleDate, toIso(fromEnd)),
      ),
    );

  const existingTarget = await db
    .select({
      employeeId: employeeSchedules.employeeId,
      scheduleDate: employeeSchedules.scheduleDate,
    })
    .from(employeeSchedules)
    .where(
      and(
        eq(employeeSchedules.outletId, session.user.outletId),
        gte(employeeSchedules.scheduleDate, toIso(toStart)),
        lte(employeeSchedules.scheduleDate, toIso(toEnd)),
      ),
    );
  const existingKey = new Set(
    existingTarget.map((r) => `${r.employeeId}::${r.scheduleDate}`),
  );

  let copied = 0;
  let skipped = 0;
  const offsetDays =
    (toStart.getTime() - fromStart.getTime()) / (24 * 60 * 60 * 1000);

  const inserts: Array<typeof employeeSchedules.$inferInsert> = [];
  for (const src of sourceRows) {
    const targetDate = new Date(src.scheduleDate);
    targetDate.setUTCDate(targetDate.getUTCDate() + offsetDays);
    const key = `${src.employeeId}::${toIso(targetDate)}`;
    if (existingKey.has(key)) {
      skipped++;
      continue;
    }
    inserts.push({
      outletId: session.user.outletId,
      employeeId: src.employeeId,
      scheduleDate: toIso(targetDate),
      startTime: src.startTime,
      endTime: src.endTime,
      dayOff: src.dayOff,
      notes: src.notes,
      createdBy: session.user.id,
    });
    copied++;
  }
  if (inserts.length > 0) {
    await db.insert(employeeSchedules).values(inserts);
  }

  logAudit({
    eventType: "schedule.copy_week",
    userId: session.user.id,
    entityType: "schedule",
    entityId: input.toStart,
    payload: {
      summary: `Copy jadwal ${input.fromStart} → ${input.toStart}: ${copied} disalin, ${skipped} dilewati`,
      context: { copied, skipped, fromStart: input.fromStart, toStart: input.toStart },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit schedule.copy_week]", e));

  return ok({ copied, skipped });
}
