"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeAdvances,
  employees,
  payrollPeriods,
  users,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  createEmployeeAdvanceSchema,
  forgiveEmployeeAdvanceSchema,
} from "@/features/payroll/schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreateEmployeeAdvanceInput,
  type EmployeeAdvance,
  type EmployeeAdvanceWithEmployee,
  type ListEmployeeAdvancesOptions,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/* Sesi AE-60 — Buat kasbon baru. Status default 'pending'. Saat next
 * payroll compute, akan auto-link ke periode tersebut. */
export async function createEmployeeAdvance(
  input: CreateEmployeeAdvanceInput,
): Promise<ApiResult<EmployeeAdvance>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak buat kasbon");
  }
  const parsed = createEmployeeAdvanceSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const v = parsed.data;

  // Validate employee belongs to outlet + active
  const [emp] = await db
    .select({ id: employees.id, fullName: employees.fullName, outletId: employees.outletId, status: employees.status })
    .from(employees)
    .where(eq(employees.id, v.employeeId))
    .limit(1);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }
  if (emp.status !== "active") {
    return fail(
      "EMPLOYEE_INACTIVE",
      "Karyawan non-aktif tidak bisa di-kasih kasbon",
    );
  }

  const [created] = await db
    .insert(employeeAdvances)
    .values({
      outletId: session.user.outletId,
      employeeId: v.employeeId,
      amount: v.amount,
      reason: v.reason ?? null,
      issuedDate: v.issuedDate,
      status: "pending",
      createdBy: session.user.id,
    })
    .returning();

  logAudit({
    eventType: "advance.create",
    userId: session.user.id,
    entityType: "employee_advance",
    entityId: created.id,
    payload: {
      summary: `Kasbon Rp ${v.amount.toLocaleString("id-ID")} untuk ${emp.fullName}`,
      after: {
        employeeId: v.employeeId,
        employeeName: emp.fullName,
        amount: v.amount,
        reason: v.reason,
        issuedDate: v.issuedDate,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit advance.create]", e));

  return ok(created);
}

/* Sesi AE-60 — Forgive (maafkan) kasbon. Status pending → forgiven.
 * Tidak akan dipotong dari payroll. */
export async function forgiveEmployeeAdvance(
  id: string,
): Promise<ApiResult<EmployeeAdvance>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak forgive kasbon");
  }
  const parsed = forgiveEmployeeAdvanceSchema.safeParse({ id });
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }

  const [current] = await db
    .select()
    .from(employeeAdvances)
    .where(eq(employeeAdvances.id, id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Kasbon tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Kasbon dari outlet lain");
  }
  if (current.status !== "pending") {
    return fail(
      "INVALID_STATE",
      "Hanya kasbon status 'pending' yang bisa di-forgive",
    );
  }

  const [updated] = await db
    .update(employeeAdvances)
    .set({
      status: "forgiven",
      resolvedAt: new Date(),
      resolvedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(employeeAdvances.id, id))
    .returning();

  logAudit({
    eventType: "advance.forgive",
    userId: session.user.id,
    entityType: "employee_advance",
    entityId: id,
    payload: {
      summary: `Kasbon Rp ${Number(current.amount).toLocaleString("id-ID")} di-forgive`,
      before: { status: current.status },
      after: { status: "forgiven" },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit advance.forgive]", e));

  return ok(updated);
}

export async function listEmployeeAdvances(
  options: ListEmployeeAdvancesOptions = {},
): Promise<ApiResult<EmployeeAdvanceWithEmployee[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat kasbon");
  }
  const limit = options.limit ?? 100;
  const conds = [eq(employeeAdvances.outletId, session.user.outletId)];
  if (options.employeeId) {
    conds.push(eq(employeeAdvances.employeeId, options.employeeId));
  }
  if (options.status && options.status !== "all") {
    conds.push(eq(employeeAdvances.status, options.status));
  }

  const rows = await db
    .select({
      advance: employeeAdvances,
      employeeName: employees.fullName,
    })
    .from(employeeAdvances)
    .innerJoin(employees, eq(employees.id, employeeAdvances.employeeId))
    .where(and(...conds))
    .orderBy(desc(employeeAdvances.createdAt))
    .limit(limit);

  if (rows.length === 0) return ok([]);

  // Resolve creator + resolver names + period labels in batch
  const userIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        [r.advance.createdBy, r.advance.resolvedBy].filter(
          (x): x is string => Boolean(x),
        ),
      ),
    ),
  );
  const userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) userMap.set(u.id, u.name);
  }

  const periodIds = Array.from(
    new Set(
      rows
        .map((r) => r.advance.deductedFromPeriodId)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const periodMap = new Map<string, string>();
  if (periodIds.length > 0) {
    const periodRows = await db
      .select({ id: payrollPeriods.id, label: payrollPeriods.label })
      .from(payrollPeriods)
      .where(inArray(payrollPeriods.id, periodIds));
    for (const p of periodRows) periodMap.set(p.id, p.label);
  }

  const result: EmployeeAdvanceWithEmployee[] = rows.map((r) => ({
    ...r.advance,
    employeeName: r.employeeName,
    createdByName: userMap.get(r.advance.createdBy) ?? null,
    resolvedByName: r.advance.resolvedBy
      ? (userMap.get(r.advance.resolvedBy) ?? null)
      : null,
    deductedFromPeriodLabel: r.advance.deductedFromPeriodId
      ? (periodMap.get(r.advance.deductedFromPeriodId) ?? null)
      : null,
  }));

  return ok(result);
}
