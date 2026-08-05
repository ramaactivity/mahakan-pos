"use server";

import bcrypt from "bcryptjs";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  approvalCodes,
  outlets,
  shifts,
  shiftRebalances,
  splitPayments,
  users,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { jakartaDateOf, todayJakarta } from "@/lib/tz";
import { sendEmail } from "@/lib/email/send";
import { buildShiftRebalanceCodeEmail } from "@/lib/email/templates/shift-rebalance-code";
import {
  computeApprovalCodeExpiry,
  FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
  generateNumericCode6,
  maskEmail,
} from "@/features/approval-codes/types";
import { resolveOwnerEmailRecipients } from "@/features/approval-codes/recipients";
import {
  fail,
  ok,
  type ApiResult,
  type Shift,
} from "./types";
import {
  fireJournalHook,
  postJournalForShiftRebalance,
} from "@/features/accounting/hooks";
import { computeShiftCashSummary, computeExpectedCash } from "./close-pure";
import { transactions, expenses, incomes } from "@/db/schema";
import { toJakartaDateOnly } from "@/lib/date";

const BCRYPT_COST = 10;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ============================================================
// Schemas
// ============================================================

const requestSchema = z.object({
  shiftId: z.uuid(),
  /** Sumber request. Default 'close_shift' (kasir saat close). Manager
   * backoffice pakai 'manager_backoffice' (sesi Phase 3 future). */
  source: z.enum(["close_shift", "manager_backoffice"]).default("close_shift"),
  correctedActualCash: z.number().int().min(0).max(99_999_999),
  correctedQrisSettlement: z
    .number()
    .int()
    .min(0)
    .max(99_999_999)
    .nullable()
    .optional(),
  correctedEdcSettlement: z
    .number()
    .int()
    .min(0)
    .max(99_999_999)
    .nullable()
    .optional(),
  reason: z
    .string()
    .trim()
    .min(3, "Alasan minimal 3 karakter")
    .max(500, "Alasan maksimal 500 karakter"),
  photoUrl: z.string().url().nullable().optional(),
});

const approveSchema = z.object({
  rebalanceId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, "Kode 6 digit angka"),
});

const rejectSchema = z.object({
  rebalanceId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

const cancelSchema = z.object({
  rebalanceId: z.uuid(),
});

export type ShiftRebalance = typeof shiftRebalances.$inferSelect;

// ============================================================
// Helpers
// ============================================================

/** Recompute expectedCash + variance untuk corrected actual cash.
 * Same formula dengan closeShift untuk konsistensi. */
async function computeRebalancedVariance(
  shift: Shift,
  correctedActualCash: number,
): Promise<{ expectedCash: number; correctedVariance: number }> {
  const txnRows = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      total: transactions.total,
      paymentMethod: transactions.paymentMethod,
      refundedAmount: transactions.refundedAmount,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, shift.id));

  /* Sesi AE-155 — fetch splits untuk trx split, sama pattern dengan
   * closeShift action. computeShiftCashSummary butuh per-method allocation
   * untuk variance accurate. */
  const splitTrxIds = txnRows
    .filter((t) => t.paymentMethod === "split")
    .map((t) => t.id);
  const splitsByTrxId = new Map<
    string,
    Array<{ paymentMethod: string; amount: number }>
  >();
  if (splitTrxIds.length > 0) {
    const splitRows = await db
      .select({
        transactionId: splitPayments.transactionId,
        paymentMethod: splitPayments.paymentMethod,
        amount: splitPayments.amount,
      })
      .from(splitPayments)
      .where(inArray(splitPayments.transactionId, splitTrxIds));
    for (const s of splitRows) {
      const list = splitsByTrxId.get(s.transactionId) ?? [];
      list.push({ paymentMethod: s.paymentMethod, amount: s.amount });
      splitsByTrxId.set(s.transactionId, list);
    }
  }
  const txns = txnRows.map((t) => ({
    status: t.status,
    paymentMethod: t.paymentMethod,
    total: t.total,
    refundedAmount: t.refundedAmount,
    splits: splitsByTrxId.get(t.id),
  }));

  // Petty cash range from shift open date → close (or today kalau belum close).
  const shiftStartDate = toJakartaDateOnly(shift.openedAt);
  const closeDate = shift.closedAt
    ? toJakartaDateOnly(shift.closedAt)
    : toJakartaDateOnly(new Date());

  const pettyExpRows = await db
    .select({ amount: expenses.amount })
    .from(expenses)
    .where(
      and(
        eq(expenses.outletId, shift.outletId),
        eq(expenses.paymentMethod, "cash"),
        sql`${expenses.expenseDate} >= ${shiftStartDate}`,
        sql`${expenses.expenseDate} <= ${closeDate}`,
        isNull(expenses.deletedAt),
      ),
    );
  const pettyExpenseCash = pettyExpRows.reduce((s, r) => s + r.amount, 0);

  const pettyIncRows = await db
    .select({ amount: incomes.amount })
    .from(incomes)
    .where(
      and(
        eq(incomes.outletId, shift.outletId),
        eq(incomes.paymentMethod, "cash"),
        sql`${incomes.incomeDate} >= ${shiftStartDate}`,
        sql`${incomes.incomeDate} <= ${closeDate}`,
        isNull(incomes.deletedAt),
      ),
    );
  const pettyIncomeCash = pettyIncRows.reduce((s, r) => s + r.amount, 0);

  const cashSummary = computeShiftCashSummary(txns, {
    expenseCash: pettyExpenseCash,
    incomeCash: pettyIncomeCash,
  });
  const expectedCash = computeExpectedCash(shift.openingCash, cashSummary);
  return {
    expectedCash,
    correctedVariance: correctedActualCash - expectedCash,
  };
}

// ============================================================
// Actions
// ============================================================

/**
 * Sesi AE-62o — request shift rebalancing.
 *
 * Workflow:
 *   1. Validate shift exists, outlet match, status='closed' (rebalance
 *      hanya untuk shift yang sudah ditutup).
 *   2. Snapshot original values (actualCash, variance, qrisSettlement,
 *      edcSettlement, original shift_variance journal entry kalau ada).
 *   3. Create shift_rebalances row dengan status='pending_approval'.
 *   4. Generate 6-digit approval code (bcrypt hash), insert approval_codes
 *      row dengan actionType='shift.rebalance', target=rebalance.id.
 *   5. Email code ke owner recipients.
 *   6. Audit log.
 *
 * Returns rebalance id + code first-two (UI hint) + email result.
 */
export async function requestShiftRebalance(input: {
  shiftId: string;
  source?: "close_shift" | "manager_backoffice";
  correctedActualCash: number;
  correctedQrisSettlement?: number | null;
  correctedEdcSettlement?: number | null;
  reason: string;
  photoUrl?: string | null;
}): Promise<
  ApiResult<{
    rebalanceId: string;
    codeFirstTwo: string;
    expiresAt: string;
    emailMode: "sent" | "logged" | "failed";
    ownerEmailMasked: string;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.rebalance.request")) {
    return fail("FORBIDDEN", "Tidak punya hak request rebalance");
  }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  // 1. Validate shift
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, v.shiftId))
    .limit(1);
  if (!shift) return fail("NOT_FOUND", "Shift tidak ditemukan");
  if (shift.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Shift dari outlet lain");
  }
  if (shift.status !== "closed") {
    return fail(
      "SHIFT_NOT_CLOSED",
      "Rebalance hanya untuk shift yang sudah ditutup. Untuk shift aktif, edit langsung dari Close Shift modal.",
    );
  }

  // 2. Check existing pending rebalance untuk shift ini
  const [existingPending] = await db
    .select({ id: shiftRebalances.id })
    .from(shiftRebalances)
    .where(
      and(
        eq(shiftRebalances.shiftId, v.shiftId),
        eq(shiftRebalances.status, "pending_approval"),
      ),
    )
    .limit(1);
  if (existingPending) {
    return fail(
      "REBALANCE_ALREADY_PENDING",
      "Sudah ada rebalancing pending untuk shift ini. Tunggu owner approve / reject dulu.",
    );
  }

  // 3. Resolve recipients
  const recipients = await resolveOwnerEmailRecipients(session.user.outletId);
  if (!recipients) {
    return fail(
      "NO_OWNER_EMAIL",
      "Email Owner belum diset. Owner login → Pengaturan → tambah email approval dulu.",
    );
  }

  // 4. Create rebalance row + approval code (transactional)
  const code = generateNumericCode6();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const codeFirstTwo = code.slice(0, 2);
  const now = new Date();
  const expiresAt = computeApprovalCodeExpiry(now);

  let rebalanceId: string;
  try {
    rebalanceId = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(shiftRebalances)
        .values({
          shiftId: shift.id,
          outletId: shift.outletId,
          source: v.source,
          originalActualCash: shift.actualCash ?? 0,
          originalVariance: shift.variance ?? 0,
          originalQrisSettlement: shift.qrisSettlement,
          originalEdcSettlement: shift.edcSettlement,
          correctedActualCash: v.correctedActualCash,
          correctedQrisSettlement: v.correctedQrisSettlement ?? null,
          correctedEdcSettlement: v.correctedEdcSettlement ?? null,
          reason: v.reason,
          photoUrl: v.photoUrl ?? null,
          requestedBy: session.user.id,
        })
        .returning({ id: shiftRebalances.id });
      if (!r) throw new Error("CREATE_FAILED");

      await tx.insert(approvalCodes).values({
        codeHash,
        codeFirstTwo,
        actionType: "shift.rebalance",
        targetShiftRebalanceId: r.id,
        outletId: shift.outletId,
        requestedByUserId: session.user.id,
        reason: v.reason,
        expiresAt,
      });

      return r.id;
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "shift-rebalance.request", "Operasi database gagal"),
    );
  }

  // 5. Send email (parallel fan-out)
  const [outletRow] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, shift.outletId))
    .limit(1);
  const [cashierRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, shift.userId))
    .limit(1);

  const closedAt = shift.closedAt ?? shift.openedAt;
  const shiftLabel = `Shift ${shift.id.slice(0, 8)} (${cashierRow?.name ?? "Kasir"}) tutup ${closedAt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}`;

  const changes: Array<{
    label: string;
    originalValue: number;
    correctedValue: number;
  }> = [
    {
      label: "Kas Fisik",
      originalValue: shift.actualCash ?? 0,
      correctedValue: v.correctedActualCash,
    },
  ];
  if (
    v.correctedQrisSettlement != null &&
    v.correctedQrisSettlement !== shift.qrisSettlement
  ) {
    changes.push({
      label: "QRIS",
      originalValue: shift.qrisSettlement ?? 0,
      correctedValue: v.correctedQrisSettlement,
    });
  }
  if (
    v.correctedEdcSettlement != null &&
    v.correctedEdcSettlement !== shift.edcSettlement
  ) {
    changes.push({
      label: "EDC (BCA)",
      originalValue: shift.edcSettlement ?? 0,
      correctedValue: v.correctedEdcSettlement,
    });
  }

  const sendPromises = recipients.emails.map((toEmail) =>
    sendEmail(
      buildShiftRebalanceCodeEmail({
        toEmail,
        ownerName: recipients.primaryOwner?.name ?? "Owner",
        code,
        shiftLabel,
        cashierName: cashierRow?.name ?? "Kasir",
        changes,
        reason: v.reason,
        requestedByName: session.user.name,
        requestedByRole: session.user.role,
        source: v.source,
        expiresAt,
        outletName: outletRow?.name ?? "Mahakan Coffee & Space",
      }),
    ),
  );
  const sendResults = await Promise.all(sendPromises);
  const anySent = sendResults.some((r) => r.mode === "sent");
  const anyLogged = sendResults.some((r) => r.mode === "logged");
  const emailMode: "sent" | "logged" | "failed" = anySent
    ? "sent"
    : anyLogged
      ? "logged"
      : "failed";

  // 6. Audit log
  await logAudit({
    eventType: "shift.rebalance.request",
    userId: session.user.id,
    entityType: "shift_rebalance",
    entityId: rebalanceId,
    payload: {
      summary: `Request rebalancing shift ${shift.id.slice(0, 8)}: ${v.reason}`,
      context: {
        shiftId: shift.id,
        source: v.source,
        originalCash: shift.actualCash ?? 0,
        correctedCash: v.correctedActualCash,
        codeFirstTwo,
        emailMode,
        recipientCount: recipients.emails.length,
      },
    },
    metadata: { outletId: shift.outletId, actorRole: session.user.role },
  });

  return ok({
    rebalanceId,
    codeFirstTwo,
    expiresAt: expiresAt.toISOString(),
    emailMode,
    ownerEmailMasked: maskEmail(recipients.emails[0] ?? ""),
  });
}

/**
 * Sesi AE-62o — approve shift rebalancing via 6-digit code.
 *
 * Workflow:
 *   1. Validate code format + find active approval_code row.
 *   2. Check lockout (5 failed attempts → auto-revoke + force re-request).
 *   3. bcrypt.compare(input, hash).
 *   4. Update shift fields (actualCash, variance, qrisSettlement, edcSettlement).
 *   5. Fire postJournalForShiftRebalance (reverse old + post new entry).
 *   6. Update shift_rebalances row: status='approved' + journal entry IDs.
 *   7. Mark approval_code consumed.
 *   8. Audit log.
 */
export async function approveShiftRebalance(input: {
  rebalanceId: string;
  code: string;
}): Promise<ApiResult<{ rebalanceId: string; appliedAt: Date }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.rebalance.approve")) {
    return fail(
      "FORBIDDEN",
      "Tidak punya akses apply kode approval. Hubungi Owner.",
    );
  }
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  // 1. Find rebalance
  const [rebalance] = await db
    .select()
    .from(shiftRebalances)
    .where(eq(shiftRebalances.id, v.rebalanceId))
    .limit(1);
  if (!rebalance) return fail("NOT_FOUND", "Rebalance tidak ditemukan");
  if (rebalance.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Rebalance dari outlet lain");
  }
  if (rebalance.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Rebalance sudah ${rebalance.status} — tidak bisa approve lagi.`,
    );
  }

  // 2. Find active code
  const [active] = await db
    .select()
    .from(approvalCodes)
    .where(
      and(
        eq(approvalCodes.targetShiftRebalanceId, v.rebalanceId),
        eq(approvalCodes.actionType, "shift.rebalance"),
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
      "Tidak ada kode aktif. Minta requester re-submit untuk generate kode baru.",
    );
  }

  // 3. Check lockout
  if (active.failedAttempts >= FAILED_ATTEMPTS_LOCKOUT_THRESHOLD) {
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
        summary: `Kode rebalance dikunci setelah ${FAILED_ATTEMPTS_LOCKOUT_THRESHOLD}x salah`,
        context: { rebalanceId: v.rebalanceId },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
    return fail(
      "LOCKED",
      "Kode dikunci karena terlalu banyak salah. Minta requester resubmit.",
    );
  }

  // 4. Verify code
  const match = await bcrypt.compare(v.code.trim(), active.codeHash);
  if (!match) {
    await db
      .update(approvalCodes)
      .set({ failedAttempts: sql`${approvalCodes.failedAttempts} + 1` })
      .where(eq(approvalCodes.id, active.id));
    return fail(
      "WRONG_CODE",
      "Kode salah. Cek email/forward dari requester.",
    );
  }

  // 5. Apply correction inside transaction.
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, rebalance.shiftId))
    .limit(1);
  if (!shift) return fail("NOT_FOUND", "Shift tidak ditemukan");

  const { correctedVariance } = await computeRebalancedVariance(
    shift,
    rebalance.correctedActualCash,
  );

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      // Update shift
      await tx
        .update(shifts)
        .set({
          actualCash: rebalance.correctedActualCash,
          variance: correctedVariance,
          qrisSettlement:
            rebalance.correctedQrisSettlement ?? shift.qrisSettlement,
          edcSettlement:
            rebalance.correctedEdcSettlement ?? shift.edcSettlement,
          updatedAt: now,
        })
        .where(eq(shifts.id, shift.id));

      // Consume code
      await tx
        .update(approvalCodes)
        .set({ consumedAt: now, consumedByUserId: session.user.id })
        .where(eq(approvalCodes.id, active.id));

      // Update rebalance row
      await tx
        .update(shiftRebalances)
        .set({
          status: "approved",
          approvedBy: session.user.id,
          approvedAt: now,
          approvalCodeId: active.id,
          correctedVariance,
          updatedAt: now,
        })
        .where(eq(shiftRebalances.id, v.rebalanceId));
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "shift-rebalance.approve", "Operasi database gagal"),
    );
  }

  // 6. Fire journal hook (post-commit, fire-and-forget).
  const closedDate = shift.closedAt
    ? jakartaDateOf(new Date(shift.closedAt))
    : todayJakarta();
  const shiftLabelForJournal = `Shift ${shift.id.slice(0, 8)} ${closedDate}`;
  fireJournalHook(
    async () => {
      await postJournalForShiftRebalance({
        outletId: shift.outletId,
        shiftId: shift.id,
        shiftRebalanceId: v.rebalanceId,
        shiftLabel: shiftLabelForJournal,
        originalVariance: rebalance.originalVariance,
        correctedVariance,
        reason: rebalance.reason,
        entryDate: closedDate,
        actorId: session.user.id,
      });
    },
    "shift_variance_rebalance",
  );

  // 7. Audit log
  await logAudit({
    eventType: "shift.rebalance.approve",
    userId: session.user.id,
    entityType: "shift_rebalance",
    entityId: v.rebalanceId,
    payload: {
      summary: `Approve rebalancing shift ${shift.id.slice(0, 8)} — variance ${rebalance.originalVariance} → ${correctedVariance}`,
      context: {
        shiftId: shift.id,
        originalCash: rebalance.originalActualCash,
        correctedCash: rebalance.correctedActualCash,
        originalVariance: rebalance.originalVariance,
        correctedVariance,
        codeFirstTwo: active.codeFirstTwo,
      },
    },
    metadata: { outletId: shift.outletId, actorRole: session.user.role },
  });

  return ok({ rebalanceId: v.rebalanceId, appliedAt: now });
}

/**
 * Direct-approve (owner-only path tanpa kode).
 *
 * Dipakai dari Pusat Persetujuan ketika owner sudah login di backoffice
 * dan ingin meng-approve tanpa generate→kirim kode WA bolak-balik.
 * Owner role wajib (bukan permission `shift.rebalance.approve` yang juga
 * dikasih ke manager) — direct approve harus ekstra-strict.
 *
 * Side effects identik dengan [[approveShiftRebalance]] kecuali active
 * code di-revoke (bukan consume) supaya audit trail jelas: ini bukan
 * konsumsi kode normal.
 */
export async function approveShiftRebalanceDirect(input: {
  rebalanceId: string;
}): Promise<ApiResult<{ rebalanceId: string; appliedAt: Date }>> {
  const session = await requireSession();
  if (session.user.role !== "owner") {
    return fail(
      "FORBIDDEN",
      "Direct approve hanya untuk Owner. Manager pakai jalur kode.",
    );
  }
  const v = { rebalanceId: input.rebalanceId };

  const [rebalance] = await db
    .select()
    .from(shiftRebalances)
    .where(eq(shiftRebalances.id, v.rebalanceId))
    .limit(1);
  if (!rebalance) return fail("NOT_FOUND", "Rebalance tidak ditemukan");
  if (rebalance.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Rebalance dari outlet lain");
  }
  if (rebalance.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Rebalance sudah ${rebalance.status} — tidak bisa approve lagi.`,
    );
  }

  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, rebalance.shiftId))
    .limit(1);
  if (!shift) return fail("NOT_FOUND", "Shift tidak ditemukan");

  const { correctedVariance } = await computeRebalancedVariance(
    shift,
    rebalance.correctedActualCash,
  );

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(shifts)
        .set({
          actualCash: rebalance.correctedActualCash,
          variance: correctedVariance,
          qrisSettlement:
            rebalance.correctedQrisSettlement ?? shift.qrisSettlement,
          edcSettlement:
            rebalance.correctedEdcSettlement ?? shift.edcSettlement,
          updatedAt: now,
        })
        .where(eq(shifts.id, shift.id));

      // Revoke any active code (owner approved directly, code obsolete).
      await tx
        .update(approvalCodes)
        .set({ revokedAt: now, revokedByUserId: session.user.id })
        .where(
          and(
            eq(approvalCodes.targetShiftRebalanceId, v.rebalanceId),
            isNull(approvalCodes.consumedAt),
            isNull(approvalCodes.revokedAt),
          ),
        );

      await tx
        .update(shiftRebalances)
        .set({
          status: "approved",
          approvedBy: session.user.id,
          approvedAt: now,
          correctedVariance,
          updatedAt: now,
        })
        .where(eq(shiftRebalances.id, v.rebalanceId));
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "shift-rebalance.approve.direct",
        "Operasi database gagal",
      ),
    );
  }

  const closedDate = shift.closedAt
    ? jakartaDateOf(new Date(shift.closedAt))
    : todayJakarta();
  const shiftLabelForJournal = `Shift ${shift.id.slice(0, 8)} ${closedDate}`;
  fireJournalHook(
    async () => {
      await postJournalForShiftRebalance({
        outletId: shift.outletId,
        shiftId: shift.id,
        shiftRebalanceId: v.rebalanceId,
        shiftLabel: shiftLabelForJournal,
        originalVariance: rebalance.originalVariance,
        correctedVariance,
        reason: rebalance.reason,
        entryDate: closedDate,
        actorId: session.user.id,
      });
    },
    "shift_variance_rebalance",
  );

  await logAudit({
    eventType: "shift.rebalance.approve",
    userId: session.user.id,
    entityType: "shift_rebalance",
    entityId: v.rebalanceId,
    payload: {
      summary: `Approve rebalancing shift ${shift.id.slice(0, 8)} (direct owner) — variance ${rebalance.originalVariance} → ${correctedVariance}`,
      context: {
        shiftId: shift.id,
        originalCash: rebalance.originalActualCash,
        correctedCash: rebalance.correctedActualCash,
        originalVariance: rebalance.originalVariance,
        correctedVariance,
        directOwnerApprove: true,
      },
    },
    metadata: { outletId: shift.outletId, actorRole: session.user.role },
  });

  return ok({ rebalanceId: v.rebalanceId, appliedAt: now });
}

/**
 * Sesi AE-62o — reject rebalance (owner/manager only).
 */
export async function rejectShiftRebalance(input: {
  rebalanceId: string;
  reason: string;
}): Promise<ApiResult<{ rebalanceId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.rebalance.reject")) {
    return fail("FORBIDDEN", "Tidak punya hak reject rebalancing");
  }
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Alasan reject minimal 3 karakter",
    );
  }
  const v = parsed.data;
  const [rebalance] = await db
    .select()
    .from(shiftRebalances)
    .where(eq(shiftRebalances.id, v.rebalanceId))
    .limit(1);
  if (!rebalance) return fail("NOT_FOUND", "Rebalance tidak ditemukan");
  if (rebalance.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Rebalance dari outlet lain");
  }
  if (rebalance.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Rebalance sudah ${rebalance.status} — tidak bisa reject lagi.`,
    );
  }
  /* Sesi AE-150 — Guard: submitter tidak boleh reject pengajuannya
   * sendiri (semantic-nya cancel, bukan reject). Exception: owner
   * tetap bisa reject milik sendiri (edge case, but owner is god). */
  if (
    rebalance.requestedBy === session.user.id &&
    session.user.role !== "owner"
  ) {
    return fail(
      "FORBIDDEN_SELF_REJECT",
      "Tidak bisa reject pengajuan sendiri — pakai Cancel untuk membatalkan.",
    );
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(shiftRebalances)
      .set({
        status: "rejected",
        rejectedBy: session.user.id,
        rejectedAt: now,
        rejectedReason: v.reason,
        updatedAt: now,
      })
      .where(eq(shiftRebalances.id, v.rebalanceId));
    // Revoke any active codes
    await tx
      .update(approvalCodes)
      .set({ revokedAt: now, revokedByUserId: session.user.id })
      .where(
        and(
          eq(approvalCodes.targetShiftRebalanceId, v.rebalanceId),
          isNull(approvalCodes.consumedAt),
          isNull(approvalCodes.revokedAt),
        ),
      );
  });
  await logAudit({
    eventType: "shift.rebalance.reject",
    userId: session.user.id,
    entityType: "shift_rebalance",
    entityId: v.rebalanceId,
    payload: {
      summary: `Reject rebalancing shift ${rebalance.shiftId.slice(0, 8)}: ${v.reason}`,
      context: { shiftId: rebalance.shiftId, reason: v.reason },
    },
    metadata: { outletId: rebalance.outletId, actorRole: session.user.role },
  });
  return ok({ rebalanceId: v.rebalanceId });
}

/**
 * Sesi AE-62o — cancel rebalance by requester (before approve/reject).
 */
export async function cancelShiftRebalance(input: {
  rebalanceId: string;
}): Promise<ApiResult<{ rebalanceId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.rebalance.cancel")) {
    return fail("FORBIDDEN", "Tidak punya hak cancel");
  }
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Input tidak valid");
  }
  const v = parsed.data;
  const [rebalance] = await db
    .select()
    .from(shiftRebalances)
    .where(eq(shiftRebalances.id, v.rebalanceId))
    .limit(1);
  if (!rebalance) return fail("NOT_FOUND", "Rebalance tidak ditemukan");
  if (rebalance.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Rebalance dari outlet lain");
  }
  // Only requester sendiri yang boleh cancel (owner skip karena owner pakai reject).
  if (
    rebalance.requestedBy !== session.user.id &&
    session.user.role !== "owner"
  ) {
    return fail(
      "NOT_OWNER_OF_REQUEST",
      "Hanya requester yang bisa cancel. Owner pakai reject.",
    );
  }
  if (rebalance.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Rebalance sudah ${rebalance.status} — tidak bisa cancel.`,
    );
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(shiftRebalances)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(shiftRebalances.id, v.rebalanceId));
    await tx
      .update(approvalCodes)
      .set({ revokedAt: now, revokedByUserId: session.user.id })
      .where(
        and(
          eq(approvalCodes.targetShiftRebalanceId, v.rebalanceId),
          isNull(approvalCodes.consumedAt),
          isNull(approvalCodes.revokedAt),
        ),
      );
  });
  await logAudit({
    eventType: "shift.rebalance.cancel",
    userId: session.user.id,
    entityType: "shift_rebalance",
    entityId: v.rebalanceId,
    payload: {
      summary: `Cancel rebalancing shift ${rebalance.shiftId.slice(0, 8)} oleh requester`,
    },
    metadata: { outletId: rebalance.outletId, actorRole: session.user.role },
  });
  return ok({ rebalanceId: v.rebalanceId });
}

// ============================================================
// Read actions
// ============================================================

/**
 * Sesi AE-62o — list rebalances (filter by status / shift).
 */
export async function listShiftRebalances(opts: {
  status?: "pending_approval" | "approved" | "rejected" | "cancelled" | "all";
  shiftId?: string;
  limit?: number;
} = {}): Promise<
  ApiResult<
    Array<
      ShiftRebalance & {
        requesterName: string | null;
        approverName: string | null;
        cashierName: string | null;
        shiftClosedAt: Date | null;
      }
    >
  >
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.rebalance.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat rebalances");
  }
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [eq(shiftRebalances.outletId, session.user.outletId)];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(shiftRebalances.status, opts.status));
  }
  if (opts.shiftId) {
    conds.push(eq(shiftRebalances.shiftId, opts.shiftId));
  }
  const rows = await db
    .select({
      r: shiftRebalances,
      requesterName: users.name,
    })
    .from(shiftRebalances)
    .leftJoin(users, eq(users.id, shiftRebalances.requestedBy))
    .where(and(...conds))
    .orderBy(desc(shiftRebalances.requestedAt))
    .limit(limit);

  // Resolve approver names + cashier names + shift dates separately
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.r.approvedBy) userIds.add(r.r.approvedBy);
  }
  const shiftIds = rows.map((r) => r.r.shiftId);
  const nameById = new Map<string, string>();
  /* Sesi AE-76 — inArray() helper untuk semua secondary lookup queries.
   * Pattern `sql\`= ANY(${array})\`` tidak reliable di Neon prod (AE-68). */
  if (userIds.size > 0) {
    try {
      const userRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, Array.from(userIds)));
      for (const u of userRows) nameById.set(u.id, u.name);
    } catch (e) {
      console.error("[rebalance list approver names]", e);
    }
  }
  const shiftMeta = new Map<
    string,
    { cashierName: string | null; closedAt: Date | null }
  >();
  if (shiftIds.length > 0) {
    try {
      const shiftRows = await db
        .select({
          id: shifts.id,
          userId: shifts.userId,
          closedAt: shifts.closedAt,
        })
        .from(shifts)
        .where(inArray(shifts.id, shiftIds));
      const cashierIds = new Set<string>();
      for (const s of shiftRows) cashierIds.add(s.userId);
      const cashierRows =
        cashierIds.size > 0
          ? await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, Array.from(cashierIds)))
          : [];
      const cashierById = new Map<string, string>();
      for (const u of cashierRows) cashierById.set(u.id, u.name);
      for (const s of shiftRows) {
        shiftMeta.set(s.id, {
          cashierName: cashierById.get(s.userId) ?? null,
          closedAt: s.closedAt,
        });
      }
    } catch (e) {
      console.error("[rebalance list shift meta]", e);
    }
  }

  return ok(
    rows.map((r) => {
      const meta = shiftMeta.get(r.r.shiftId);
      return {
        ...r.r,
        requesterName: r.requesterName,
        approverName: r.r.approvedBy
          ? (nameById.get(r.r.approvedBy) ?? null)
          : null,
        cashierName: meta?.cashierName ?? null,
        shiftClosedAt: meta?.closedAt ?? null,
      };
    }),
  );
}
