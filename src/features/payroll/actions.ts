"use server";

import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecords,
  employees,
  payrollLines,
  payrollPeriods,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  createPayrollPeriodSchema,
  updatePayrollLineSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreatePayrollPeriodInput,
  type PayrollLine,
  type PayrollLineWithEmployee,
  type PayrollPeriod,
  type PayrollPeriodWithStats,
  type UpdatePayrollLineInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

function recomputeGrossNet(line: {
  baseSalary: number;
  overtimePay: number;
  lateDeduction: number;
  bonus: number;
  otherDeductions: number;
}): { grossPay: number; netPay: number } {
  const grossPay = line.baseSalary + line.overtimePay + line.bonus;
  const netPay = Math.max(0, grossPay - line.lateDeduction - line.otherDeductions);
  return { grossPay, netPay };
}

// ---------- Reads ----------

export async function listPayrollPeriods(): Promise<
  ApiResult<PayrollPeriodWithStats[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat payroll");
  }
  const rows = await db
    .select({
      period: payrollPeriods,
      lineCount: sql<number>`(
        SELECT count(*)::int FROM ${payrollLines}
        WHERE ${payrollLines.periodId} = ${payrollPeriods.id}
      )`,
      netPayTotal: sql<number>`(
        SELECT COALESCE(SUM(${payrollLines.netPay})::bigint, 0) FROM ${payrollLines}
        WHERE ${payrollLines.periodId} = ${payrollPeriods.id}
      )`,
    })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.outletId, session.user.outletId))
    .orderBy(desc(payrollPeriods.periodStart));
  return ok(
    rows.map((r) => ({
      ...r.period,
      lineCount: r.lineCount,
      netPayTotal: Number(r.netPayTotal),
    })),
  );
}

export async function listPayrollLines(
  periodId: string,
): Promise<ApiResult<PayrollLineWithEmployee[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat payroll");
  }
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Period tidak ditemukan");
  if (period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period dari outlet lain");
  }
  const rows = await db
    .select({
      line: payrollLines,
      employeeFullName: employees.fullName,
      employeeNickname: employees.nickname,
      employeePosition: employees.position,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(payrollLines.employeeId, employees.id))
    .where(eq(payrollLines.periodId, periodId))
    .orderBy(asc(employees.fullName));
  return ok(
    rows.map((r) => ({
      ...r.line,
      employeeFullName: r.employeeFullName,
      employeeNickname: r.employeeNickname,
      employeePosition: r.employeePosition,
    })),
  );
}

// ---------- Mutations ----------

export async function createPayrollPeriod(
  input: CreatePayrollPeriodInput,
): Promise<ApiResult<PayrollPeriod>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak buat periode payroll");
  }
  const parsed = createPayrollPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  if (v.periodEnd < v.periodStart) {
    return fail("VALIDATION_ERROR", "period_end harus >= period_start");
  }
  const [row] = await db
    .insert(payrollPeriods)
    .values({
      outletId: session.user.outletId,
      label: v.label,
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
      notes: v.notes,
      createdBy: session.user.id,
    })
    .returning();

  logAudit({
    eventType: "payroll.period.create",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: row.id,
    payload: {
      summary: `Periode payroll baru: ${row.label} (${row.periodStart} → ${row.periodEnd})`,
      after: {
        label: row.label,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.period.create]", e));

  return ok(row);
}

/**
 * Recompute payroll lines for a period from attendance + employee
 * salaries. Wipes existing draft lines first; refuses to recompute
 * finalized periods.
 */
export async function computePayrollLines(
  periodId: string,
): Promise<ApiResult<{ lineCount: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak compute payroll");
  }

  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Period tidak ditemukan");
  if (period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period dari outlet lain");
  }
  if (period.status !== "draft") {
    return fail(
      "PERIOD_NOT_DRAFT",
      "Period sudah finalize/paid — tidak bisa recompute",
    );
  }

  // Aggregate attendance per employee within the period bounds.
  const aggregates = await db
    .select({
      employeeId: attendanceRecords.employeeId,
      workDays: sql<number>`COUNT(DISTINCT ${attendanceRecords.shiftDate})::int`,
      totalWorkMinutes: sql<number>`COALESCE(SUM(${attendanceRecords.workMinutes}), 0)::int`,
      totalLateMinutes: sql<number>`COALESCE(SUM(${attendanceRecords.lateMinutes}), 0)::int`,
      totalOvertimeMinutes: sql<number>`COALESCE(SUM(${attendanceRecords.overtimeMinutes}), 0)::int`,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.outletId, session.user.outletId),
        gte(attendanceRecords.shiftDate, period.periodStart),
        lte(attendanceRecords.shiftDate, period.periodEnd),
      ),
    )
    .groupBy(attendanceRecords.employeeId);

  // All active employees (so we generate lines even for those with no
  // attendance in the period — Owner can adjust manually).
  const allEmployees = await db
    .select({
      id: employees.id,
      salaryAmount: employees.salaryAmount,
    })
    .from(employees)
    .where(
      and(
        eq(employees.outletId, session.user.outletId),
        isNull(employees.deletedAt),
      ),
    );

  const aggMap = new Map(aggregates.map((a) => [a.employeeId, a]));

  // Wipe + reinsert atomically.
  await db.transaction(async (tx) => {
    await tx.delete(payrollLines).where(eq(payrollLines.periodId, periodId));

    if (allEmployees.length === 0) return;

    const inserts = allEmployees.map((emp) => {
      const agg = aggMap.get(emp.id);
      const baseSalary = emp.salaryAmount ?? 0;
      const totalLateMinutes = agg?.totalLateMinutes ?? 0;
      const totalOvertimeMinutes = agg?.totalOvertimeMinutes ?? 0;
      // Naive defaults — Owner edits via UpdatePayrollLine if rule
      // engine doesn't match. Late deduction = 0 (Owner usually
      // applies own policy). Overtime pay = 0 (same).
      const overtimePay = 0;
      const lateDeduction = 0;
      const bonus = 0;
      const otherDeductions = 0;
      const { grossPay, netPay } = recomputeGrossNet({
        baseSalary,
        overtimePay,
        lateDeduction,
        bonus,
        otherDeductions,
      });
      return {
        periodId,
        employeeId: emp.id,
        baseSalary,
        workDays: agg?.workDays ?? 0,
        totalWorkMinutes: agg?.totalWorkMinutes ?? 0,
        totalLateMinutes,
        totalOvertimeMinutes,
        overtimePay,
        lateDeduction,
        bonus,
        otherDeductions,
        grossPay,
        netPay,
      };
    });
    await tx.insert(payrollLines).values(inserts);
  });

  logAudit({
    eventType: "payroll.compute",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: periodId,
    payload: {
      summary: `Recompute payroll ${period.label}: ${allEmployees.length} lines`,
      context: {
        lineCount: allEmployees.length,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.compute]", e));

  return ok({ lineCount: allEmployees.length });
}

export async function updatePayrollLine(
  input: UpdatePayrollLineInput,
): Promise<ApiResult<PayrollLine>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak edit payroll line");
  }
  const parsed = updatePayrollLineSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [current] = await db
    .select()
    .from(payrollLines)
    .where(eq(payrollLines.id, v.id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Line tidak ditemukan");

  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, current.periodId))
    .limit(1);
  if (!period || period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period bukan milik outlet ini");
  }
  if (period.status === "paid") {
    return fail(
      "PERIOD_LOCKED",
      "Period sudah dibayar — line tidak bisa diedit",
    );
  }
  if (period.status === "finalized" && session.user.role !== "owner") {
    return fail(
      "PERIOD_LOCKED",
      "Period sudah di-finalize — hanya Owner yang bisa edit",
    );
  }

  const next = {
    baseSalary: v.baseSalary ?? current.baseSalary,
    overtimePay: v.overtimePay ?? current.overtimePay,
    lateDeduction: v.lateDeduction ?? current.lateDeduction,
    bonus: v.bonus ?? current.bonus,
    otherDeductions: v.otherDeductions ?? current.otherDeductions,
  };
  const { grossPay, netPay } = recomputeGrossNet(next);

  const [row] = await db
    .update(payrollLines)
    .set({
      ...next,
      grossPay,
      netPay,
      notes: v.notes ?? current.notes,
      updatedAt: new Date(),
    })
    .where(eq(payrollLines.id, v.id))
    .returning();

  return ok(row);
}

export async function finalizePayrollPeriod(
  periodId: string,
): Promise<ApiResult<PayrollPeriod>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak finalize payroll");
  }
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Period tidak ditemukan");
  if (period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period dari outlet lain");
  }
  if (period.status !== "draft") {
    return fail("INVALID_STATE", "Hanya period draft yang bisa di-finalize");
  }
  const [row] = await db
    .update(payrollPeriods)
    .set({
      status: "finalized",
      finalizedAt: new Date(),
      finalizedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(payrollPeriods.id, periodId))
    .returning();

  logAudit({
    eventType: "payroll.finalize",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: periodId,
    payload: {
      summary: `Finalize payroll ${row.label}`,
      after: { status: "finalized", finalizedAt: row.finalizedAt },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.finalize]", e));

  return ok(row);
}

export async function markPayrollPaid(
  periodId: string,
): Promise<ApiResult<PayrollPeriod>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak mark paid");
  }
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Period tidak ditemukan");
  if (period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period dari outlet lain");
  }
  if (period.status !== "finalized") {
    return fail("INVALID_STATE", "Hanya period finalized yang bisa di-paid");
  }
  const [row] = await db
    .update(payrollPeriods)
    .set({
      status: "paid",
      paidAt: new Date(),
      paidBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(payrollPeriods.id, periodId))
    .returning();

  logAudit({
    eventType: "payroll.paid",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: periodId,
    payload: {
      summary: `Payroll ${row.label} ditandai paid`,
      after: { status: "paid", paidAt: row.paidAt },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.paid]", e));

  return ok(row);
}

export async function deletePayrollPeriod(
  periodId: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus period");
  }
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Period tidak ditemukan");
  if (period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period dari outlet lain");
  }
  if (period.status === "paid") {
    return fail(
      "PERIOD_LOCKED",
      "Period sudah dibayar — tidak bisa dihapus",
    );
  }
  await db.delete(payrollPeriods).where(eq(payrollPeriods.id, periodId));

  logAudit({
    eventType: "payroll.period.delete",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: periodId,
    payload: {
      summary: `Hapus periode payroll: ${period.label}`,
      before: { status: period.status },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.period.delete]", e));

  return ok({ id: periodId });
}
