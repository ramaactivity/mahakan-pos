"use server";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecords,
  bankAccounts,
  chartOfAccounts,
  employeeAdvances,
  employees,
  expenseCategories,
  expenses,
  journalEntries,
  journalLines,
  outlets,
  payrollLines,
  payrollPeriods,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { toJakartaDateOnly } from "@/lib/date";
import {
  applyThrSchema,
  computePayrollLinesSchema,
  createPayrollPeriodSchema,
  payrollPaymentSchema,
  updatePayrollLineSchema,
  updatePayrollPaymentSchema,
} from "./schemas";
import {
  computeBaseSalary,
  computeDoubleShiftBonus,
  computeThrSuggestion,
  countLinesWithManualEdits,
  planAdvanceDeductions,
  recomputeGrossNetV2,
  type PaymentType,
} from "./payroll-compute-pure";
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
import { BACKOFFICE_ORIGIN } from "@/features/cash/drawer-origin";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/* Sesi AE-60 — recomputeGrossNet legacy helper di-replace dengan
 * recomputeGrossNetV2 dari pure helper. Tidak ada caller yang masih
 * pakai legacy signature setelah refactor; existing call sites pakai V2
 * langsung. */

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
      employeePaymentType: employees.paymentType,
      employeeDailyRate: employees.dailyRate,
      employeeSalaryAmount: employees.salaryAmount,
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
      employeePaymentType: r.employeePaymentType as
        | "daily"
        | "monthly"
        | null,
      employeeDailyRate:
        r.employeeDailyRate == null ? null : Number(r.employeeDailyRate),
      employeeSalaryAmount:
        r.employeeSalaryAmount == null ? null : Number(r.employeeSalaryAmount),
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
/**
 * Sesi AE-60 — Compute payroll lines dari attendance + employee_advances.
 *
 * Behavior changes vs legacy:
 *  - Case-split paymentType: daily = dailyRate × workDays; monthly = salaryAmount flat.
 *  - Auto-link employee_advances status='pending' ke periode ini.
 *  - Recompute warning protection: kalau ada manual edits (bonus/thr/
 *    advance/otherDeductions > 0), require explicit `force=true`.
 *
 * Return shape:
 *  - `force=false` + ada manual edits: { needsConfirm: true, manualEditCount }
 *  - else: { lineCount, warnings }
 */
export interface ComputePayrollLinesResult {
  lineCount: number;
  /** Karyawan dengan masalah konfigurasi (mis. daily tanpa dailyRate). */
  warnings: Array<{ employeeName: string; message: string }>;
  /** Total kasbon yang ter-auto-link ke periode ini (Rp). */
  totalAdvancesLinked: number;
}

export interface ComputePayrollLinesPreview {
  needsConfirm: true;
  manualEditCount: number;
  totalLines: number;
}

export async function computePayrollLines(
  periodId: string,
  options: { force?: boolean } = {},
): Promise<ApiResult<ComputePayrollLinesResult | ComputePayrollLinesPreview>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak compute payroll");
  }
  const parsed = computePayrollLinesSchema.safeParse({
    periodId,
    force: options.force ?? false,
  });
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const force = parsed.data.force;

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

  // Sesi AE-60 — manual edit detection sebelum DELETE
  const existingLines = await db
    .select({
      bonus: payrollLines.bonus,
      thr: payrollLines.thr,
      advanceDeduction: payrollLines.advanceDeduction,
      otherDeductions: payrollLines.otherDeductions,
    })
    .from(payrollLines)
    .where(eq(payrollLines.periodId, periodId));
  const manualEditCount = countLinesWithManualEdits(existingLines);
  if (!force && manualEditCount > 0) {
    return ok({
      needsConfirm: true,
      manualEditCount,
      totalLines: existingLines.length,
    });
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

  // Outlet-level payroll formula rates (Sesi E + AE-60).
  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const latePerMinute = outletRow?.settings?.payroll?.latePerMinute ?? 0;
  const overtimePerMinute =
    outletRow?.settings?.payroll?.overtimePerMinute ?? 0;
  /* Sesi AE-62ac — double-shift bonus config. Null = feature off. */
  const doubleShiftConfig =
    outletRow?.settings?.payroll?.doubleShift ?? null;

  /* Sesi AE-62ac — also fetch per-day workMinutes per employee untuk
   * deteksi double-shift days. Tidak bisa derive dari totalWorkMinutes
   * agregat (need per-day breakdown). */
  const perDayAttendance = doubleShiftConfig
    ? await db
        .select({
          employeeId: attendanceRecords.employeeId,
          shiftDate: attendanceRecords.shiftDate,
          workMinutes: sql<number>`COALESCE(SUM(${attendanceRecords.workMinutes}), 0)::int`,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.outletId, session.user.outletId),
            gte(attendanceRecords.shiftDate, period.periodStart),
            lte(attendanceRecords.shiftDate, period.periodEnd),
          ),
        )
        .groupBy(attendanceRecords.employeeId, attendanceRecords.shiftDate)
    : [];
  const workMinutesByEmployee = new Map<string, number[]>();
  for (const r of perDayAttendance) {
    const arr = workMinutesByEmployee.get(r.employeeId) ?? [];
    arr.push(r.workMinutes);
    workMinutesByEmployee.set(r.employeeId, arr);
  }

  // All active employees (generate lines even untuk yang tidak attendance).
  const allEmployees = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      salaryAmount: employees.salaryAmount,
      paymentType: employees.paymentType,
      dailyRate: employees.dailyRate,
    })
    .from(employees)
    .where(
      and(
        eq(employees.outletId, session.user.outletId),
        isNull(employees.deletedAt),
      ),
    );

  // Sesi AE-60 — fetch pending advances per employee (auto-link)
  const pendingAdvances = await db
    .select({
      id: employeeAdvances.id,
      employeeId: employeeAdvances.employeeId,
      amount: employeeAdvances.amount,
      repaidAmount: employeeAdvances.repaidAmount,
    })
    .from(employeeAdvances)
    .where(
      and(
        eq(employeeAdvances.outletId, session.user.outletId),
        eq(employeeAdvances.status, "pending"),
        inArray(
          employeeAdvances.employeeId,
          allEmployees.map((e) => e.id),
        ),
      ),
    );
  /* Sesi AE-209 — yang dipotong gaji cuma SISA kasbon (nominal − cicilan
   * yang sudah disetor tunai/transfer). Logikanya di planAdvanceDeductions
   * supaya bisa dites tanpa DB. */
  const {
    sumByEmployee: advanceSumByEmployee,
    idsByEmployee: advanceIdsByEmployee,
  } = planAdvanceDeductions(
    pendingAdvances.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      amount: Number(a.amount),
      repaidAmount: Number(a.repaidAmount ?? 0),
    })),
  );

  const aggMap = new Map(aggregates.map((a) => [a.employeeId, a]));
  const warnings: Array<{ employeeName: string; message: string }> = [];

  // Wipe + reinsert atomically + mark advances deducted.
  let totalAdvancesLinked = 0;
  await db.transaction(async (tx) => {
    await tx.delete(payrollLines).where(eq(payrollLines.periodId, periodId));

    if (allEmployees.length === 0) return;

    const inserts = allEmployees.map((emp) => {
      const agg = aggMap.get(emp.id);
      const workDays = agg?.workDays ?? 0;
      const totalWorkMinutes = agg?.totalWorkMinutes ?? 0;
      const totalLateMinutes = agg?.totalLateMinutes ?? 0;
      const totalOvertimeMinutes = agg?.totalOvertimeMinutes ?? 0;

      // Sesi AE-60 — case-split paymentType
      const baseRes = computeBaseSalary({
        paymentType: emp.paymentType as PaymentType | null,
        salaryAmount: emp.salaryAmount ?? 0,
        dailyRate: emp.dailyRate,
        workDays,
      });
      if (baseRes.warning) {
        warnings.push({ employeeName: emp.fullName, message: baseRes.warning });
      }

      const overtimePay = totalOvertimeMinutes * overtimePerMinute;
      const lateDeduction = totalLateMinutes * latePerMinute;
      const advanceDeduction = advanceSumByEmployee.get(emp.id) ?? 0;
      totalAdvancesLinked += advanceDeduction;

      /* Sesi AE-62ac — auto-fill double-shift bonus. Pre-fix payroll
       * compute hardcode bonus=0 (owner manual entry). Sekarang kalau
       * outlet config doubleShift exists, helper compute bonus
       * berdasarkan attendance per-day workMinutes ≥ minMinutes.
       * Owner masih bisa override per line via updatePayrollLine
       * (manual edit). */
      const baseDailyForMultiplier =
        (emp.paymentType as PaymentType | null) === "daily"
          ? (emp.dailyRate ?? 0)
          : Math.round((emp.salaryAmount ?? 0) / 30);
      const dsResult = computeDoubleShiftBonus({
        workMinutesPerDay: workMinutesByEmployee.get(emp.id) ?? [],
        config: doubleShiftConfig,
        baseDailyAmount: baseDailyForMultiplier,
      });
      const doubleShiftBonus = dsResult.totalBonus;

      const { grossPay, netPay } = recomputeGrossNetV2({
        baseSalary: baseRes.baseSalary,
        overtimePay,
        bonus: doubleShiftBonus,
        thr: 0,
        lateDeduction,
        advanceDeduction,
        otherDeductions: 0,
      });
      return {
        periodId,
        employeeId: emp.id,
        baseSalary: baseRes.baseSalary,
        workDays,
        totalWorkMinutes,
        totalLateMinutes,
        totalOvertimeMinutes,
        overtimePay,
        lateDeduction,
        bonus: doubleShiftBonus,
        thr: 0,
        advanceDeduction,
        otherDeductions: 0,
        grossPay,
        netPay,
      };
    });
    await tx.insert(payrollLines).values(inserts);

    // Mark linked advances as deducted (atomic dengan compute)
    const allAdvanceIds = Array.from(advanceIdsByEmployee.values()).flat();
    if (allAdvanceIds.length > 0) {
      await tx
        .update(employeeAdvances)
        .set({
          status: "deducted",
          deductedFromPeriodId: periodId,
          resolvedAt: new Date(),
          resolvedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(inArray(employeeAdvances.id, allAdvanceIds));
    }
  });

  logAudit({
    eventType: "payroll.compute",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: periodId,
    payload: {
      summary: `Recompute payroll ${period.label}: ${allEmployees.length} lines${force ? " (force overwrite manual edits)" : ""}`,
      context: {
        lineCount: allEmployees.length,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        force,
        manualEditCountWiped: force ? manualEditCount : 0,
        totalAdvancesLinked,
        warningCount: warnings.length,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.compute]", e));

  return ok({
    lineCount: allEmployees.length,
    warnings,
    totalAdvancesLinked,
  });
}

/* Sesi AE-60 — Apply THR ke semua line di period. Set thr = baseSalary
 * × multiplier. Default multiplier dari outlet settings (1.0 fallback).
 * Period harus draft. */
export async function applyThr(
  input: { periodId: string; multiplier?: number },
): Promise<ApiResult<{ updatedCount: number; totalThr: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak apply THR");
  }
  const parsed = applyThrSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const { periodId, multiplier: explicitMultiplier } = parsed.data;

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
    return fail("PERIOD_NOT_DRAFT", "Period sudah finalize/paid");
  }

  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const settingMultiplier =
    outletRow?.settings?.payroll?.thrMonthlyBaseMultiplier;
  const multiplier =
    explicitMultiplier ??
    (typeof settingMultiplier === "number" && settingMultiplier > 0
      ? settingMultiplier
      : 1.0);

  const lines = await db
    .select()
    .from(payrollLines)
    .where(eq(payrollLines.periodId, periodId));

  let totalThr = 0;
  await db.transaction(async (tx) => {
    for (const line of lines) {
      const newThr = computeThrSuggestion(Number(line.baseSalary), multiplier);
      const { grossPay, netPay } = recomputeGrossNetV2({
        baseSalary: Number(line.baseSalary),
        overtimePay: Number(line.overtimePay),
        bonus: Number(line.bonus),
        thr: newThr,
        lateDeduction: Number(line.lateDeduction),
        advanceDeduction: Number(line.advanceDeduction),
        otherDeductions: Number(line.otherDeductions),
      });
      totalThr += newThr;
      await tx
        .update(payrollLines)
        .set({ thr: newThr, grossPay, netPay, updatedAt: new Date() })
        .where(eq(payrollLines.id, line.id));
    }
  });

  logAudit({
    eventType: "payroll.thr_applied",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: periodId,
    payload: {
      summary: `Apply THR period ${period.label}: ${lines.length} lines × ${multiplier}× = ${totalThr}`,
      context: {
        multiplier,
        lineCount: lines.length,
        totalThr,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.thr_applied]", e));

  return ok({ updatedCount: lines.length, totalThr });
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
    baseSalary: v.baseSalary ?? Number(current.baseSalary),
    overtimePay: v.overtimePay ?? Number(current.overtimePay),
    lateDeduction: v.lateDeduction ?? Number(current.lateDeduction),
    bonus: v.bonus ?? Number(current.bonus),
    /* Sesi AE-60 */
    thr: v.thr ?? Number(current.thr ?? 0),
    advanceDeduction:
      v.advanceDeduction ?? Number(current.advanceDeduction ?? 0),
    otherDeductions: v.otherDeductions ?? Number(current.otherDeductions),
  };

  // Sesi AE-62i — block advance deduction yang exceed grossPay. Pre-AE-62i
  // netPay = max(0, grossPay - deductions) cap di 0 tapi advance bisa exceed
  // gross → employee terima Rp 0 + masih "owes" sisa kasbon → labor law
  // violation + confused liability tracking. Owner harus split kasbon ke
  // multiple periods kalau gak muat.
  const grossPreview = next.baseSalary + next.overtimePay + next.bonus + next.thr;
  const grossAfterMandatory = Math.max(
    0,
    grossPreview - next.lateDeduction - next.otherDeductions,
  );
  if (next.advanceDeduction > grossAfterMandatory) {
    return fail(
      "ADVANCE_EXCEEDS_GROSS",
      `Potongan kasbon (Rp ${next.advanceDeduction.toLocaleString("id-ID")}) lebih besar dari gaji bersih sebelum kasbon (Rp ${grossAfterMandatory.toLocaleString("id-ID")}). Bagi kasbon ke periode berikut.`,
      "advanceDeduction",
    );
  }

  const { grossPay, netPay } = recomputeGrossNetV2(next);

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

  /* Sesi AE-124 — push notif HR + Finance bahwa payroll siap kirim slip.
   * Honor quiet hours + snooze. Fire-and-forget. */
  void (async () => {
    try {
      const { sendCategorizedPush } = await import(
        "@/features/push-notifications/server"
      );
      await sendCategorizedPush(
        "payroll",
        session.user.outletId,
        {
          title: `Payroll ${row.label} di-finalize`,
          body: `Siap untuk Mark Paid + kirim slip ke karyawan.`,
          url: "/dashboard#hr_operations",
          tag: `payroll-finalize-${row.id.slice(0, 8)}`,
        },
      );
    } catch (e) {
      console.error("[push] payroll.finalize notif fail:", e);
    }
  })();

  return ok(row);
}

/**
 * Lazily get-or-create the system "Gaji Karyawan" expense category for an
 * outlet. Idempotent — uses the unique (outlet_id, name) constraint so
 * concurrent calls converge on the same row.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getOrCreatePayrollExpenseCategory(
  tx: Tx,
  outletId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.outletId, outletId),
        eq(expenseCategories.name, "Gaji Karyawan"),
        isNull(expenseCategories.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(expenseCategories)
    .values({
      outletId,
      name: "Gaji Karyawan",
      isSystem: true,
      displayOrder: 5,
    })
    .returning({ id: expenseCategories.id });
  return created.id;
}

/* Sesi AE-210 — memastikan rekening yang dipilih memang milik outlet ini
 * dan masih aktif. Tanpa cek ini, id rekening outlet lain bisa lolos lewat
 * server action dan jurnal gaji mengkredit bank yang bukan miliknya. */
async function assertBankAccountUsable(
  outletId: string,
  bankAccountId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!bankAccountId) return { ok: true };
  const [ba] = await db
    .select({ id: bankAccounts.id, isActive: bankAccounts.isActive })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, bankAccountId),
        eq(bankAccounts.outletId, outletId),
        isNull(bankAccounts.deletedAt),
      ),
    )
    .limit(1);
  if (!ba) return { ok: false, message: "Rekening tidak ditemukan di outlet ini" };
  if (!ba.isActive) return { ok: false, message: "Rekening sudah non-aktif" };
  return { ok: true };
}

export async function markPayrollPaid(
  periodId: string,
  paymentMethod: "cash" | "transfer" | "other" = "transfer",
  bankAccountId: string | null = null,
): Promise<ApiResult<PayrollPeriod>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak mark paid");
  }
  /* Sesi AE-210 — bentuk metode+rekening divalidasi SEBELUM apa pun
   * berubah. "transfer tanpa rekening" ditolak di sini, bukan dibiarkan
   * diam-diam jatuh ke 1110 BCA. */
  const shape = payrollPaymentSchema.safeParse({ paymentMethod, bankAccountId });
  if (!shape.success) {
    return fail(
      "VALIDATION_ERROR",
      shape.error.issues[0]?.message ?? "Metode pembayaran tidak valid",
    );
  }
  const bankCheck = await assertBankAccountUsable(
    session.user.outletId,
    shape.data.bankAccountId,
  );
  if (!bankCheck.ok) return fail("VALIDATION_ERROR", bankCheck.message);

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

  const result = await db.transaction(async (tx) => {
    // Idempotency guard — if expense already linked, skip insert.
    const [existingExpense] = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.payrollPeriodId, periodId))
      .limit(1);

    // Sum payroll components for the period — Phase 5.2 (sesi AC-2)
    // breakdown for accounting auto-journal multi-line emission.
    // Sesi AE-60 — extend dengan THR + advanceDeduction.
    const [sumRow] = await tx
      .select({
        baseSalary: sql<string>`COALESCE(SUM(${payrollLines.baseSalary}), 0)`,
        overtimePay: sql<string>`COALESCE(SUM(${payrollLines.overtimePay}), 0)`,
        bonus: sql<string>`COALESCE(SUM(${payrollLines.bonus}), 0)`,
        thr: sql<string>`COALESCE(SUM(${payrollLines.thr}), 0)`,
        lateDeduction: sql<string>`COALESCE(SUM(${payrollLines.lateDeduction}), 0)`,
        advanceDeduction: sql<string>`COALESCE(SUM(${payrollLines.advanceDeduction}), 0)`,
        otherDeductions: sql<string>`COALESCE(SUM(${payrollLines.otherDeductions}), 0)`,
        netPay: sql<string>`COALESCE(SUM(${payrollLines.netPay}), 0)`,
      })
      .from(payrollLines)
      .where(eq(payrollLines.periodId, periodId));
    const totalBaseSalary = Number(sumRow?.baseSalary ?? 0);
    const totalOvertimePay = Number(sumRow?.overtimePay ?? 0);
    const totalBonus = Number(sumRow?.bonus ?? 0);
    const totalThr = Number(sumRow?.thr ?? 0);
    /* Sesi AE-60 — Bonus + THR di-bundle ke totalBonus untuk journal mapping
     * compatibility (existing posJournalForPayrollPaid handle bonus → 6102).
     * Future: extend mapping untuk THR ke account terpisah. */
    const totalBonusAndThr = totalBonus + totalThr;
    const totalDeductions =
      Number(sumRow?.lateDeduction ?? 0) +
      Number(sumRow?.advanceDeduction ?? 0) +
      Number(sumRow?.otherDeductions ?? 0);
    const totalNet = Number(sumRow?.netPay ?? 0);

    /* Sesi AE-209b — porsi potongan kasbon yang boleh di-credit ke 1155
     * Piutang Kasbon: HANYA kasbon yang punya jurnal pembukaan Dr 1155 dan
     * ter-link ke periode ini. Kasbon lama (pra-AE-209, journal_entry_id
     * NULL) tetap lewat 6105 seperti dulu — kalau ikut di-credit ke 1155,
     * saldo piutang jadi minus tanpa error apa pun.
     *
     * Angkanya juga di-cap oleh totalDeductions di mapPayrollPaid, jadi
     * override manual advanceDeduction tidak bisa bikin jurnal tak balance. */
    const [linkedRow] = await tx
      .select({
        journaled: sql<string>`COALESCE(SUM(
          CASE WHEN ${employeeAdvances.journalEntryId} IS NOT NULL
            THEN ${employeeAdvances.amount} - ${employeeAdvances.repaidAmount}
            ELSE 0 END
        ), 0)`,
      })
      .from(employeeAdvances)
      .where(eq(employeeAdvances.deductedFromPeriodId, periodId));
    const totalAdvanceDeduction = Math.min(
      Number(linkedRow?.journaled ?? 0),
      Number(sumRow?.advanceDeduction ?? 0),
    );

    const [row] = await tx
      .update(payrollPeriods)
      .set({
        status: "paid",
        paidAt: new Date(),
        paidBy: session.user.id,
        /* Sesi AE-210 — pilihan owner DISIMPAN, bukan cuma jadi argumen
         * fungsi. Ini yang membuat jurnal bisa diposting ulang ke akun
         * yang benar kalau ternyata salah rekening. */
        paymentMethod: shape.data.paymentMethod,
        bankAccountId: shape.data.bankAccountId,
        updatedAt: new Date(),
      })
      .where(eq(payrollPeriods.id, periodId))
      .returning();

    let expenseId: string | null = existingExpense?.id ?? null;
    if (!existingExpense && totalNet > 0) {
      const categoryId = await getOrCreatePayrollExpenseCategory(
        tx,
        period.outletId,
      );
      const today = toJakartaDateOnly(new Date());
      const [inserted] = await tx
        .insert(expenses)
        .values({
          outletId: period.outletId,
          expenseDate: today,
          categoryId,
          description: `Payroll ${row.label}`,
          amount: totalNet,
          paymentMethod: shape.data.paymentMethod,
          /* Baris kas ikut menunjuk rekening yang sama supaya modul Kas
           * dan jurnal tidak pernah bercerita beda. */
          bankAccountId: shape.data.bankAccountId,
          sourceType: "payroll",
          /* Sesi AE-227 — gaji dibayar dari back office, bukan dari laci
           * kasir; jangan ikut memotong Kas Harusnya kasir. */
          entryOrigin: BACKOFFICE_ORIGIN,
          payrollPeriodId: periodId,
          createdBy: session.user.id,
        })
        .returning({ id: expenses.id });
      expenseId = inserted.id;
    }

    return {
      row,
      expenseId,
      totalNet,
      totalBaseSalary,
      totalOvertimePay,
      totalBonus,
      totalBonusAndThr,
      totalThr,
      totalDeductions,
      totalAdvanceDeduction,
    };
  });

  logAudit({
    eventType: "payroll.paid",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: periodId,
    payload: {
      summary: `Payroll ${result.row.label} ditandai paid`,
      after: {
        status: "paid",
        paidAt: result.row.paidAt,
        expenseId: result.expenseId,
        totalNet: result.totalNet,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit payroll.paid]", e));

  if (result.expenseId) {
    logAudit({
      eventType: "payroll.expense.create",
      userId: session.user.id,
      entityType: "expense",
      entityId: result.expenseId,
      payload: {
        summary: `Expense Gaji Karyawan ${result.row.label} dibuat otomatis`,
        after: {
          amount: result.totalNet,
          paymentMethod: shape.data.paymentMethod,
          bankAccountId: shape.data.bankAccountId,
          payrollPeriodId: periodId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit payroll.expense.create]", e));
  }

  // Sesi T — Accounting auto-journal hook (payroll paid).
  // Phase 5.2 (sesi AC-2): pass per-component breakdown for multi-line emission.
  if (result.totalNet > 0) {
    const { fireJournalHook, postJournalForPayrollPaid } = await import(
      "@/features/accounting/hooks"
    );
    const todayWib = toJakartaDateOnly(new Date());
    fireJournalHook(
      () =>
        postJournalForPayrollPaid({
          outletId: session.user.outletId,
          payrollPeriodId: periodId,
          periodLabel: result.row.label,
          totalBaseSalary: result.totalBaseSalary,
          totalOvertimePay: result.totalOvertimePay,
          totalBonus: result.totalBonusAndThr,
          totalDeductions: result.totalDeductions,
          /* Sesi AE-209b — porsi kasbon ber-jurnal → Cr 1155, sisanya 6105. */
          totalAdvanceDeduction: result.totalAdvanceDeduction,
          totalNetPay: result.totalNet,
          paymentMethod:
            shape.data.paymentMethod === "cash" ? "cash" : "transfer",
          /* Sesi AE-210 — akun bank yang dikredit mengikuti rekening ini,
           * bukan lagi 1110 BCA untuk semua transfer. */
          bankAccountId: shape.data.bankAccountId,
          entryDate: todayWib,
          actorId: session.user.id,
        }),
      "payroll_paid",
    );
  }

  // Sesi AE-62ad → AE-62ag — auto-kirim slip gaji setelah response dikirim.
  // Pakai Next.js after() supaya Vercel guarantee task tetap jalan setelah
  // server action return ke client (pre-fix: fire-and-forget `void async`
  // bisa di-terminate awal oleh runtime, terutama untuk loop N karyawan).
  const { after } = await import("next/server");
  after(async () => {
    try {
      const { sendPayslipsForPeriod } = await import("./payslip-send");
      const summary = await sendPayslipsForPeriod({
        periodId,
        trigger: "auto",
        sentByUserId: session.user.id,
        actorOutletId: session.user.outletId,
        actorRole: session.user.role,
      });
      console.log(
        `[payroll.markPaid] payslip auto-send ${result.row.label}:`,
        summary,
      );
    } catch (e) {
      console.error("[payroll.markPaid] payslip auto-send threw:", e);
    }
  });

  return ok(result.row);
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


/* ============================================================
 * Sesi AE-210 — KOREKSI REKENING / METODE PEMBAYARAN GAJI
 * ============================================================
 *
 * Kejadian nyata yang ditutup fitur ini: gaji ditransfer dari BRI, tapi
 * sistem mencatatnya keluar dari BCA (dulu SEMUA pembayaran non-tunai
 * hardcoded kredit 1110 Bank BCA). Saldo BCA di Neraca jadi minus dan
 * saldo BRI ketinggian, tanpa satu error pun yang muncul.
 *
 * Rekening menentukan AKUN mana yang dikredit, jadi jurnalnya tidak bisa
 * sekadar di-update nilainya — wajib dibalik (pair-void) lalu diposting
 * ulang ke akun yang benar. Pola ini identik dengan koreksi metode bayar
 * hutang dagang (AE-199) yang sudah terbukti di produksi.
 *
 * Urutan sengaja: JURNAL DULU, baru baris kas & periode. Jurnal adalah
 * penjaga paling ketat (periode terkunci bisa menolak), jadi kalau gagal
 * belum ada baris lain yang terlanjur berubah.
 */
export async function updatePayrollPaymentMethod(input: {
  periodId: string;
  paymentMethod: "cash" | "transfer" | "other";
  bankAccountId: string | null;
  reason: string;
}): Promise<
  ApiResult<{
    id: string;
    journalReposted: boolean;
    expenseUpdated: boolean;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak koreksi pembayaran payroll");
  }

  const parsed = updatePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, v.periodId))
    .limit(1);
  if (!period) return fail("NOT_FOUND", "Period tidak ditemukan");
  if (period.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Period dari outlet lain");
  }
  if (period.status !== "paid") {
    return fail(
      "INVALID_STATE",
      "Hanya periode yang sudah dibayar yang perlu dikoreksi rekeningnya",
    );
  }

  const bankCheck = await assertBankAccountUsable(
    session.user.outletId,
    v.bankAccountId,
  );
  if (!bankCheck.ok) return fail("VALIDATION_ERROR", bankCheck.message);

  /* Tidak ada yang berubah → jangan bikin sepasang jurnal kosong yang cuma
   * meramaikan Buku Besar. */
  if (
    period.paymentMethod === v.paymentMethod &&
    (period.bankAccountId ?? null) === v.bankAccountId
  ) {
    return fail("NO_CHANGE", "Metode & rekening sama dengan yang tercatat");
  }

  /* 1) Jurnal — dibalik lalu diposting ulang ke akun yang benar.
   *
   * Nilai posting ulang WAJIB diambil dari entry lamanya sendiri, BUKAN
   * dihitung ulang dari payroll_lines. Baris payroll bisa saja sudah
   * berubah setelah pembayaran (koreksi manual), dan menghitung ulang di
   * sini akan membuat pembalik dan posting ulang tidak seimbang — persis
   * jebakan yang sudah kena di AE-199 pada markPurchasePaid. */
  let journalReposted = false;
  const [payEntry] = await db
    .select({ id: journalEntries.id, entryDate: journalEntries.entryDate })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, session.user.outletId),
        eq(journalEntries.sourceType, "payroll_paid"),
        eq(journalEntries.sourceId, period.id),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);

  if (payEntry) {
    /* Komposisi jurnal payroll dibaca ulang dari BARIS jurnal aslinya,
     * bukan dihitung ulang dari payroll_lines — lihat alasan di atas.
     * Sisi debit = komponen beban, sisi kredit = potongan + netPay. */
    const oldLines = await db
      .select({
        code: chartOfAccounts.code,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(
        chartOfAccounts,
        eq(chartOfAccounts.id, journalLines.accountId),
      )
      .where(eq(journalLines.entryId, payEntry.id));

    const sumOf = (code: string, side: "debit" | "credit") =>
      oldLines
        .filter((l) => l.code === code)
        .reduce((acc, l) => acc + Number(l[side] ?? 0), 0);

    const totalBaseSalary = sumOf("6101", "debit");
    const totalOvertimePay = sumOf("6103", "debit");
    const totalBonus = sumOf("6102", "debit");
    const otherDeduction = sumOf("6105", "credit");
    const advanceDeduction = sumOf("1155", "credit");
    /* netPay = sisa kredit setelah potongan, yaitu baris kas/bank-nya.
     * Diambil sebagai total debit dikurangi potongan supaya tetap benar
     * berapa pun akun kas yang dipakai jurnal lama. */
    const totalDebit = oldLines.reduce((a, l) => a + Number(l.debit ?? 0), 0);
    const totalNetPay = totalDebit - otherDeduction - advanceDeduction;

    if (totalNetPay <= 0) {
      return fail(
        "JOURNAL_ERROR",
        "Jurnal payroll lama tidak punya nilai yang bisa diposting ulang.",
      );
    }

    const [{ pairVoidJournalForSource }, { postJournalForPayrollPaid }] =
      await Promise.all([
        import("@/features/accounting/journal-void"),
        import("@/features/accounting/hooks"),
      ]);

    try {
      await pairVoidJournalForSource({
        outletId: session.user.outletId,
        sourceType: "payroll_paid",
        voidSourceType: "payroll_paid_reversal",
        sourceId: period.id,
        actorId: session.user.id,
        reason: `Koreksi rekening pembayaran gaji — ${v.reason}`,
      });
      await postJournalForPayrollPaid({
        outletId: session.user.outletId,
        payrollPeriodId: period.id,
        periodLabel: period.label,
        totalBaseSalary,
        totalOvertimePay,
        totalBonus,
        totalDeductions: otherDeduction + advanceDeduction,
        totalAdvanceDeduction: advanceDeduction,
        totalNetPay,
        paymentMethod: v.paymentMethod === "cash" ? "cash" : "transfer",
        bankAccountId: v.bankAccountId,
        /* Tanggal jurnal baru = tanggal jurnal lama. Koreksi rekening
         * TIDAK memindahkan beban gaji ke bulan lain. */
        entryDate: String(payEntry.entryDate),
        actorId: session.user.id,
      });
      journalReposted = true;
    } catch (e) {
      return fail(
        "JOURNAL_ERROR",
        logAndSanitize(
          e,
          "payroll.payment_method_update.journal",
          "Jurnal payroll tidak bisa diposting ulang",
        ),
      );
    }
  }

  // 2) Baris kas payroll-nya + periode.
  let expenseUpdated = false;
  try {
    const res = await db
      .update(expenses)
      .set({
        paymentMethod: v.paymentMethod,
        bankAccountId: v.bankAccountId,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(
        and(
          eq(expenses.payrollPeriodId, period.id),
          isNull(expenses.deletedAt),
        ),
      )
      .returning({ id: expenses.id });
    expenseUpdated = res.length > 0;

    await db
      .update(payrollPeriods)
      .set({
        paymentMethod: v.paymentMethod,
        bankAccountId: v.bankAccountId,
        updatedAt: new Date(),
      })
      .where(eq(payrollPeriods.id, period.id));
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "payroll.payment_method_update",
        "Gagal memperbarui baris kas payroll",
      ),
    );
  }

  await logAudit({
    eventType: "payroll.payment_method_update",
    userId: session.user.id,
    entityType: "payroll_period",
    entityId: period.id,
    payload: {
      summary: `Koreksi rekening pembayaran gaji ${period.label} — ${v.reason}`,
      before: {
        paymentMethod: period.paymentMethod,
        bankAccountId: period.bankAccountId,
      },
      after: {
        paymentMethod: v.paymentMethod,
        bankAccountId: v.bankAccountId,
      },
      context: { reason: v.reason, journalReposted, expenseUpdated },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ id: period.id, journalReposted, expenseUpdated });
}

// ---------- Sesi AE-62ad: Slip Gaji email ----------

/**
 * Kirim ulang slip gaji untuk 1 line ke email karyawan. Period harus
 * status='paid'. Tujuan: kasus karyawan ganti email, atau gagal kirim
 * pertama (auth/timeout), atau Owner mau test ke 1 orang dulu.
 */
export async function resendPayslipForLine(
  lineId: string,
): Promise<ApiResult<{ status: string; message: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak kirim slip gaji");
  }

  const [line] = await db
    .select({
      id: payrollLines.id,
      outletId: payrollPeriods.outletId,
      periodStatus: payrollPeriods.status,
    })
    .from(payrollLines)
    .innerJoin(payrollPeriods, eq(payrollLines.periodId, payrollPeriods.id))
    .where(eq(payrollLines.id, lineId))
    .limit(1);

  if (!line) return fail("NOT_FOUND", "Line tidak ditemukan");
  if (line.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Line dari outlet lain");
  }
  if (line.periodStatus !== "paid") {
    return fail("PERIOD_NOT_PAID", "Period belum dibayar — tidak bisa kirim slip");
  }

  const { sendPayslipForLine } = await import("./payslip-send");
  const r = await sendPayslipForLine({
    lineId,
    trigger: "manual",
    sentByUserId: session.user.id,
    actorOutletId: session.user.outletId,
    actorRole: session.user.role,
  });

  return ok({ status: r.status, message: r.message });
}

/**
 * Kirim ulang slip gaji untuk SEMUA line di sebuah period. Owner pakai
 * setelah set ulang env GMAIL_* atau setelah update bulk employee.email.
 */
export async function resendPayslipsForPeriod(
  periodId: string,
): Promise<
  ApiResult<{
    total: number;
    sent: number;
    failed: number;
    logged: number;
    skippedNoEmail: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "payroll.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak kirim slip gaji");
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
  if (period.status !== "paid") {
    return fail("PERIOD_NOT_PAID", "Period belum dibayar — tidak bisa kirim slip");
  }

  const { sendPayslipsForPeriod } = await import("./payslip-send");
  const summary = await sendPayslipsForPeriod({
    periodId,
    trigger: "manual",
    sentByUserId: session.user.id,
    actorOutletId: session.user.outletId,
    actorRole: session.user.role,
  });
  return ok(summary);
}

/**
 * History log slip gaji per period — tampil di UI Slip Gaji.
 * Per line: latest send attempt + total attempts + delivery status.
 */
export async function listPayslipEmailsForPeriod(
  periodId: string,
): Promise<
  ApiResult<
    Array<{
      lineId: string;
      employeeId: string;
      employeeName: string;
      employeeEmail: string | null;
      netPay: number;
      latestSentAt: Date | null;
      latestStatus: "sent" | "failed" | "logged" | null;
      latestErrorCode: string | null;
      attempts: number;
    }>
  >
> {
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

  const { payrollPayslipEmails } = await import("@/db/schema");
  const rows = await db
    .select({
      lineId: payrollLines.id,
      employeeId: employees.id,
      employeeName: employees.fullName,
      employeeEmail: employees.email,
      netPay: payrollLines.netPay,
      attempts: sql<string>`COUNT(${payrollPayslipEmails.id})`,
      latestSentAt: sql<Date | null>`MAX(${payrollPayslipEmails.sentAt})`,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(payrollLines.employeeId, employees.id))
    .leftJoin(
      payrollPayslipEmails,
      eq(payrollPayslipEmails.lineId, payrollLines.id),
    )
    .where(eq(payrollLines.periodId, periodId))
    .groupBy(payrollLines.id, employees.id);

  /* Sesi AE-62ag — Raw SQL untuk DISTINCT ON (PG-specific). Period check
   * di atas (L1131-1136) sudah validate outletId, jadi periodId di filter
   * di bawah aman. Defense-in-depth: JOIN payroll_periods supaya outlet
   * scope enforced at query level juga, tahan terhadap regression caller. */
  const latestStatusRows = await db.execute<{
    line_id: string;
    status: string;
    error_code: string | null;
  }>(sql`
    SELECT DISTINCT ON (pe.line_id)
      pe.line_id AS line_id, pe.status AS status, pe.error_code AS error_code
    FROM payroll_payslip_emails pe
    INNER JOIN payroll_periods pp ON pp.id = pe.period_id
    WHERE pe.period_id = ${periodId}
      AND pp.outlet_id = ${session.user.outletId}
    ORDER BY pe.line_id, pe.sent_at DESC
  `);
  const latestByLine = new Map<string, { status: string; errorCode: string | null }>();
  for (const r of latestStatusRows.rows) {
    latestByLine.set(r.line_id, {
      status: r.status,
      errorCode: r.error_code,
    });
  }

  return ok(
    rows.map((r) => {
      const latest = latestByLine.get(r.lineId);
      return {
        lineId: r.lineId,
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        employeeEmail: r.employeeEmail,
        netPay: Number(r.netPay),
        latestSentAt: r.latestSentAt,
        latestStatus: (latest?.status as "sent" | "failed" | "logged" | null) ?? null,
        latestErrorCode: latest?.errorCode ?? null,
        attempts: Number(r.attempts ?? 0),
      };
    }),
  );
}
