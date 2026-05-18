import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  outlets,
  payrollLines,
  payrollPayslipEmails,
  payrollPeriods,
} from "@/db/schema";
import { sendEmail } from "@/lib/email/send";
import { buildPayslipEmail } from "@/lib/email/templates/payslip";
import { logAudit } from "@/lib/audit/logger";

/**
 * Sesi AE-62ad — Payslip email helper.
 *
 * Dipakai oleh:
 *   1. markPaid (fire-and-forget setelah commit) — trigger='auto'
 *   2. resendPayslipEmail action (manual dari UI Slip Gaji) — trigger='manual'
 *
 * Behaviour:
 *   - line tanpa email karyawan → di-skip dengan status='failed' code='NO_EMAIL'
 *   - send via existing sendEmail() wrapper (Gmail SMTP / Resend / dev-log)
 *   - log row di payroll_payslip_emails (siapapun status-nya)
 *   - emit audit event per line
 *   - return summary supaya caller bisa toast
 */

export interface SendPayslipSummary {
  total: number;
  sent: number;
  failed: number;
  logged: number;
  skippedNoEmail: number;
}

export async function sendPayslipForLine(opts: {
  lineId: string;
  trigger: "auto" | "manual";
  sentByUserId: string | null;
  /** Outlet sumber audit metadata. Diisi caller karena session bisa-bisa beda. */
  actorOutletId: string;
  actorRole: string;
}): Promise<{
  status: "sent" | "failed" | "logged" | "skipped";
  emailLogId: string | null;
  message: string;
}> {
  const { lineId, trigger, sentByUserId, actorOutletId, actorRole } = opts;

  const [row] = await db
    .select({
      line: payrollLines,
      period: payrollPeriods,
      employee: employees,
      outlet: outlets,
    })
    .from(payrollLines)
    .innerJoin(payrollPeriods, eq(payrollLines.periodId, payrollPeriods.id))
    .innerJoin(employees, eq(payrollLines.employeeId, employees.id))
    .innerJoin(outlets, eq(payrollPeriods.outletId, outlets.id))
    .where(eq(payrollLines.id, lineId))
    .limit(1);

  if (!row) {
    return { status: "failed", emailLogId: null, message: "Line tidak ditemukan" };
  }

  if (row.period.status !== "paid") {
    return {
      status: "failed",
      emailLogId: null,
      message: "Period belum dibayar — tidak bisa kirim slip",
    };
  }

  const toEmail = row.employee.email?.trim();
  if (!toEmail) {
    // Log skip as failed row supaya UI bisa highlight siapa belum di-set
    const [skipRow] = await db
      .insert(payrollPayslipEmails)
      .values({
        periodId: row.period.id,
        lineId: row.line.id,
        employeeId: row.employee.id,
        toEmail: "(belum di-set)",
        trigger,
        messageId: null,
        status: "failed",
        errorMessage: "Email karyawan belum di-isi di profil",
        errorCode: "NO_EMAIL",
        sentBy: sentByUserId,
      })
      .returning({ id: payrollPayslipEmails.id });

    logAudit({
      eventType: "payroll.payslip.failed",
      userId: sentByUserId,
      entityType: "payroll_payslip_email",
      entityId: skipRow.id,
      payload: {
        summary: `Slip gaji ${row.employee.fullName} tidak terkirim — email belum di-set`,
        context: { lineId, employeeId: row.employee.id, errorCode: "NO_EMAIL" },
      },
      metadata: { outletId: actorOutletId, actorRole },
    }).catch((e) => console.error("[audit payroll.payslip.failed]", e));

    return {
      status: "skipped",
      emailLogId: skipRow.id,
      message: `Email ${row.employee.fullName} belum di-isi`,
    };
  }

  const msg = buildPayslipEmail({
    toEmail,
    employeeName: row.employee.fullName,
    outletName: row.outlet.name,
    periodLabel: row.period.label,
    periodStart: row.period.periodStart,
    periodEnd: row.period.periodEnd,
    paidAt: row.period.paidAt ?? new Date(),
    baseSalary: row.line.baseSalary,
    overtimePay: row.line.overtimePay,
    bonus: row.line.bonus,
    thr: row.line.thr,
    lateDeduction: row.line.lateDeduction,
    advanceDeduction: row.line.advanceDeduction,
    otherDeductions: row.line.otherDeductions,
    grossPay: row.line.grossPay,
    netPay: row.line.netPay,
    workDays: row.line.workDays,
    totalWorkMinutes: row.line.totalWorkMinutes,
    totalLateMinutes: row.line.totalLateMinutes,
    totalOvertimeMinutes: row.line.totalOvertimeMinutes,
    notes: row.line.notes ?? null,
  });

  const result = await sendEmail(msg);

  const dbStatus: "sent" | "failed" | "logged" =
    result.mode === "sent"
      ? "sent"
      : result.mode === "logged"
        ? "logged"
        : "failed";

  const [logRow] = await db
    .insert(payrollPayslipEmails)
    .values({
      periodId: row.period.id,
      lineId: row.line.id,
      employeeId: row.employee.id,
      toEmail,
      trigger,
      messageId: result.messageId,
      status: dbStatus,
      errorMessage: result.error ?? null,
      errorCode: result.errorCode ?? null,
      sentBy: sentByUserId,
    })
    .returning({ id: payrollPayslipEmails.id });

  const auditEvent =
    trigger === "auto"
      ? dbStatus === "failed"
        ? "payroll.payslip.failed"
        : "payroll.payslip.send"
      : dbStatus === "failed"
        ? "payroll.payslip.failed"
        : "payroll.payslip.resend";

  logAudit({
    eventType: auditEvent,
    userId: sentByUserId,
    entityType: "payroll_payslip_email",
    entityId: logRow.id,
    payload: {
      summary: `Slip ${row.employee.fullName} → ${toEmail} [${dbStatus}]`,
      context: {
        lineId,
        employeeId: row.employee.id,
        provider: result.provider,
        messageId: result.messageId,
        errorCode: result.errorCode,
      },
    },
    metadata: { outletId: actorOutletId, actorRole },
  }).catch((e) => console.error(`[audit ${auditEvent}]`, e));

  return {
    status: dbStatus,
    emailLogId: logRow.id,
    message:
      dbStatus === "sent"
        ? `Slip terkirim ke ${toEmail}`
        : dbStatus === "logged"
          ? `Slip di-log (dev mode, email provider belum di-config)`
          : (result.error ?? "Gagal mengirim email"),
  };
}

/**
 * Bulk send untuk seluruh line di sebuah period. Dipakai saat markPaid
 * (auto) dan saat Owner click "Kirim Ulang Semua" di Slip Gaji UI.
 */
export async function sendPayslipsForPeriod(opts: {
  periodId: string;
  trigger: "auto" | "manual";
  sentByUserId: string | null;
  actorOutletId: string;
  actorRole: string;
}): Promise<SendPayslipSummary> {
  /* Sesi AE-62ag — defense-in-depth outlet scoping. Caller (resendPayslipsForPeriod
   * + markPaid) sudah re-check period.outletId match session, tapi helper
   * boleh dipanggil dari context lain di masa depan. JOIN payrollPeriods
   * untuk batas tegas: cuma lines di period yang outletId = actor outletId. */
  const lines = await db
    .select({ id: payrollLines.id })
    .from(payrollLines)
    .innerJoin(payrollPeriods, eq(payrollLines.periodId, payrollPeriods.id))
    .where(
      and(
        eq(payrollLines.periodId, opts.periodId),
        eq(payrollPeriods.outletId, opts.actorOutletId),
      ),
    );

  const summary: SendPayslipSummary = {
    total: lines.length,
    sent: 0,
    failed: 0,
    logged: 0,
    skippedNoEmail: 0,
  };

  for (const ln of lines) {
    const r = await sendPayslipForLine({
      lineId: ln.id,
      trigger: opts.trigger,
      sentByUserId: opts.sentByUserId,
      actorOutletId: opts.actorOutletId,
      actorRole: opts.actorRole,
    });
    if (r.status === "sent") summary.sent += 1;
    else if (r.status === "logged") summary.logged += 1;
    else if (r.status === "skipped") summary.skippedNoEmail += 1;
    else summary.failed += 1;
  }

  return summary;
}
