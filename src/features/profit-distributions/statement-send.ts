import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  capitalMovements,
  investorStatementEmails,
  investors,
  outlets,
  pengelola,
  profitDistributionLines,
  profitDistributions,
} from "@/db/schema";
import { sendEmail } from "@/lib/email/send";
import { buildInvestorStatementEmail } from "@/lib/email/templates/investor-statement";
import { logAudit } from "@/lib/audit/logger";

/**
 * Sesi AE-63e — Bulk send statement dividen ke investor + pengelola.
 *
 * Mirror pattern `payslip-send.ts` (Phase U-4 AE-62ad). Dipanggil:
 *  1. Auto setelah approveAndPostDistribution via Next.js after() hook
 *  2. Manual resend (per-line atau per-distribution) dari UI
 *
 * Email recipients yang missing → di-log dengan errorCode='NO_EMAIL'
 * supaya owner lihat siapa belum di-set.
 */

const MONTH_LABELS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export interface SendStatementSummary {
  total: number;
  sent: number;
  failed: number;
  logged: number;
  skippedNoEmail: number;
  skippedZeroAmount: number;
}

export async function sendStatementForLine(opts: {
  lineId: string;
  trigger: "auto" | "manual";
  sentByUserId: string | null;
  actorOutletId: string;
  actorRole: string;
}): Promise<{
  status: "sent" | "failed" | "logged" | "skipped";
  message: string;
}> {
  const { lineId, trigger, sentByUserId, actorOutletId, actorRole } = opts;

  const [row] = await db
    .select({
      line: profitDistributionLines,
      distribution: profitDistributions,
      outlet: outlets,
    })
    .from(profitDistributionLines)
    .innerJoin(
      profitDistributions,
      eq(profitDistributions.id, profitDistributionLines.distributionId),
    )
    .innerJoin(outlets, eq(outlets.id, profitDistributions.outletId))
    .where(eq(profitDistributionLines.id, lineId))
    .limit(1);

  if (!row) {
    return { status: "failed", message: "Line tidak ditemukan" };
  }

  if (row.distribution.outletId !== actorOutletId) {
    return { status: "failed", message: "Outlet mismatch" };
  }

  if (row.distribution.status !== "posted") {
    return {
      status: "failed",
      message: "Distribusi belum di-post, tidak bisa kirim statement",
    };
  }

  if (row.line.amountRupiah <= 0) {
    return { status: "skipped", message: "Dividen 0, skip kirim" };
  }

  /* Resolve holder name + email (polymorphic FK). */
  let holderName = "";
  let holderEmail: string | null = null;
  if (row.line.holderType === "investor") {
    const [inv] = await db
      .select({ fullName: investors.fullName, email: investors.email })
      .from(investors)
      .where(eq(investors.id, row.line.holderId))
      .limit(1);
    if (inv) {
      holderName = inv.fullName;
      holderEmail = inv.email;
    }
  } else {
    const [p] = await db
      .select({ fullName: pengelola.fullName, email: pengelola.email })
      .from(pengelola)
      .where(eq(pengelola.id, row.line.holderId))
      .limit(1);
    if (p) {
      holderName = p.fullName;
      holderEmail = p.email;
    }
  }

  if (!holderName) {
    return { status: "failed", message: "Holder tidak ditemukan" };
  }

  if (!holderEmail) {
    const [logRow] = await db
      .insert(investorStatementEmails)
      .values({
        distributionId: row.distribution.id,
        lineId: row.line.id,
        holderType: row.line.holderType,
        holderId: row.line.holderId,
        toEmail: "(belum di-set)",
        trigger,
        messageId: null,
        status: "failed",
        errorMessage: "Email holder belum di-isi",
        errorCode: "NO_EMAIL",
        sentBy: sentByUserId,
      })
      .returning({ id: investorStatementEmails.id });

    logAudit({
      eventType: "investor_statement.failed",
      userId: sentByUserId,
      entityType: "investor_statement_email",
      entityId: logRow.id,
      payload: {
        summary: `Statement ${holderName} tidak terkirim — email belum di-set`,
        context: {
          lineId,
          holderType: row.line.holderType,
          errorCode: "NO_EMAIL",
        },
      },
      metadata: { outletId: actorOutletId, actorRole },
    }).catch((e) => console.error("[audit investor_statement.failed]", e));

    return { status: "skipped", message: `${holderName}: email belum di-set` };
  }

  /* Compute saldo sebelum + sesudah dari capital_movements running balance.
   * "Sebelum" = sum movements amount sampai SEBELUM occurredAt distribusi.
   * "Sesudah" = sebelum + dividen amount. */
  const distOccurredAt = row.distribution.postedAt ?? row.distribution.createdAt;
  const [sumBefore] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CASE WHEN ${capitalMovements.kind} IN ('initial_deposit','top_up','dividend_credit','adjustment') THEN ${capitalMovements.amount} WHEN ${capitalMovements.kind} = 'withdrawal' THEN -${capitalMovements.amount} ELSE 0 END), 0)`,
    })
    .from(capitalMovements)
    .where(
      and(
        eq(capitalMovements.holderType, row.line.holderType),
        eq(capitalMovements.holderId, row.line.holderId),
        sql`${capitalMovements.occurredAt} < ${distOccurredAt}`,
      ),
    );
  const saldoSebelum = Number(sumBefore?.total ?? 0);
  const saldoSesudah = saldoSebelum + row.line.amountRupiah;

  const periodLabel = `${MONTH_LABELS_ID[row.distribution.periodMonth - 1]} ${row.distribution.periodYear}`;
  const msg = buildInvestorStatementEmail({
    toEmail: holderEmail,
    holderName,
    holderType: row.line.holderType,
    outletName: row.outlet.name,
    periodLabel,
    postedAt: row.distribution.postedAt ?? new Date(),
    modalDisetor: row.line.modalDisetorSnapshot,
    sharePct: Number(row.line.sharePct),
    dividendAmount: row.line.amountRupiah,
    saldoSebelum,
    saldoSesudah,
  });

  const result = await sendEmail(msg);
  const dbStatus: "sent" | "failed" | "logged" =
    result.mode === "sent"
      ? "sent"
      : result.mode === "logged"
        ? "logged"
        : "failed";

  const [logRow] = await db
    .insert(investorStatementEmails)
    .values({
      distributionId: row.distribution.id,
      lineId: row.line.id,
      holderType: row.line.holderType,
      holderId: row.line.holderId,
      toEmail: holderEmail,
      trigger,
      messageId: result.messageId,
      status: dbStatus,
      errorMessage: result.error ?? null,
      errorCode: result.errorCode ?? null,
      sentBy: sentByUserId,
    })
    .returning({ id: investorStatementEmails.id });

  const auditEvent =
    trigger === "auto"
      ? dbStatus === "failed"
        ? "investor_statement.failed"
        : "investor_statement.send"
      : dbStatus === "failed"
        ? "investor_statement.failed"
        : "investor_statement.resend";

  logAudit({
    eventType: auditEvent,
    userId: sentByUserId,
    entityType: "investor_statement_email",
    entityId: logRow.id,
    payload: {
      summary: `Statement ${holderName} → ${holderEmail} [${dbStatus}]`,
      context: {
        lineId,
        holderType: row.line.holderType,
        provider: result.provider,
        messageId: result.messageId,
        errorCode: result.errorCode,
      },
    },
    metadata: { outletId: actorOutletId, actorRole },
  }).catch((e) => console.error(`[audit ${auditEvent}]`, e));

  return {
    status: dbStatus,
    message:
      dbStatus === "sent"
        ? `Statement terkirim ke ${holderEmail}`
        : dbStatus === "logged"
          ? `Statement di-log (dev mode)`
          : (result.error ?? "Gagal mengirim email"),
  };
}

export async function sendStatementsForDistribution(opts: {
  distributionId: string;
  trigger: "auto" | "manual";
  sentByUserId: string | null;
  actorOutletId: string;
  actorRole: string;
}): Promise<SendStatementSummary> {
  const lines = await db
    .select({ id: profitDistributionLines.id })
    .from(profitDistributionLines)
    .innerJoin(
      profitDistributions,
      eq(profitDistributions.id, profitDistributionLines.distributionId),
    )
    .where(
      and(
        eq(profitDistributionLines.distributionId, opts.distributionId),
        eq(profitDistributions.outletId, opts.actorOutletId),
      ),
    );

  const summary: SendStatementSummary = {
    total: lines.length,
    sent: 0,
    failed: 0,
    logged: 0,
    skippedNoEmail: 0,
    skippedZeroAmount: 0,
  };

  for (const ln of lines) {
    const r = await sendStatementForLine({
      lineId: ln.id,
      trigger: opts.trigger,
      sentByUserId: opts.sentByUserId,
      actorOutletId: opts.actorOutletId,
      actorRole: opts.actorRole,
    });
    if (r.status === "sent") summary.sent += 1;
    else if (r.status === "logged") summary.logged += 1;
    else if (r.status === "skipped") {
      if (r.message.includes("Dividen 0")) summary.skippedZeroAmount += 1;
      else summary.skippedNoEmail += 1;
    } else summary.failed += 1;
  }

  return summary;
}
