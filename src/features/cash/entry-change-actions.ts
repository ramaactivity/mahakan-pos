"use server";

/**
 * Sesi AE-67 — Entry Change (pengeluaran/pemasukan) suggest workflow.
 *
 * Mirror pattern shift_rebalances (AE-62o):
 *   - Staff propose UPDATE/DELETE → server generate 6-digit code → email ke owner
 *   - Owner input kode di Back Office → atomic apply mutation
 *
 * ADD (create new entry) TIDAK lewat sini — staff sudah punya perm
 * `expense.create` / `income.create` direct via PettyCashCard di POS.
 */

import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  approvalCodes,
  expenseCategories,
  expenses,
  incomes,
  outlets,
  pendingEntryChanges,
  users,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { sendEmail } from "@/lib/email/send";
import { buildEntryChangeCodeEmail } from "@/lib/email/templates/entry-change-code";
import {
  computeApprovalCodeExpiry,
  FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
  generateNumericCode6,
  maskEmail,
} from "@/features/approval-codes/types";
import { resolveOwnerEmailRecipients } from "@/features/approval-codes/recipients";
import { fail, ok, type ApiResult } from "./types";

const BCRYPT_COST = 10;
// PEC wrapper TTL — kasih buffer 24 jam supaya PEC row tidak expire sebelum
// codenya (code paling lama valid sampai 23:59 WIB hari yang sama, jadi 24 jam
// dari sekarang pasti lebih panjang). Mencegah UI "kode masih hidup tapi PEC
// sudah expired".
const PEC_EXPIRY_MS = 24 * 60 * 60 * 1000;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ============================================================
// Schemas
// ============================================================

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD");

const proposedExpenseSchema = z.object({
  expenseDate: isoDate.optional(),
  categoryId: z.uuid().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  amount: z.number().int().min(1).max(99_999_999).optional(),
  paymentMethod: z.enum(["cash", "transfer", "other"]).optional(),
});

const proposedIncomeSchema = z.object({
  incomeDate: isoDate.optional(),
  description: z.string().trim().min(1).max(200).optional(),
  amount: z.number().int().min(1).max(99_999_999).optional(),
  paymentMethod: z.enum(["cash", "transfer", "other"]).optional(),
});

const proposeSchema = z.discriminatedUnion("entityType", [
  z.object({
    operation: z.enum(["update", "delete"]),
    entityType: z.literal("expense"),
    entityId: z.uuid(),
    proposedData: proposedExpenseSchema.optional(),
    reason: z.string().trim().min(3).max(500),
    shiftId: z.uuid().optional(),
  }),
  z.object({
    operation: z.enum(["update", "delete"]),
    entityType: z.literal("income"),
    entityId: z.uuid(),
    proposedData: proposedIncomeSchema.optional(),
    reason: z.string().trim().min(3).max(500),
    shiftId: z.uuid().optional(),
  }),
]);

const approveSchema = z.object({
  changeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, "Kode 6 digit angka"),
});

const rejectSchema = z.object({
  changeId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

const cancelSchema = z.object({ changeId: z.uuid() });

export type PendingEntryChange = typeof pendingEntryChanges.$inferSelect;
export type ProposeEntryChangeInput = z.input<typeof proposeSchema>;

// ============================================================
// Helpers
// ============================================================

function summarizeEntity(entityType: "expense" | "income", data: Record<string, unknown>): string {
  const amount = typeof data.amount === "number" ? data.amount : Number(data.amount ?? 0);
  const desc = typeof data.description === "string" ? data.description : "(tanpa deskripsi)";
  return `${entityType === "expense" ? "Pengeluaran" : "Pemasukan"} Rp${amount.toLocaleString("id-ID")} — ${desc}`;
}

// ============================================================
// PROPOSE
// ============================================================

export async function proposeEntryChange(input: ProposeEntryChangeInput): Promise<
  ApiResult<{
    changeId: string;
    codeFirstTwo: string;
    expiresAt: string;
    emailMode: "sent" | "logged" | "failed";
    ownerEmailMasked: string;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "entry_change.propose")) {
    return fail("FORBIDDEN", "Tidak punya hak ajukan koreksi entry");
  }
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  // Validate operation+proposedData consistency
  if (v.operation === "update" && (!v.proposedData || Object.keys(v.proposedData).length === 0)) {
    return fail("VALIDATION_ERROR", "Update wajib punya minimal satu field yang diubah");
  }

  // 1. Fetch original entity (snapshot)
  let originalData: Record<string, unknown>;
  if (v.entityType === "expense") {
    const [row] = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.id, v.entityId),
          eq(expenses.outletId, session.user.outletId),
          isNull(expenses.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return fail("NOT_FOUND", "Pengeluaran tidak ditemukan");
    if (row.refundedTransactionId) {
      return fail(
        "BUSINESS_RULE_VIOLATION",
        "Refund auto tidak bisa di-edit/hapus manual — koreksi via Riwayat POS.",
      );
    }
    originalData = {
      id: row.id,
      expenseDate: row.expenseDate,
      categoryId: row.categoryId,
      description: row.description,
      amount: row.amount,
      paymentMethod: row.paymentMethod,
      sourceType: row.sourceType,
    };
  } else {
    const [row] = await db
      .select()
      .from(incomes)
      .where(
        and(
          eq(incomes.id, v.entityId),
          eq(incomes.outletId, session.user.outletId),
          isNull(incomes.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return fail("NOT_FOUND", "Pemasukan tidak ditemukan");
    originalData = {
      id: row.id,
      incomeDate: row.incomeDate,
      description: row.description,
      amount: row.amount,
      paymentMethod: row.paymentMethod,
    };
  }

  // 2. Validate categoryId belongs to outlet (untuk expense update)
  if (v.entityType === "expense" && v.proposedData && "categoryId" in v.proposedData && v.proposedData.categoryId) {
    const [cat] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.id, v.proposedData.categoryId),
          eq(expenseCategories.outletId, session.user.outletId),
          isNull(expenseCategories.deletedAt),
        ),
      )
      .limit(1);
    if (!cat) return fail("VALIDATION_ERROR", "Kategori target tidak ditemukan");
  }

  // 3. Check existing pending change for this entity
  const [existing] = await db
    .select({ id: pendingEntryChanges.id })
    .from(pendingEntryChanges)
    .where(
      and(
        eq(pendingEntryChanges.entityType, v.entityType),
        eq(pendingEntryChanges.entityId, v.entityId),
        eq(pendingEntryChanges.status, "pending_approval"),
      ),
    )
    .limit(1);
  if (existing) {
    return fail(
      "ALREADY_PENDING",
      "Sudah ada koreksi pending untuk entry ini. Tunggu owner approve / reject dulu.",
    );
  }

  // 4. Resolve owner email recipients
  const recipients = await resolveOwnerEmailRecipients(session.user.outletId);
  if (!recipients) {
    return fail(
      "NO_OWNER_EMAIL",
      "Email Owner belum diset. Owner login → Pengaturan → tambah email approval dulu.",
    );
  }

  // 5. Create row + approval code (transactional)
  const code = generateNumericCode6();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const codeFirstTwo = code.slice(0, 2);
  const now = new Date();
  const codeExpiresAt = computeApprovalCodeExpiry(now);
  const pecExpiresAt = new Date(now.getTime() + PEC_EXPIRY_MS);

  let changeId: string;
  let approvalCodeId: string;
  try {
    const result = await db.transaction(async (tx) => {
      const [pec] = await tx
        .insert(pendingEntryChanges)
        .values({
          outletId: session.user.outletId,
          shiftId: v.shiftId ?? null,
          status: "pending_approval",
          operation: v.operation,
          entityType: v.entityType,
          entityId: v.entityId,
          originalData,
          proposedData: v.operation === "delete" ? null : v.proposedData ?? null,
          reason: v.reason,
          requestedBy: session.user.id,
          expiresAt: pecExpiresAt,
        })
        .returning({ id: pendingEntryChanges.id });
      if (!pec) throw new Error("CREATE_PEC_FAILED");

      const [ac] = await tx
        .insert(approvalCodes)
        .values({
          codeHash,
          codeFirstTwo,
          actionType: "entry_change",
          targetEntryChangeId: pec.id,
          outletId: session.user.outletId,
          requestedByUserId: session.user.id,
          reason: v.reason,
          expiresAt: codeExpiresAt,
        })
        .returning({ id: approvalCodes.id });
      if (!ac) throw new Error("CREATE_AC_FAILED");

      await tx
        .update(pendingEntryChanges)
        .set({ approvalCodeId: ac.id })
        .where(eq(pendingEntryChanges.id, pec.id));

      return { changeId: pec.id, approvalCodeId: ac.id };
    });
    changeId = result.changeId;
    approvalCodeId = result.approvalCodeId;
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "entry-change.propose", "Operasi database gagal"),
    );
  }

  // 6. Send email
  const [outletRow] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);

  const sendPromises = recipients.emails.map((toEmail) =>
    sendEmail(
      buildEntryChangeCodeEmail({
        toEmail,
        ownerName: recipients.primaryOwner?.name ?? "Owner",
        code,
        operation: v.operation,
        entityType: v.entityType,
        originalSummary: summarizeEntity(v.entityType, originalData),
        proposedData: v.operation === "delete" ? null : (v.proposedData as Record<string, unknown> | undefined) ?? null,
        reason: v.reason,
        requestedByName: session.user.name,
        requestedByRole: session.user.role,
        expiresAt: codeExpiresAt,
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

  // 7. Audit
  await logAudit({
    eventType: "entry_change.propose",
    userId: session.user.id,
    entityType: "pending_entry_change",
    entityId: changeId,
    payload: {
      summary: `Propose ${v.operation} ${v.entityType} — ${v.reason}`,
      context: {
        operation: v.operation,
        entityType: v.entityType,
        entityId: v.entityId,
        codeFirstTwo,
        emailMode,
        approvalCodeId,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({
    changeId,
    codeFirstTwo,
    expiresAt: codeExpiresAt.toISOString(),
    emailMode,
    ownerEmailMasked: maskEmail(recipients.emails[0] ?? ""),
  });
}

// ============================================================
// APPROVE
// ============================================================

export async function approveEntryChange(input: {
  changeId: string;
  code: string;
}): Promise<ApiResult<{ changeId: string; appliedAt: Date }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "entry_change.approve")) {
    return fail(
      "FORBIDDEN",
      "Tidak punya akses apply kode approval. Hubungi Owner.",
    );
  }
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  // 1. Find change
  const [pec] = await db
    .select()
    .from(pendingEntryChanges)
    .where(eq(pendingEntryChanges.id, v.changeId))
    .limit(1);
  if (!pec) return fail("NOT_FOUND", "Koreksi entry tidak ditemukan");
  if (pec.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Koreksi dari outlet lain");
  }
  if (pec.status !== "pending_approval") {
    return fail("INVALID_STATE", `Koreksi sudah ${pec.status} — tidak bisa approve lagi.`);
  }
  if (pec.expiresAt < new Date()) {
    await db
      .update(pendingEntryChanges)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(pendingEntryChanges.id, pec.id));
    return fail("EXPIRED", "Koreksi sudah kadaluarsa. Minta requester ajukan ulang.");
  }

  // 2. Find active code
  const [active] = await db
    .select()
    .from(approvalCodes)
    .where(
      and(
        eq(approvalCodes.targetEntryChangeId, v.changeId),
        eq(approvalCodes.actionType, "entry_change"),
        isNull(approvalCodes.consumedAt),
        isNull(approvalCodes.revokedAt),
        gt(approvalCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(approvalCodes.createdAt))
    .limit(1);
  if (!active) {
    return fail("NO_ACTIVE_CODE", "Tidak ada kode aktif. Minta requester re-submit.");
  }

  // 3. Lockout check
  if (active.failedAttempts >= FAILED_ATTEMPTS_LOCKOUT_THRESHOLD) {
    await db
      .update(approvalCodes)
      .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
      .where(eq(approvalCodes.id, active.id));
    return fail("LOCKED", "Kode dikunci karena terlalu banyak salah. Minta requester resubmit.");
  }

  // 4. Verify code
  const match = await bcrypt.compare(v.code.trim(), active.codeHash);
  if (!match) {
    await db
      .update(approvalCodes)
      .set({ failedAttempts: active.failedAttempts + 1 })
      .where(eq(approvalCodes.id, active.id));
    return fail("CODE_INVALID", "Kode salah");
  }

  // 5. Apply mutation atomically
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      if (pec.operation === "delete") {
        if (pec.entityType === "expense") {
          await tx
            .update(expenses)
            .set({
              deletedAt: now,
              deletedBy: session.user.id,
              updatedAt: now,
              updatedBy: session.user.id,
            })
            .where(eq(expenses.id, pec.entityId));
        } else {
          await tx
            .update(incomes)
            .set({
              deletedAt: now,
              deletedBy: session.user.id,
              updatedAt: now,
              updatedBy: session.user.id,
            })
            .where(eq(incomes.id, pec.entityId));
        }
      } else {
        const proposed = (pec.proposedData ?? {}) as Record<string, unknown>;
        if (pec.entityType === "expense") {
          const updates: Partial<typeof expenses.$inferInsert> = {
            updatedAt: now,
            updatedBy: session.user.id,
          };
          if (typeof proposed.expenseDate === "string") updates.expenseDate = proposed.expenseDate;
          if (typeof proposed.categoryId === "string") updates.categoryId = proposed.categoryId;
          if (typeof proposed.description === "string") updates.description = proposed.description;
          if (typeof proposed.amount === "number") updates.amount = proposed.amount;
          if (typeof proposed.paymentMethod === "string") {
            updates.paymentMethod = proposed.paymentMethod as "cash" | "transfer" | "other";
          }
          await tx.update(expenses).set(updates).where(eq(expenses.id, pec.entityId));
        } else {
          const updates: Partial<typeof incomes.$inferInsert> = {
            updatedAt: now,
            updatedBy: session.user.id,
          };
          if (typeof proposed.incomeDate === "string") updates.incomeDate = proposed.incomeDate;
          if (typeof proposed.description === "string") updates.description = proposed.description;
          if (typeof proposed.amount === "number") updates.amount = proposed.amount;
          if (typeof proposed.paymentMethod === "string") {
            updates.paymentMethod = proposed.paymentMethod as "cash" | "transfer" | "other";
          }
          await tx.update(incomes).set(updates).where(eq(incomes.id, pec.entityId));
        }
      }

      await tx
        .update(pendingEntryChanges)
        .set({
          status: "approved",
          approvedBy: session.user.id,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(pendingEntryChanges.id, pec.id));

      await tx
        .update(approvalCodes)
        .set({ consumedAt: now, consumedByUserId: session.user.id })
        .where(eq(approvalCodes.id, active.id));
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "entry-change.approve", "Operasi database gagal"),
    );
  }

  // 6. Audit log
  await logAudit({
    eventType: "entry_change.approve",
    userId: session.user.id,
    entityType: "pending_entry_change",
    entityId: pec.id,
    payload: {
      summary: `Approve ${pec.operation} ${pec.entityType} — ${pec.reason}`,
      before: pec.originalData as Record<string, unknown>,
      after: pec.operation === "delete" ? null : (pec.proposedData as Record<string, unknown> | null),
      context: { operation: pec.operation, entityType: pec.entityType, entityId: pec.entityId },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ changeId: pec.id, appliedAt: now });
}

/**
 * Direct-approve oleh owner langsung dari Pusat Persetujuan — tanpa kode.
 * Identik dengan [[approveEntryChange]] kecuali skip code verify dan revoke
 * active code (bukan consume). Owner-only.
 */
export async function approveEntryChangeDirect(input: {
  changeId: string;
}): Promise<ApiResult<{ changeId: string; appliedAt: Date }>> {
  const session = await requireSession();
  if (session.user.role !== "owner") {
    return fail(
      "FORBIDDEN",
      "Direct approve hanya untuk Owner. Manager pakai jalur kode.",
    );
  }

  const [pec] = await db
    .select()
    .from(pendingEntryChanges)
    .where(eq(pendingEntryChanges.id, input.changeId))
    .limit(1);
  if (!pec) return fail("NOT_FOUND", "Koreksi entry tidak ditemukan");
  if (pec.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Koreksi dari outlet lain");
  }
  if (pec.status !== "pending_approval") {
    return fail(
      "INVALID_STATE",
      `Koreksi sudah ${pec.status} — tidak bisa approve lagi.`,
    );
  }
  if (pec.expiresAt < new Date()) {
    await db
      .update(pendingEntryChanges)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(pendingEntryChanges.id, pec.id));
    return fail(
      "EXPIRED",
      "Koreksi sudah kadaluarsa. Minta requester ajukan ulang.",
    );
  }

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      if (pec.operation === "delete") {
        if (pec.entityType === "expense") {
          await tx
            .update(expenses)
            .set({
              deletedAt: now,
              deletedBy: session.user.id,
              updatedAt: now,
              updatedBy: session.user.id,
            })
            .where(eq(expenses.id, pec.entityId));
        } else {
          await tx
            .update(incomes)
            .set({
              deletedAt: now,
              deletedBy: session.user.id,
              updatedAt: now,
              updatedBy: session.user.id,
            })
            .where(eq(incomes.id, pec.entityId));
        }
      } else {
        const proposed = (pec.proposedData ?? {}) as Record<string, unknown>;
        if (pec.entityType === "expense") {
          const updates: Partial<typeof expenses.$inferInsert> = {
            updatedAt: now,
            updatedBy: session.user.id,
          };
          if (typeof proposed.expenseDate === "string")
            updates.expenseDate = proposed.expenseDate;
          if (typeof proposed.categoryId === "string")
            updates.categoryId = proposed.categoryId;
          if (typeof proposed.description === "string")
            updates.description = proposed.description;
          if (typeof proposed.amount === "number")
            updates.amount = proposed.amount;
          if (typeof proposed.paymentMethod === "string") {
            updates.paymentMethod = proposed.paymentMethod as
              | "cash"
              | "transfer"
              | "other";
          }
          await tx
            .update(expenses)
            .set(updates)
            .where(eq(expenses.id, pec.entityId));
        } else {
          const updates: Partial<typeof incomes.$inferInsert> = {
            updatedAt: now,
            updatedBy: session.user.id,
          };
          if (typeof proposed.incomeDate === "string")
            updates.incomeDate = proposed.incomeDate;
          if (typeof proposed.description === "string")
            updates.description = proposed.description;
          if (typeof proposed.amount === "number")
            updates.amount = proposed.amount;
          if (typeof proposed.paymentMethod === "string") {
            updates.paymentMethod = proposed.paymentMethod as
              | "cash"
              | "transfer"
              | "other";
          }
          await tx
            .update(incomes)
            .set(updates)
            .where(eq(incomes.id, pec.entityId));
        }
      }

      await tx
        .update(pendingEntryChanges)
        .set({
          status: "approved",
          approvedBy: session.user.id,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(pendingEntryChanges.id, pec.id));

      // Revoke any active code (owner direct, code bypass).
      await tx
        .update(approvalCodes)
        .set({ revokedAt: now, revokedByUserId: session.user.id })
        .where(
          and(
            eq(approvalCodes.targetEntryChangeId, pec.id),
            isNull(approvalCodes.consumedAt),
            isNull(approvalCodes.revokedAt),
          ),
        );
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "entry-change.approve.direct", "Operasi database gagal"),
    );
  }

  await logAudit({
    eventType: "entry_change.approve",
    userId: session.user.id,
    entityType: "pending_entry_change",
    entityId: pec.id,
    payload: {
      summary: `Approve ${pec.operation} ${pec.entityType} (direct owner) — ${pec.reason}`,
      before: pec.originalData as Record<string, unknown>,
      after:
        pec.operation === "delete"
          ? null
          : (pec.proposedData as Record<string, unknown> | null),
      context: {
        operation: pec.operation,
        entityType: pec.entityType,
        entityId: pec.entityId,
        directOwnerApprove: true,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ changeId: pec.id, appliedAt: now });
}

// ============================================================
// REJECT
// ============================================================

export async function rejectEntryChange(input: {
  changeId: string;
  reason: string;
}): Promise<ApiResult<{ changeId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "entry_change.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak reject koreksi entry");
  }
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  const [pec] = await db
    .select()
    .from(pendingEntryChanges)
    .where(eq(pendingEntryChanges.id, v.changeId))
    .limit(1);
  if (!pec) return fail("NOT_FOUND", "Koreksi tidak ditemukan");
  if (pec.outletId !== session.user.outletId) return fail("FORBIDDEN", "Outlet lain");
  if (pec.status !== "pending_approval") {
    return fail("INVALID_STATE", `Sudah ${pec.status}.`);
  }
  /* Sesi AE-150 — Submitter tidak boleh reject pengajuannya sendiri
   * (semantic-nya cancel). Owner exception. */
  if (
    pec.requestedBy === session.user.id &&
    session.user.role !== "owner"
  ) {
    return fail(
      "FORBIDDEN_SELF_REJECT",
      "Tidak bisa reject pengajuan sendiri — pakai Cancel.",
    );
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(pendingEntryChanges)
      .set({
        status: "rejected",
        rejectedBy: session.user.id,
        rejectedAt: now,
        rejectedReason: v.reason,
        updatedAt: now,
      })
      .where(eq(pendingEntryChanges.id, pec.id));
    if (pec.approvalCodeId) {
      await tx
        .update(approvalCodes)
        .set({ revokedAt: now, revokedByUserId: session.user.id })
        .where(eq(approvalCodes.id, pec.approvalCodeId));
    }
  });

  await logAudit({
    eventType: "entry_change.reject",
    userId: session.user.id,
    entityType: "pending_entry_change",
    entityId: pec.id,
    payload: {
      summary: `Reject ${pec.operation} ${pec.entityType} — ${v.reason}`,
      context: { rejectReason: v.reason },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ changeId: pec.id });
}

// ============================================================
// CANCEL (requester sendiri)
// ============================================================

export async function cancelEntryChange(input: {
  changeId: string;
}): Promise<ApiResult<{ changeId: string }>> {
  const session = await requireSession();
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Input tidak valid");
  const v = parsed.data;

  const [pec] = await db
    .select()
    .from(pendingEntryChanges)
    .where(eq(pendingEntryChanges.id, v.changeId))
    .limit(1);
  if (!pec) return fail("NOT_FOUND", "Koreksi tidak ditemukan");
  if (pec.outletId !== session.user.outletId) return fail("FORBIDDEN", "Outlet lain");
  if (pec.requestedBy !== session.user.id && !hasPermission(session.user.role, "entry_change.approve")) {
    return fail("FORBIDDEN", "Hanya pengaju atau owner yang bisa cancel");
  }
  if (pec.status !== "pending_approval") {
    return fail("INVALID_STATE", `Sudah ${pec.status}.`);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(pendingEntryChanges)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(pendingEntryChanges.id, pec.id));
    if (pec.approvalCodeId) {
      await tx
        .update(approvalCodes)
        .set({ revokedAt: now, revokedByUserId: session.user.id })
        .where(eq(approvalCodes.id, pec.approvalCodeId));
    }
  });

  await logAudit({
    eventType: "entry_change.cancel",
    userId: session.user.id,
    entityType: "pending_entry_change",
    entityId: pec.id,
    payload: { summary: `Cancel koreksi ${pec.operation} ${pec.entityType}` },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ changeId: pec.id });
}

// ============================================================
// LIST
// ============================================================

export interface PendingEntryChangeWithMeta extends PendingEntryChange {
  requestedByName: string | null;
  approvedByName: string | null;
  rejectedByName: string | null;
}

export async function listPendingEntryChanges(opts: {
  status?: "pending_approval" | "approved" | "rejected" | "cancelled" | "expired";
  limit?: number;
} = {}): Promise<ApiResult<PendingEntryChangeWithMeta[]>> {
  const session = await requireSession();
  // Semua role bisa list (untuk show pending state di UI). Filter outlet
  // di server supaya tidak cross-outlet.
  const limit = opts.limit ?? 50;
  const conds = [eq(pendingEntryChanges.outletId, session.user.outletId)];
  if (opts.status) conds.push(eq(pendingEntryChanges.status, opts.status));

  const requesterUsers = db.$with("requester_users").as(
    db.select({ id: users.id, name: users.name }).from(users),
  );

  const rows = await db
    .with(requesterUsers)
    .select({
      pec: pendingEntryChanges,
      requestedByName: requesterUsers.name,
    })
    .from(pendingEntryChanges)
    .leftJoin(requesterUsers, eq(requesterUsers.id, pendingEntryChanges.requestedBy))
    .where(and(...conds))
    .orderBy(desc(pendingEntryChanges.requestedAt))
    .limit(limit);

  return ok(
    rows.map((r) => ({
      ...r.pec,
      requestedByName: r.requestedByName,
      approvedByName: null,
      rejectedByName: null,
    })),
  );
}
