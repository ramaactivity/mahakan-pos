"use server";

import bcrypt from "bcryptjs";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  approvalCodes,
  customers,
  outlets,
  shifts,
  splitPayments,
  transactionCorrections,
  transactions,
  users,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { sendEmail } from "@/lib/email/send";
import { buildTransactionCorrectionCodeEmail } from "@/lib/email/templates/transaction-correction-code";
import {
  DEFAULT_CODE_TTL_MS,
  FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
  generateNumericCode6,
  maskEmail,
} from "@/features/approval-codes/types";
import { resolveOwnerEmailRecipients } from "@/features/approval-codes/recipients";
import {
  computePointsEarned,
  RUPIAH_PER_POINT_REDEEMED,
} from "@/features/customers/types";
import {
  fireJournalHook,
  postJournalForTransactionCorrection,
} from "@/features/accounting/hooks";
import {
  CORRECTION_POST_CLOSE_WINDOW_MS,
  getCorrectableTransactionWindow,
  type CorrectionWindowSource,
} from "./correction-window";
import { fail, ok, type ApiResult } from "./types";

const BCRYPT_COST = 10;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ============================================================
// Types & schemas
// ============================================================

export type TransactionCorrection =
  typeof transactionCorrections.$inferSelect;

const PAYMENT_METHOD_ENUM = [
  "cash",
  "qris",
  "card_bca",
  "card_bni",
  "card_mandiri",
  "card_bri",
  "card_other",
  "split",
] as const;

const NON_SPLIT_METHOD_ENUM = PAYMENT_METHOD_ENUM.filter(
  (m): m is Exclude<(typeof PAYMENT_METHOD_ENUM)[number], "split"> =>
    m !== "split",
);

const splitRowSchema = z.object({
  paymentMethod: z.enum(NON_SPLIT_METHOD_ENUM),
  amount: z.number().int().min(1).max(99_999_999),
  cashReceived: z.number().int().min(0).max(99_999_999).nullable().optional(),
  cashChange: z.number().int().min(0).max(99_999_999).nullable().optional(),
});

const requestSchema = z.object({
  transactionId: z.uuid(),
  correctedPaymentMethod: z.enum(PAYMENT_METHOD_ENUM),
  correctedTotal: z.number().int().min(1).max(99_999_999),
  correctedSplitBreakdown: z.array(splitRowSchema).min(1).max(8).optional(),
  /** Untuk paymentMethod corrected = 'cash' single-payment, kasir bisa
   * input cashReceived baru. Default = correctedTotal. */
  correctedCashReceived: z
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
  correctionId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, "Kode 6 digit angka"),
});

const rejectSchema = z.object({
  correctionId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

const cancelSchema = z.object({
  correctionId: z.uuid(),
});

export type SplitBreakdownRow = z.infer<typeof splitRowSchema>;

// ============================================================
// Internal helpers
// ============================================================

function fmtRupiah(n: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n)}`;
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case "cash":
      return "Tunai";
    case "qris":
      return "QRIS";
    case "card_bca":
      return "Kartu BCA";
    case "card_bni":
      return "Kartu BNI";
    case "card_mandiri":
      return "Kartu Mandiri";
    case "card_bri":
      return "Kartu BRI";
    case "card_other":
      return "Kartu (lainnya)";
    case "split":
      return "Split (campur)";
    default:
      return method;
  }
}

function describeSplitBreakdown(
  rows: SplitBreakdownRow[] | null | undefined,
): string {
  if (!rows || rows.length === 0) return "—";
  return rows
    .map((r) => `${paymentMethodLabel(r.paymentMethod)} ${fmtRupiah(r.amount)}`)
    .join(" + ");
}

function jakartaDateOf(d: Date): string {
  const j = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}

/** Fetch existing splits sebagai SplitBreakdownRow[] untuk snapshot. */
async function fetchCurrentSplitBreakdown(
  trxId: string,
): Promise<SplitBreakdownRow[] | null> {
  const rows = await db
    .select()
    .from(splitPayments)
    .where(eq(splitPayments.transactionId, trxId))
    .orderBy(asc(splitPayments.createdAt));
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    paymentMethod: r.paymentMethod as SplitBreakdownRow["paymentMethod"],
    amount: r.amount,
    cashReceived: r.cashReceived ?? null,
    cashChange: r.cashChange ?? null,
  }));
}

// ============================================================
// Action: request correction
// ============================================================

/**
 * Sesi AE-62r — request transaction correction (paymentMethod/total swap).
 *
 * Workflow:
 *   1. RBAC + validate input
 *   2. Fetch trx + shift; window check (active shift OR last closed <24h)
 *   3. Reject if trx.status != 'paid' OR refundedAmount > 0
 *   4. Validate scope: at least one differs (paymentMethod, total, split)
 *   5. Derive correctedDiscountAmount = subtotal - correctedTotal
 *   6. Snapshot originals (incl. fetch current splits)
 *   7. Generate 6-digit code, insert correction + approval_code row (atomic)
 *   8. Email code to owner recipients
 *   9. Audit log
 *
 * Returns correction id + code hint + email mode.
 */
export async function requestTransactionCorrection(input: {
  transactionId: string;
  correctedPaymentMethod:
    | "cash"
    | "qris"
    | "card_bca"
    | "card_bni"
    | "card_mandiri"
    | "card_bri"
    | "card_other"
    | "split";
  correctedTotal: number;
  correctedSplitBreakdown?: SplitBreakdownRow[];
  correctedCashReceived?: number | null;
  reason: string;
  photoUrl?: string | null;
}): Promise<
  ApiResult<{
    correctionId: string;
    codeFirstTwo: string;
    expiresAt: string;
    emailMode: "sent" | "logged" | "failed";
    ownerEmailMasked: string;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.correction.request")) {
    return fail("FORBIDDEN", "Tidak punya hak request koreksi transaksi");
  }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  // 1. Fetch trx
  const [trx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, v.transactionId))
    .limit(1);
  if (!trx) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (trx.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Transaksi dari outlet lain");
  }
  if (trx.status !== "paid") {
    return fail(
      "TRX_NOT_PAID",
      `Koreksi hanya untuk transaksi paid. Status sekarang: ${trx.status}.`,
    );
  }
  if (trx.refundedAmount > 0) {
    return fail(
      "TRX_HAS_REFUND",
      "Transaksi ini sudah ada refund sebagian/penuh. Koreksi tidak bisa dipakai — minta owner manual entry kalau perlu adjust.",
    );
  }

  // 2. Fetch shift + window check
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, trx.shiftId))
    .limit(1);
  if (!shift) return fail("NOT_FOUND", "Shift transaksi tidak ditemukan");

  const windowCheck = getCorrectableTransactionWindow({
    trx: { shiftId: trx.shiftId, outletId: trx.outletId },
    shift: {
      id: shift.id,
      status: shift.status,
      closedAt: shift.closedAt,
      outletId: shift.outletId,
    },
    now: new Date(),
  });
  if (!windowCheck.eligible) {
    return fail(
      "WINDOW_EXPIRED",
      windowCheck.reason === "WINDOW_EXPIRED"
        ? "Shift transaksi sudah ditutup >24 jam. Pakai shift-level rebalance dari Admin → Shift kalau perlu adjust."
        : `Transaksi tidak bisa dikoreksi: ${windowCheck.reason ?? "tidak eligible"}`,
    );
  }

  // 3. Validate scope — at least one field differs
  const currentSplits = await fetchCurrentSplitBreakdown(v.transactionId);
  const paymentMethodChanged = v.correctedPaymentMethod !== trx.paymentMethod;
  const totalChanged = v.correctedTotal !== trx.total;
  const splitChanged = (() => {
    if (v.correctedPaymentMethod !== "split" && trx.paymentMethod !== "split")
      return false;
    if (v.correctedPaymentMethod === "split" && !currentSplits) return true;
    if (
      v.correctedPaymentMethod !== "split" &&
      currentSplits &&
      currentSplits.length > 0
    )
      return true;
    if (!v.correctedSplitBreakdown) return false;
    if (!currentSplits) return true;
    if (v.correctedSplitBreakdown.length !== currentSplits.length) return true;
    return v.correctedSplitBreakdown.some((row, idx) => {
      const cur = currentSplits[idx];
      return cur.paymentMethod !== row.paymentMethod || cur.amount !== row.amount;
    });
  })();
  if (!paymentMethodChanged && !totalChanged && !splitChanged) {
    return fail(
      "NO_CHANGES",
      "Tidak ada field yang berubah. Edit minimal paymentMethod / total / split breakdown.",
    );
  }

  // 4. Split validation (if corrected = split)
  if (v.correctedPaymentMethod === "split") {
    if (!v.correctedSplitBreakdown || v.correctedSplitBreakdown.length === 0) {
      return fail(
        "SPLIT_BREAKDOWN_REQUIRED",
        "Metode split butuh breakdown minimal 1 baris.",
      );
    }
    const sum = v.correctedSplitBreakdown.reduce((s, r) => s + r.amount, 0);
    if (sum !== v.correctedTotal) {
      return fail(
        "SPLIT_SUM_MISMATCH",
        `Jumlah split (${fmtRupiah(sum)}) tidak sama dengan total (${fmtRupiah(v.correctedTotal)}).`,
      );
    }
    for (const row of v.correctedSplitBreakdown) {
      if (row.paymentMethod === "cash") {
        const received = row.cashReceived ?? row.amount;
        if (received < row.amount) {
          return fail(
            "SPLIT_CASH_RECEIVED_LT_AMOUNT",
            `Cash row Rp ${row.amount} butuh cashReceived ≥ ${fmtRupiah(row.amount)}.`,
          );
        }
      }
    }
  } else if (v.correctedSplitBreakdown && v.correctedSplitBreakdown.length > 0) {
    return fail(
      "SPLIT_BREAKDOWN_ON_SINGLE_METHOD",
      "splitBreakdown cuma boleh diisi kalau paymentMethod='split'.",
    );
  }

  // 5. Derive correctedDiscountAmount (Trap T11: total = subtotal - discountAmount)
  const correctedDiscountAmount = trx.subtotal - v.correctedTotal;
  if (correctedDiscountAmount < 0) {
    return fail(
      "CORRECTION_TOTAL_EXCEEDS_SUBTOTAL",
      `Total koreksi ${fmtRupiah(v.correctedTotal)} > subtotal ${fmtRupiah(trx.subtotal)}. Tidak boleh — ubah item dulu kalau memang harus naik.`,
    );
  }

  // 6. Loyalty redeem floor check (Trap T6)
  const redeemed = trx.loyaltyPointsRedeemed ?? 0;
  if (redeemed > 0) {
    const redeemedRupiahFloor = redeemed * RUPIAH_PER_POINT_REDEEMED;
    if (v.correctedTotal < redeemedRupiahFloor) {
      return fail(
        "CORRECTION_BELOW_REDEEM_FLOOR",
        `Total koreksi ${fmtRupiah(v.correctedTotal)} < nilai poin yang sudah dipakai (${fmtRupiah(redeemedRupiahFloor)}). Void + remake transaksi kalau memang perlu turun.`,
      );
    }
  }

  // 7. Check existing pending correction
  const [existingPending] = await db
    .select({ id: transactionCorrections.id })
    .from(transactionCorrections)
    .where(
      and(
        eq(transactionCorrections.transactionId, v.transactionId),
        eq(transactionCorrections.status, "pending_approval"),
      ),
    )
    .limit(1);
  if (existingPending) {
    return fail(
      "CORRECTION_ALREADY_PENDING",
      "Sudah ada koreksi pending untuk transaksi ini. Tunggu owner approve / reject dulu.",
    );
  }

  // 8. Resolve owner recipients
  const recipients = await resolveOwnerEmailRecipients(session.user.outletId);
  if (!recipients) {
    return fail(
      "NO_OWNER_EMAIL",
      "Email Owner belum diset. Owner login → Pengaturan → tambah email approval dulu.",
    );
  }

  // 9. Create correction row + approval code (atomic)
  const code = generateNumericCode6();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const codeFirstTwo = code.slice(0, 2);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_CODE_TTL_MS);

  let correctionId: string;
  try {
    correctionId = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(transactionCorrections)
        .values({
          transactionId: trx.id,
          outletId: trx.outletId,
          shiftIdAtRequest: shift.id,
          source: windowCheck.source as Exclude<
            CorrectionWindowSource,
            null
          > satisfies "kasir_active_shift" | "kasir_post_close" | "manager_backoffice",
          originalPaymentMethod: trx.paymentMethod,
          originalTotal: trx.total,
          originalSubtotal: trx.subtotal,
          originalDiscountAmount: trx.discountAmount ?? 0,
          originalSplitBreakdown: currentSplits ?? null,
          originalLoyaltyPointsEarned: trx.loyaltyPointsEarned,
          originalLoyaltyPointsRedeemed: trx.loyaltyPointsRedeemed,
          correctedPaymentMethod: v.correctedPaymentMethod,
          correctedTotal: v.correctedTotal,
          correctedDiscountAmount,
          correctedSplitBreakdown:
            v.correctedPaymentMethod === "split"
              ? (v.correctedSplitBreakdown ?? [])
              : null,
          reason: v.reason,
          photoUrl: v.photoUrl ?? null,
          requestedBy: session.user.id,
        })
        .returning({ id: transactionCorrections.id });
      if (!r) throw new Error("CREATE_FAILED");

      await tx.insert(approvalCodes).values({
        codeHash,
        codeFirstTwo,
        actionType: "pos.transaction.correction",
        targetTransactionCorrectionId: r.id,
        outletId: trx.outletId,
        requestedByUserId: session.user.id,
        reason: v.reason,
        expiresAt,
      });

      return r.id;
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "transaction-correction.request",
        "Operasi database gagal",
      ),
    );
  }

  // 10. Send email (parallel fan-out)
  const [outletRow] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, trx.outletId))
    .limit(1);
  const [cashierRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, trx.cashierId))
    .limit(1);

  const transactionLabel = `${trx.transactionNumber} (${fmtRupiah(trx.total)})`;
  const changes: TransactionCorrectionChangeRow[] = [];
  if (paymentMethodChanged) {
    changes.push({
      label: "Metode Bayar",
      originalValue: paymentMethodLabel(trx.paymentMethod),
      correctedValue: paymentMethodLabel(v.correctedPaymentMethod),
    });
  }
  if (totalChanged) {
    changes.push({
      label: "Total",
      originalValue: fmtRupiah(trx.total),
      correctedValue: fmtRupiah(v.correctedTotal),
    });
  }
  if (splitChanged) {
    changes.push({
      label: "Breakdown Split",
      originalValue: describeSplitBreakdown(currentSplits),
      correctedValue:
        v.correctedPaymentMethod === "split"
          ? describeSplitBreakdown(v.correctedSplitBreakdown)
          : "—",
    });
  }

  const sendPromises = recipients.emails.map((toEmail) =>
    sendEmail(
      buildTransactionCorrectionCodeEmail({
        toEmail,
        ownerName: recipients.primaryOwner?.name ?? "Owner",
        code,
        transactionLabel,
        cashierName: cashierRow?.name ?? "Kasir",
        changes,
        reason: v.reason,
        requestedByName: session.user.name,
        requestedByRole: session.user.role,
        source: windowCheck.source ?? "kasir_active_shift",
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

  // 11. Audit
  await logAudit({
    eventType: "transaction.correction.request",
    userId: session.user.id,
    entityType: "transaction_correction",
    entityId: correctionId,
    payload: {
      summary: `Request koreksi TRX ${trx.transactionNumber}: ${changes.map((c) => `${c.label} ${c.originalValue}→${c.correctedValue}`).join(", ")}`,
      context: {
        transactionId: trx.id,
        transactionNumber: trx.transactionNumber,
        source: windowCheck.source,
        originalPaymentMethod: trx.paymentMethod,
        correctedPaymentMethod: v.correctedPaymentMethod,
        originalTotal: trx.total,
        correctedTotal: v.correctedTotal,
        codeFirstTwo,
        emailMode,
        recipientCount: recipients.emails.length,
      },
    },
    metadata: { outletId: trx.outletId, actorRole: session.user.role },
  });

  return ok({
    correctionId,
    codeFirstTwo,
    expiresAt: expiresAt.toISOString(),
    emailMode,
    ownerEmailMasked: maskEmail(recipients.emails[0] ?? ""),
  });
}

type TransactionCorrectionChangeRow = {
  label: string;
  originalValue: string;
  correctedValue: string;
};

// ============================================================
// Action: approve correction
// ============================================================

/**
 * Sesi AE-62r — approve transaction correction.
 *
 * Atomic workflow:
 *   1. RBAC owner-only
 *   2. SELECT FOR UPDATE on trx (prevent race with void/refund — Trap T4)
 *   3. Re-fetch correction + active code (FOR UPDATE)
 *   4. Re-validate window (shift bisa di-close paksa antara request & approve — Trap T1)
 *   5. Re-validate trx.status = 'paid' & refundedAmount = 0
 *   6. Lockout @ 5 fails, bcrypt.compare
 *   7. Apply: UPDATE trx (paymentMethod, total, discountAmount, cashReceived/Change),
 *      delete+reinsert splits jika applicable, loyalty delta update (preserve redeemed),
 *      mark code consumed, mark correction status='approved'
 *   8. Audit log
 *   9. Post-commit: fire journal hook (reverse + corrected entries)
 */
export async function approveTransactionCorrection(input: {
  correctionId: string;
  code: string;
}): Promise<ApiResult<{ correctionId: string; appliedAt: Date }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.correction.approve")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner yang bisa approve koreksi transaksi. Kasir/Manager minta owner masukin kode.",
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

  // 1. Find correction
  const [correction] = await db
    .select()
    .from(transactionCorrections)
    .where(eq(transactionCorrections.id, v.correctionId))
    .limit(1);
  if (!correction) return fail("NOT_FOUND", "Koreksi tidak ditemukan");
  if (correction.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Koreksi dari outlet lain");
  }
  if (correction.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Koreksi sudah ${correction.status} — tidak bisa approve lagi.`,
    );
  }

  // 2. Find active code
  const [active] = await db
    .select()
    .from(approvalCodes)
    .where(
      and(
        eq(approvalCodes.targetTransactionCorrectionId, v.correctionId),
        eq(approvalCodes.actionType, "pos.transaction.correction"),
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

  // 3. Lockout check
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
        summary: `Kode koreksi dikunci setelah ${FAILED_ATTEMPTS_LOCKOUT_THRESHOLD}x salah`,
        context: { correctionId: v.correctionId },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
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
    return fail("WRONG_CODE", "Kode salah. Cek email/forward dari requester.");
  }

  // 5. Apply correction atomically with SELECT FOR UPDATE
  const now = new Date();
  let trxNumber = "";
  let trxCashierId = "";
  let trxEntryDate = jakartaDateOf(new Date());
  try {
    await db.transaction(async (tx) => {
      // Lock trx row + re-fetch (Trap T4 — prevent racing void/refund).
      const [lockedRow] = await tx
        .select({
          id: transactions.id,
          status: transactions.status,
          paymentMethod: transactions.paymentMethod,
          total: transactions.total,
          subtotal: transactions.subtotal,
          discountAmount: transactions.discountAmount,
          refundedAmount: transactions.refundedAmount,
          customerId: transactions.customerId,
          loyaltyPointsEarned: transactions.loyaltyPointsEarned,
          loyaltyPointsRedeemed: transactions.loyaltyPointsRedeemed,
          cashierId: transactions.cashierId,
          transactionNumber: transactions.transactionNumber,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(eq(transactions.id, correction.transactionId))
        .for("update")
        .limit(1);
      if (!lockedRow) throw new Error("TRX_NOT_FOUND_AT_LOCK");

      if (lockedRow.status !== "paid") {
        throw new Error("TRX_STATUS_CHANGED_NOT_PAID");
      }
      if (lockedRow.refundedAmount > 0) {
        throw new Error("TRX_HAS_REFUND_AT_APPROVE");
      }

      trxNumber = lockedRow.transactionNumber;
      trxCashierId = lockedRow.cashierId;
      trxEntryDate = jakartaDateOf(new Date(lockedRow.createdAt));

      // Re-validate window (Trap T1)
      const [shiftRow] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.id, correction.shiftIdAtRequest))
        .limit(1);
      if (!shiftRow) throw new Error("SHIFT_NOT_FOUND_AT_APPROVE");

      const reCheck = getCorrectableTransactionWindow({
        trx: {
          shiftId: correction.shiftIdAtRequest,
          outletId: correction.outletId,
        },
        shift: {
          id: shiftRow.id,
          status: shiftRow.status,
          closedAt: shiftRow.closedAt,
          outletId: shiftRow.outletId,
        },
        now,
      });
      if (!reCheck.eligible) {
        throw new Error("WINDOW_EXPIRED_AT_APPROVE");
      }

      // Build trx update set
      const correctedPaymentMethod = correction.correctedPaymentMethod;
      const correctedTotal = correction.correctedTotal;
      const correctedDiscountAmount = correction.correctedDiscountAmount;

      const trxUpdate: Record<string, unknown> = {
        paymentMethod: correctedPaymentMethod,
        total: correctedTotal,
        discountAmount: correctedDiscountAmount,
        updatedAt: now,
      };

      // Cash fields constraint handling (ck_transactions_cash_fields):
      //   - paymentMethod='cash': cashReceived MUST be set, cashChange optional
      //   - paymentMethod='split': cashReceived MUST be NULL
      //   - other (qris/card_*): both NULL
      if (correctedPaymentMethod === "cash") {
        trxUpdate.cashReceived = correctedTotal;
        trxUpdate.cashChange = 0;
      } else {
        trxUpdate.cashReceived = null;
        trxUpdate.cashChange = null;
      }

      // Also overwrite discountReason to mark this was a correction
      if (correctedDiscountAmount > 0) {
        trxUpdate.discountReason = `Koreksi AE-62r: ${correction.reason}`;
      } else {
        trxUpdate.discountReason = null;
      }

      await tx
        .update(transactions)
        .set(trxUpdate)
        .where(eq(transactions.id, correction.transactionId));

      // Split handling: delete existing + reinsert if corrected is split,
      // OR delete existing if corrected is single.
      const hadOriginalSplits =
        correction.originalSplitBreakdown !== null &&
        Array.isArray(correction.originalSplitBreakdown) &&
        (correction.originalSplitBreakdown as unknown[]).length > 0;
      const willBeSplit =
        correctedPaymentMethod === "split" &&
        Array.isArray(correction.correctedSplitBreakdown) &&
        (correction.correctedSplitBreakdown as unknown[]).length > 0;

      if (hadOriginalSplits || willBeSplit) {
        // Delete existing splits (cascade ke split_payment_items via FK)
        await tx
          .delete(splitPayments)
          .where(eq(splitPayments.transactionId, correction.transactionId));
      }
      if (willBeSplit) {
        const rows =
          correction.correctedSplitBreakdown as SplitBreakdownRow[] | null;
        if (rows && rows.length > 0) {
          await tx.insert(splitPayments).values(
            rows.map((r) => ({
              transactionId: correction.transactionId,
              outletId: correction.outletId,
              shiftId: correction.shiftIdAtRequest,
              cashierId: trxCashierId,
              amount: r.amount,
              paymentMethod: r.paymentMethod,
              cashReceived:
                r.paymentMethod === "cash"
                  ? (r.cashReceived ?? r.amount)
                  : null,
              cashChange:
                r.paymentMethod === "cash" ? (r.cashChange ?? 0) : null,
              splitKind: "nominal" as const,
            })),
          );
        }
      }

      // Loyalty delta (Trap T5: preserve redeemed, recalc earned only).
      if (lockedRow.customerId) {
        const oldEarn = lockedRow.loyaltyPointsEarned ?? 0;
        const newEarn = computePointsEarned(correctedTotal);
        const delta = newEarn - oldEarn;
        const spentDelta = correctedTotal - lockedRow.total;
        if (delta !== 0) {
          await tx
            .update(customers)
            .set({
              totalPoints: sql`${customers.totalPoints} + ${delta}`,
              totalSpent: sql`${customers.totalSpent} + ${spentDelta}`,
              updatedAt: now,
              updatedBy: session.user.id,
            })
            .where(eq(customers.id, lockedRow.customerId));
          await tx
            .update(transactions)
            .set({ loyaltyPointsEarned: newEarn, updatedAt: now })
            .where(eq(transactions.id, correction.transactionId));
        } else if (spentDelta !== 0) {
          // No earn delta tapi total beda — bump totalSpent saja.
          await tx
            .update(customers)
            .set({
              totalSpent: sql`${customers.totalSpent} + ${spentDelta}`,
              updatedAt: now,
              updatedBy: session.user.id,
            })
            .where(eq(customers.id, lockedRow.customerId));
        }
      }

      // Consume code
      await tx
        .update(approvalCodes)
        .set({ consumedAt: now, consumedByUserId: session.user.id })
        .where(eq(approvalCodes.id, active.id));

      // Mark correction approved
      await tx
        .update(transactionCorrections)
        .set({
          status: "approved",
          approvedBy: session.user.id,
          approvedAt: now,
          approvalCodeId: active.id,
          updatedAt: now,
        })
        .where(eq(transactionCorrections.id, v.correctionId));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "TRX_STATUS_CHANGED_NOT_PAID") {
      return fail(
        "TRX_NOT_PAID",
        "Status transaksi sudah berubah (mungkin di-void/refund). Koreksi dibatalkan.",
      );
    }
    if (msg === "TRX_HAS_REFUND_AT_APPROVE") {
      return fail(
        "TRX_HAS_REFUND",
        "Transaksi sudah ada refund. Koreksi dibatalkan.",
      );
    }
    if (msg === "WINDOW_EXPIRED_AT_APPROVE") {
      return fail(
        "WINDOW_EXPIRED",
        "Shift transaksi sudah ditutup >24 jam sejak request. Pakai shift-level rebalance.",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "transaction-correction.approve",
        "Operasi database gagal",
      ),
    );
  }

  // 6. Audit log
  await logAudit({
    eventType: "transaction.correction.approve",
    userId: session.user.id,
    entityType: "transaction_correction",
    entityId: v.correctionId,
    payload: {
      summary: `Approve koreksi TRX ${trxNumber}: ${correction.originalPaymentMethod}→${correction.correctedPaymentMethod}, ${correction.originalTotal}→${correction.correctedTotal}`,
      context: {
        transactionId: correction.transactionId,
        transactionNumber: trxNumber,
        originalPaymentMethod: correction.originalPaymentMethod,
        correctedPaymentMethod: correction.correctedPaymentMethod,
        originalTotal: correction.originalTotal,
        correctedTotal: correction.correctedTotal,
        codeFirstTwo: active.codeFirstTwo,
      },
    },
    metadata: { outletId: correction.outletId, actorRole: session.user.role },
  });

  // 7. Fire journal hook (post-commit, fire-and-forget)
  fireJournalHook(
    async () => {
      await postJournalForTransactionCorrection({
        outletId: correction.outletId,
        transactionId: correction.transactionId,
        transactionNumber: trxNumber,
        correctionId: v.correctionId,
        original: {
          paymentMethod: correction.originalPaymentMethod as
            | "cash"
            | "qris"
            | "card_bca"
            | "card_bni"
            | "card_mandiri"
            | "card_bri"
            | "card_other"
            | "split",
          total: correction.originalTotal,
          subtotal: correction.originalSubtotal,
          discountAmount: correction.originalDiscountAmount,
          splits:
            (correction.originalSplitBreakdown as
              | Array<{
                  paymentMethod:
                    | "cash"
                    | "qris"
                    | "card_bca"
                    | "card_bni"
                    | "card_mandiri"
                    | "card_bri"
                    | "card_other";
                  amount: number;
                }>
              | null) ?? null,
        },
        corrected: {
          paymentMethod: correction.correctedPaymentMethod as
            | "cash"
            | "qris"
            | "card_bca"
            | "card_bni"
            | "card_mandiri"
            | "card_bri"
            | "card_other"
            | "split",
          total: correction.correctedTotal,
          subtotal: correction.originalSubtotal, // subtotal not changed
          discountAmount: correction.correctedDiscountAmount,
          splits:
            (correction.correctedSplitBreakdown as
              | Array<{
                  paymentMethod:
                    | "cash"
                    | "qris"
                    | "card_bca"
                    | "card_bni"
                    | "card_mandiri"
                    | "card_bri"
                    | "card_other";
                  amount: number;
                }>
              | null) ?? null,
        },
        reason: correction.reason,
        entryDate: trxEntryDate,
        actorId: session.user.id,
      });
    },
    "pos_sale_correction",
    {
      sourceId: v.correctionId,
      outletId: correction.outletId,
      actorId: session.user.id,
    },
  );

  return ok({ correctionId: v.correctionId, appliedAt: now });
}

// ============================================================
// Action: reject correction
// ============================================================

export async function rejectTransactionCorrection(input: {
  correctionId: string;
  reason: string;
}): Promise<ApiResult<{ correctionId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.correction.reject")) {
    return fail("FORBIDDEN", "Tidak punya hak reject koreksi");
  }
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Alasan reject minimal 3 karakter",
    );
  }
  const v = parsed.data;
  const [correction] = await db
    .select()
    .from(transactionCorrections)
    .where(eq(transactionCorrections.id, v.correctionId))
    .limit(1);
  if (!correction) return fail("NOT_FOUND", "Koreksi tidak ditemukan");
  if (correction.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Koreksi dari outlet lain");
  }
  if (correction.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Koreksi sudah ${correction.status} — tidak bisa reject lagi.`,
    );
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(transactionCorrections)
      .set({
        status: "rejected",
        rejectedBy: session.user.id,
        rejectedAt: now,
        rejectedReason: v.reason,
        updatedAt: now,
      })
      .where(eq(transactionCorrections.id, v.correctionId));
    await tx
      .update(approvalCodes)
      .set({ revokedAt: now, revokedByUserId: session.user.id })
      .where(
        and(
          eq(approvalCodes.targetTransactionCorrectionId, v.correctionId),
          isNull(approvalCodes.consumedAt),
          isNull(approvalCodes.revokedAt),
        ),
      );
  });
  await logAudit({
    eventType: "transaction.correction.reject",
    userId: session.user.id,
    entityType: "transaction_correction",
    entityId: v.correctionId,
    payload: {
      summary: `Reject koreksi TRX ${correction.transactionId.slice(0, 8)}: ${v.reason}`,
      context: {
        transactionId: correction.transactionId,
        reason: v.reason,
      },
    },
    metadata: { outletId: correction.outletId, actorRole: session.user.role },
  });
  return ok({ correctionId: v.correctionId });
}

// ============================================================
// Action: cancel correction
// ============================================================

export async function cancelTransactionCorrection(input: {
  correctionId: string;
}): Promise<ApiResult<{ correctionId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.correction.cancel")) {
    return fail("FORBIDDEN", "Tidak punya hak cancel koreksi");
  }
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Input tidak valid");
  }
  const v = parsed.data;
  const [correction] = await db
    .select()
    .from(transactionCorrections)
    .where(eq(transactionCorrections.id, v.correctionId))
    .limit(1);
  if (!correction) return fail("NOT_FOUND", "Koreksi tidak ditemukan");
  if (correction.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Koreksi dari outlet lain");
  }
  // Only requester or owner can cancel (owner sebenarnya pakai reject — defensive allow)
  if (
    correction.requestedBy !== session.user.id &&
    session.user.role !== "owner"
  ) {
    return fail(
      "NOT_OWNER_OF_REQUEST",
      "Hanya requester yang bisa cancel. Owner pakai reject.",
    );
  }
  if (correction.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Koreksi sudah ${correction.status} — tidak bisa cancel.`,
    );
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(transactionCorrections)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(transactionCorrections.id, v.correctionId));
    await tx
      .update(approvalCodes)
      .set({ revokedAt: now, revokedByUserId: session.user.id })
      .where(
        and(
          eq(approvalCodes.targetTransactionCorrectionId, v.correctionId),
          isNull(approvalCodes.consumedAt),
          isNull(approvalCodes.revokedAt),
        ),
      );
  });
  await logAudit({
    eventType: "transaction.correction.cancel",
    userId: session.user.id,
    entityType: "transaction_correction",
    entityId: v.correctionId,
    payload: {
      summary: `Cancel koreksi TRX ${correction.transactionId.slice(0, 8)} oleh requester`,
      context: { transactionId: correction.transactionId },
    },
    metadata: { outletId: correction.outletId, actorRole: session.user.role },
  });
  return ok({ correctionId: v.correctionId });
}

// ============================================================
// Read helpers
// ============================================================

export interface CorrectionAvailabilityResult {
  eligibility: {
    eligible: boolean;
    source: CorrectionWindowSource | null;
    reason: string | null;
  };
  pendingCorrection: {
    id: string;
    status: "pending_approval";
    requestedBy: string;
    requestedByName: string | null;
    requestedAt: Date;
    correctedPaymentMethod: string;
    correctedTotal: number;
    reason: string;
    codeFirstTwo: string | null;
    canApprove: boolean;
    canReject: boolean;
    canCancel: boolean;
  } | null;
  /** Window post-close deadline (kalau eligible via post_close), wall-clock ISO. */
  postCloseDeadline?: string;
}

/**
 * Sesi AE-62r — single roundtrip helper untuk HistoryDetailModal.
 *
 * Returns:
 *   - eligibility: apakah trx ini bisa di-koreksi (window check)
 *   - pendingCorrection: existing pending correction (kalau ada) + flags
 *     siapa boleh approve/reject/cancel
 *   - postCloseDeadline: kalau shift sudah closed, kapan jendela 24h habis
 *
 * Tidak fetch trx itself — caller sudah punya dari fetchTransactionById.
 */
export async function getTransactionCorrectionState(
  trxId: string,
): Promise<ApiResult<CorrectionAvailabilityResult>> {
  const session = await requireSession();
  const [trx] = await db
    .select({
      id: transactions.id,
      outletId: transactions.outletId,
      shiftId: transactions.shiftId,
      status: transactions.status,
      refundedAmount: transactions.refundedAmount,
    })
    .from(transactions)
    .where(eq(transactions.id, trxId))
    .limit(1);
  if (!trx) return fail("NOT_FOUND", "Transaksi tidak ditemukan");
  if (trx.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Transaksi dari outlet lain");
  }

  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, trx.shiftId))
    .limit(1);

  const now = new Date();
  let eligibility: CorrectionAvailabilityResult["eligibility"];
  let postCloseDeadline: string | undefined;

  if (!shift) {
    eligibility = {
      eligible: false,
      source: null,
      reason: "SHIFT_NOT_FOUND",
    };
  } else if (trx.status !== "paid" || trx.refundedAmount > 0) {
    eligibility = {
      eligible: false,
      source: null,
      reason:
        trx.status !== "paid"
          ? `TRX_STATUS_${trx.status.toUpperCase()}`
          : "TRX_HAS_REFUND",
    };
  } else {
    const check = getCorrectableTransactionWindow({
      trx: { shiftId: trx.shiftId, outletId: trx.outletId },
      shift: {
        id: shift.id,
        status: shift.status,
        closedAt: shift.closedAt,
        outletId: shift.outletId,
      },
      now,
    });
    eligibility = check;
    if (check.eligible && check.source === "kasir_post_close" && shift.closedAt) {
      postCloseDeadline = new Date(
        shift.closedAt.getTime() + CORRECTION_POST_CLOSE_WINDOW_MS,
      ).toISOString();
    }
  }

  // Look for pending correction
  const [pending] = await db
    .select({
      id: transactionCorrections.id,
      status: transactionCorrections.status,
      requestedBy: transactionCorrections.requestedBy,
      requestedByName: users.name,
      requestedAt: transactionCorrections.requestedAt,
      correctedPaymentMethod: transactionCorrections.correctedPaymentMethod,
      correctedTotal: transactionCorrections.correctedTotal,
      reason: transactionCorrections.reason,
    })
    .from(transactionCorrections)
    .leftJoin(users, eq(users.id, transactionCorrections.requestedBy))
    .where(
      and(
        eq(transactionCorrections.transactionId, trxId),
        eq(transactionCorrections.status, "pending_approval"),
      ),
    )
    .limit(1);

  let pendingCorrection: CorrectionAvailabilityResult["pendingCorrection"] =
    null;
  if (pending) {
    // Lookup active code for codeFirstTwo hint (UI display only)
    const [code] = await db
      .select({ codeFirstTwo: approvalCodes.codeFirstTwo })
      .from(approvalCodes)
      .where(
        and(
          eq(approvalCodes.targetTransactionCorrectionId, pending.id),
          eq(approvalCodes.actionType, "pos.transaction.correction"),
          isNull(approvalCodes.consumedAt),
          isNull(approvalCodes.revokedAt),
          gt(approvalCodes.expiresAt, now),
        ),
      )
      .orderBy(desc(approvalCodes.createdAt))
      .limit(1);
    pendingCorrection = {
      id: pending.id,
      status: "pending_approval",
      requestedBy: pending.requestedBy,
      requestedByName: pending.requestedByName,
      requestedAt: pending.requestedAt,
      correctedPaymentMethod: pending.correctedPaymentMethod,
      correctedTotal: pending.correctedTotal,
      reason: pending.reason,
      codeFirstTwo: code?.codeFirstTwo ?? null,
      canApprove: hasPermission(
        session.user.role,
        "pos.transaction.correction.approve",
      ),
      canReject: hasPermission(
        session.user.role,
        "pos.transaction.correction.reject",
      ),
      canCancel:
        hasPermission(
          session.user.role,
          "pos.transaction.correction.cancel",
        ) &&
        (pending.requestedBy === session.user.id ||
          session.user.role === "owner"),
    };
  }

  return ok({ eligibility, pendingCorrection, postCloseDeadline });
}

/**
 * List transaction corrections (filter status / transaction / outlet scope).
 * Owner/manager/supervisor only (RBAC view). Used by Admin → Audit / future
 * inbox page.
 */
export async function listTransactionCorrections(
  opts: {
    status?:
      | "pending_approval"
      | "approved"
      | "rejected"
      | "cancelled"
      | "all";
    transactionId?: string;
    limit?: number;
  } = {},
): Promise<
  ApiResult<
    Array<
      TransactionCorrection & {
        requesterName: string | null;
        approverName: string | null;
        transactionNumber: string | null;
      }
    >
  >
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "pos.transaction.correction.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat koreksi");
  }
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [eq(transactionCorrections.outletId, session.user.outletId)];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(transactionCorrections.status, opts.status));
  }
  if (opts.transactionId) {
    conds.push(eq(transactionCorrections.transactionId, opts.transactionId));
  }
  const rows = await db
    .select({
      c: transactionCorrections,
      requesterName: users.name,
      transactionNumber: transactions.transactionNumber,
    })
    .from(transactionCorrections)
    .leftJoin(users, eq(users.id, transactionCorrections.requestedBy))
    .leftJoin(
      transactions,
      eq(transactions.id, transactionCorrections.transactionId),
    )
    .where(and(...conds))
    .orderBy(desc(transactionCorrections.requestedAt))
    .limit(limit);

  // Resolve approver names separately
  const approverIds = new Set<string>();
  for (const r of rows) {
    if (r.c.approvedBy) approverIds.add(r.c.approvedBy);
  }
  const nameById = new Map<string, string>();
  if (approverIds.size > 0) {
    const usrRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(sql`${users.id} = ANY(${Array.from(approverIds)})`);
    for (const u of usrRows) nameById.set(u.id, u.name);
  }

  return ok(
    rows.map((r) => ({
      ...r.c,
      requesterName: r.requesterName,
      approverName: r.c.approvedBy
        ? (nameById.get(r.c.approvedBy) ?? null)
        : null,
      transactionNumber: r.transactionNumber,
    })),
  );
}
