"use server";

import bcrypt from "bcryptjs";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalCodes, outlets, transactions, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { sendEmail } from "@/lib/email/send";
import { buildApprovalCodeEmail } from "@/lib/email/templates/approval-code";
import {
  fail,
  ok,
  type ApiResult,
  type ApprovalActionType,
  type ApprovalCode,
  type RequestApprovalCodeInput,
  type RequestApprovalCodeResult,
  DEFAULT_CODE_TTL_MS,
  FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
  generateNumericCode6,
  maskEmail,
} from "./types";

const BCRYPT_COST = 10;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** Resolve the email an approval code should be delivered to. Order:
 *  1. Outlet settings.approval.notifyEmail (Owner override)
 *  2. First active Owner user's email
 *  3. null (caller surfaces error) */
async function resolveApprovalEmail(
  outletId: string,
): Promise<{ email: string; owner: { id: string; name: string; email: string } | null } | null> {
  const [outlet] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const overrideEmail =
    (outlet?.settings as { approval?: { notifyEmail?: string } } | null)
      ?.approval?.notifyEmail ?? null;

  const [ownerUser] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.outletId, outletId),
        eq(users.role, "owner"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.createdAt))
    .limit(1);

  if (overrideEmail && overrideEmail.includes("@")) {
    return {
      email: overrideEmail,
      owner: ownerUser?.email
        ? { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email }
        : null,
    };
  }
  if (ownerUser?.email) {
    return {
      email: ownerUser.email,
      owner: { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email },
    };
  }
  return null;
}

/**
 * Initiate an approval-code request. Generates a 6-digit code, stores
 * the bcrypt hash, and emails the plaintext code to the Owner. Anyone
 * with `*.request` perm can call this; consume + authorization happens
 * in voidTransaction / refundTransaction with the code as payload.
 */
export async function requestApprovalCode(
  input: RequestApprovalCodeInput,
): Promise<ApiResult<RequestApprovalCodeResult>> {
  const session = await requireSession();
  const requestPerm =
    input.actionType === "pos.transaction.void"
      ? "pos.transaction.void.request"
      : "pos.transaction.refund.request";
  if (!hasPermission(session.user.role, requestPerm)) {
    return fail("FORBIDDEN", "Tidak punya hak request approval code");
  }

  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) {
    return fail("INVALID_REASON", "Alasan 3-200 karakter");
  }

  const [trx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, input.transactionId))
    .limit(1);
  if (!trx) return fail("TRX_NOT_FOUND", "Transaksi tidak ditemukan");
  if (trx.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Transaksi dari outlet lain");
  }
  if (trx.status !== "paid") {
    return fail(
      "TRX_NOT_ELIGIBLE",
      `Hanya transaksi paid yang bisa di-${input.actionType === "pos.transaction.void" ? "void" : "refund"} (status saat ini: ${trx.status})`,
    );
  }

  const target = await resolveApprovalEmail(session.user.outletId);
  if (!target) {
    return fail(
      "NO_OWNER_EMAIL",
      "Email Owner belum diset. Owner login → Pengaturan → update email dulu.",
    );
  }

  // Revoke any prior unused, unrevoked, unexpired codes for this trx+action
  // so Owner only has one active code per request line. Defense-in-depth:
  // staff can request again if Owner's first email got lost without polluting
  // the active-code list.
  await db
    .update(approvalCodes)
    .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
    .where(
      and(
        eq(approvalCodes.targetTransactionId, input.transactionId),
        eq(approvalCodes.actionType, input.actionType),
        isNull(approvalCodes.consumedAt),
        isNull(approvalCodes.revokedAt),
        gt(approvalCodes.expiresAt, new Date()),
      ),
    );

  const code = generateNumericCode6();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const codeFirstTwo = code.slice(0, 2);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_CODE_TTL_MS);

  const [inserted] = await db
    .insert(approvalCodes)
    .values({
      codeHash,
      codeFirstTwo,
      actionType: input.actionType,
      targetTransactionId: input.transactionId,
      outletId: session.user.outletId,
      requestedByUserId: session.user.id,
      reason,
      expiresAt,
    })
    .returning();

  // Best-effort email send. Audit either outcome.
  const [outletRow] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const emailMsg = buildApprovalCodeEmail({
    toEmail: target.email,
    ownerName: target.owner?.name ?? "Owner",
    actionType: input.actionType,
    code,
    transactionNumber: trx.transactionNumber,
    transactionTotal: trx.total,
    reason,
    requestedByName: session.user.name,
    requestedByRole: session.user.role,
    expiresAt,
    outletName: outletRow?.name ?? "Mahakan Coffee & Space",
  });
  const sendResult = await sendEmail(emailMsg);

  await logAudit({
    eventType: "approval_code.generate",
    userId: session.user.id,
    entityType: "approval_code",
    entityId: inserted.id,
    payload: {
      summary: `Request ${input.actionType === "pos.transaction.void" ? "void" : "refund"} TRX ${trx.transactionNumber} — kode terkirim ke ${maskEmail(target.email)} (${sendResult.mode})`,
      context: {
        transactionNumber: trx.transactionNumber,
        actionType: input.actionType,
        reason,
        codeFirstTwo,
        expiresAt: expiresAt.toISOString(),
        emailMode: sendResult.mode,
        emailMessageId: sendResult.messageId,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  if (sendResult.mode === "failed") {
    await logAudit({
      eventType: "approval_code.email_failed",
      userId: session.user.id,
      entityType: "approval_code",
      entityId: inserted.id,
      payload: {
        summary: `Email gagal kirim untuk approval code TRX ${trx.transactionNumber}`,
        context: {
          error: sendResult.error,
          target: maskEmail(target.email),
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });
  }

  return ok({
    codeFirstTwo,
    expiresAt: expiresAt.toISOString(),
    emailMode: sendResult.mode,
    ownerEmailMasked: maskEmail(target.email),
    emailError: sendResult.mode === "failed" ? sendResult.error : undefined,
    emailErrorCode:
      sendResult.mode === "failed" ? sendResult.errorCode : undefined,
  });
}

/**
 * Owner-facing diagnostic — verifies the email provider config + auth.
 * No real email sent. Returns the same SendResult shape so admin UI can
 * show provider + status + error code if config is broken.
 */
export async function verifyEmailConfig(): Promise<
  ApiResult<{
    provider: "gmail" | "resend" | "dev-log";
    ok: boolean;
    error?: string;
    errorCode?: string;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_code.view")) {
    return fail("FORBIDDEN", "Owner-only");
  }
  const { verifyEmailProvider } = await import("@/lib/email/send");
  const r = await verifyEmailProvider();
  return ok({
    provider: r.provider,
    ok: r.ok,
    error: r.error,
    errorCode: r.errorCode,
  });
}

/**
 * Send a real test email to the configured Owner address. Use sparingly
 * — counts against Gmail's daily quota. Returns the SendResult shape.
 */
export async function sendTestEmail(): Promise<
  ApiResult<{
    provider: "gmail" | "resend" | "dev-log";
    mode: "sent" | "logged" | "failed";
    targetMasked: string;
    error?: string;
    errorCode?: string;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_code.view")) {
    return fail("FORBIDDEN", "Owner-only");
  }
  const target = await resolveApprovalEmail(session.user.outletId);
  if (!target) {
    return fail("NO_OWNER_EMAIL", "Email Owner belum diset");
  }
  const result = await sendEmail({
    to: target.email,
    subject: "[Mahakan POS] Test Email",
    text: `Halo ${target.owner?.name ?? "Owner"},\n\nIni test email dari Mahakan POS untuk verifikasi setup approval-code.\n\nKalau email ini sampai, berarti Gmail SMTP / Resend sudah benar.\n\nWaktu test: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB\n\n— Mahakan POS`,
    html: `<p>Halo <strong>${target.owner?.name ?? "Owner"}</strong>,</p><p>Ini test email dari Mahakan POS untuk verifikasi setup approval-code.</p><p>Kalau email ini sampai, berarti Gmail SMTP / Resend sudah benar.</p><p>Waktu test: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p><p>— Mahakan POS</p>`,
  });
  return ok({
    provider: result.provider,
    mode: result.mode,
    targetMasked: maskEmail(target.email),
    error: result.error,
    errorCode: result.errorCode,
  });
}

/**
 * Verify a 6-digit code against an active approval row for the given
 * transaction + action. Returns the consumed row on success. Caller
 * (voidTransaction / refundTransaction) consumes and proceeds.
 *
 * On wrong code: increment failed_attempts; reject with WRONG_CODE.
 * Once attempts >= LOCKOUT, return LOCKED for any further input.
 */
export async function consumeApprovalCode(
  transactionId: string,
  actionType: ApprovalActionType,
  inputCode: string,
): Promise<ApiResult<ApprovalCode>> {
  const session = await requireSession();
  const trimmed = inputCode.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return fail("INVALID_FORMAT", "Kode harus 6 digit angka");
  }

  // Find the most recent active code for this trx+action.
  const [active] = await db
    .select()
    .from(approvalCodes)
    .where(
      and(
        eq(approvalCodes.targetTransactionId, transactionId),
        eq(approvalCodes.actionType, actionType),
        isNull(approvalCodes.consumedAt),
        isNull(approvalCodes.revokedAt),
        gt(approvalCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(approvalCodes.createdAt))
    .limit(1);

  if (!active) {
    return fail(
      "NO_ACTIVE_CODE",
      "Tidak ada kode aktif. Tap 'Minta Kode' untuk generate yang baru.",
    );
  }

  if (active.failedAttempts >= FAILED_ATTEMPTS_LOCKOUT_THRESHOLD) {
    // Auto-revoke the locked code so a fresh request is forced.
    await db
      .update(approvalCodes)
      .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
      .where(eq(approvalCodes.id, active.id));
    await logAudit({
      eventType: "approval_code.failed_attempt",
      userId: session.user.id,
      entityType: "approval_code",
      entityId: active.id,
      payload: {
        summary: `Kode dikunci setelah ${FAILED_ATTEMPTS_LOCKOUT_THRESHOLD}x salah`,
        context: { transactionId, actionType },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
    return fail(
      "LOCKED",
      "Kode dikunci karena terlalu banyak salah. Minta kode baru ke Owner.",
    );
  }

  const match = await bcrypt.compare(trimmed, active.codeHash);
  if (!match) {
    await db
      .update(approvalCodes)
      .set({ failedAttempts: sql`${approvalCodes.failedAttempts} + 1` })
      .where(eq(approvalCodes.id, active.id));
    await logAudit({
      eventType: "approval_code.failed_attempt",
      userId: session.user.id,
      entityType: "approval_code",
      entityId: active.id,
      payload: {
        summary: `Kode salah pada TRX target ${transactionId.slice(0, 8)}…`,
        context: {
          attempts: active.failedAttempts + 1,
          threshold: FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
        },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
    return fail("WRONG_CODE", "Kode salah. Cek lagi atau minta kode baru.");
  }

  const [consumed] = await db
    .update(approvalCodes)
    .set({ consumedAt: new Date(), consumedByUserId: session.user.id })
    .where(eq(approvalCodes.id, active.id))
    .returning();

  await logAudit({
    eventType: "approval_code.consume",
    userId: session.user.id,
    entityType: "approval_code",
    entityId: consumed.id,
    payload: {
      summary: `Kode di-consume oleh ${session.user.name} untuk ${actionType === "pos.transaction.void" ? "void" : "refund"}`,
      context: {
        transactionId,
        actionType,
        codeFirstTwo: consumed.codeFirstTwo,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(consumed);
}

/**
 * List active + recent codes for the Owner admin panel. Returns last 2
 * digits + status only — never the hash. Limited to outlet scope.
 */
export async function listApprovalCodes(
  limit = 50,
): Promise<ApiResult<ApprovalCode[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_code.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat approval codes");
  }
  const rows = await db
    .select()
    .from(approvalCodes)
    .where(eq(approvalCodes.outletId, session.user.outletId))
    .orderBy(desc(approvalCodes.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return ok(rows);
}

/** Owner can pre-emptively revoke an active code. */
export async function revokeApprovalCode(
  codeId: string,
): Promise<ApiResult<ApprovalCode>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_code.revoke")) {
    return fail("FORBIDDEN", "Tidak punya hak revoke approval codes");
  }
  const [target] = await db
    .select()
    .from(approvalCodes)
    .where(eq(approvalCodes.id, codeId))
    .limit(1);
  if (!target) return fail("NOT_FOUND", "Kode tidak ditemukan");
  if (target.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Kode dari outlet lain");
  }
  if (target.consumedAt) {
    return fail("ALREADY_CONSUMED", "Kode sudah di-consume");
  }
  if (target.revokedAt) {
    return fail("ALREADY_REVOKED", "Kode sudah di-revoke");
  }
  const [updated] = await db
    .update(approvalCodes)
    .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
    .where(eq(approvalCodes.id, codeId))
    .returning();
  await logAudit({
    eventType: "approval_code.revoked",
    userId: session.user.id,
    entityType: "approval_code",
    entityId: updated.id,
    payload: {
      summary: `Kode di-revoke oleh ${session.user.name}`,
      context: {
        transactionId: updated.targetTransactionId,
        actionType: updated.actionType,
        codeFirstTwo: updated.codeFirstTwo,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });
  return ok(updated);
}
