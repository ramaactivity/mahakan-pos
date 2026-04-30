"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employeeSchedules, employees } from "@/db/schema";
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
