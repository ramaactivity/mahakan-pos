"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { approvalCodes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import {
  refundTransaction,
  voidTransaction,
} from "@/features/transactions/actions";
import {
  approveShiftRebalanceDirect,
  cancelShiftRebalance,
  rejectShiftRebalance,
} from "@/features/shifts/rebalance-actions";
import {
  approveTransactionCorrectionDirect,
  cancelTransactionCorrection,
  rejectTransactionCorrection,
} from "@/features/transactions/correction-actions";
import {
  approveEntryChangeDirect,
  cancelEntryChange,
  rejectEntryChange,
} from "@/features/cash/entry-change-actions";
import {
  fail,
  ok,
  isOk,
  type ApiResult,
} from "@/features/approval-codes/types";
import type { ApprovalKind } from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/**
 * Direct-approve dispatcher dari Pusat Persetujuan.
 *
 * Routing per-kind:
 *   - rebalance    → approveShiftRebalanceDirect (owner-only)
 *   - correction   → approveTransactionCorrectionDirect (owner-only)
 *   - entry_change → approveEntryChangeDirect (owner-only)
 *   - void         → voidTransaction({directOwnerApprove:true}) — refresh trx
 *   - refund       → refundTransaction({directOwnerApprove:true})
 *
 * Untuk void/refund, sourceId = approvalCodes.id. Kita resolve target trx id
 * + reason dari row tersebut, lalu trigger void/refund. Code di-revoke inside
 * consumeVoidRefundCredential ("direct_owner" mode).
 */
export async function directApprove(input: {
  kind: ApprovalKind;
  sourceId: string;
}): Promise<ApiResult<{ kind: ApprovalKind; sourceId: string }>> {
  const session = await requireSession();
  if (session.user.role !== "owner") {
    return fail(
      "FORBIDDEN",
      "Direct approve hanya untuk Owner. Manager pakai jalur kode.",
    );
  }

  if (input.kind === "rebalance") {
    const res = await approveShiftRebalanceDirect({
      rebalanceId: input.sourceId,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "rebalance", sourceId: input.sourceId });
  }

  if (input.kind === "correction") {
    const res = await approveTransactionCorrectionDirect({
      correctionId: input.sourceId,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "correction", sourceId: input.sourceId });
  }

  if (input.kind === "entry_change") {
    const res = await approveEntryChangeDirect({ changeId: input.sourceId });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "entry_change", sourceId: input.sourceId });
  }

  if (input.kind === "void" || input.kind === "refund") {
    // sourceId = approvalCodes.id — resolve target trx + reason.
    const [codeRow] = await db
      .select({
        id: approvalCodes.id,
        actionType: approvalCodes.actionType,
        targetTransactionId: approvalCodes.targetTransactionId,
        reason: approvalCodes.reason,
        consumedAt: approvalCodes.consumedAt,
        revokedAt: approvalCodes.revokedAt,
        outletId: approvalCodes.outletId,
      })
      .from(approvalCodes)
      .where(eq(approvalCodes.id, input.sourceId))
      .limit(1);
    if (!codeRow) return fail("NOT_FOUND", "Approval row tidak ditemukan");
    if (codeRow.outletId !== session.user.outletId) {
      return fail("FORBIDDEN", "Outlet lain");
    }
    if (codeRow.consumedAt || codeRow.revokedAt) {
      return fail(
        "INVALID_STATE",
        "Approval sudah di-process — refresh halaman untuk lihat status terbaru.",
      );
    }
    if (!codeRow.targetTransactionId) {
      return fail("INVALID_STATE", "Approval tidak terhubung ke transaksi");
    }
    const expectedActionType =
      input.kind === "void"
        ? "pos.transaction.void"
        : "pos.transaction.refund";
    if (codeRow.actionType !== expectedActionType) {
      return fail("MISMATCH", "Tipe approval tidak cocok dengan request");
    }

    if (input.kind === "void") {
      const res = await voidTransaction({
        transactionId: codeRow.targetTransactionId,
        reason: codeRow.reason,
        directOwnerApprove: true,
      });
      if (!isOk(res)) return fail(res.error.code, res.error.message);
    } else {
      const res = await refundTransaction({
        transactionId: codeRow.targetTransactionId,
        reason: codeRow.reason,
        directOwnerApprove: true,
      });
      if (!isOk(res)) return fail(res.error.code, res.error.message);
    }
    return ok({ kind: input.kind, sourceId: input.sourceId });
  }

  return fail("UNKNOWN_KIND", `Kind tidak dikenal: ${input.kind}`);
}

/**
 * Input kode 6-digit untuk void/refund di Pusat Persetujuan (manager/supervisor
 * path). Use case: staff request void/refund dari POS → owner kirim kode via
 * WA → manager input kode di back office (kalau staff tidak balik ke POS atau
 * kalau manager yang menyetujui ulang dari sini).
 *
 * sourceId = approvalCodes.id. Resolve target trx + reason → call
 * voidTransaction/refundTransaction dengan `approvalCode` (existing code-mode
 * path; consume code terjadi inline di tx).
 */
export async function approveVoidRefundWithCode(input: {
  approvalCodeId: string;
  code: string;
}): Promise<
  ApiResult<{
    kind: "void" | "refund";
    sourceId: string;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_queue.view")) {
    return fail("FORBIDDEN", "Tidak punya hak proses approval queue");
  }
  const codeTrim = input.code.trim();
  if (!/^\d{6}$/.test(codeTrim)) {
    return fail("INVALID_FORMAT", "Kode harus 6 digit angka");
  }

  const [codeRow] = await db
    .select({
      id: approvalCodes.id,
      actionType: approvalCodes.actionType,
      targetTransactionId: approvalCodes.targetTransactionId,
      reason: approvalCodes.reason,
      consumedAt: approvalCodes.consumedAt,
      revokedAt: approvalCodes.revokedAt,
      outletId: approvalCodes.outletId,
    })
    .from(approvalCodes)
    .where(eq(approvalCodes.id, input.approvalCodeId))
    .limit(1);
  if (!codeRow) return fail("NOT_FOUND", "Approval tidak ditemukan");
  if (codeRow.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Outlet lain");
  }
  if (codeRow.consumedAt || codeRow.revokedAt) {
    return fail("INVALID_STATE", "Approval sudah di-process");
  }
  if (!codeRow.targetTransactionId) {
    return fail("INVALID_STATE", "Approval tidak terhubung ke transaksi");
  }

  if (codeRow.actionType === "pos.transaction.void") {
    const res = await voidTransaction({
      transactionId: codeRow.targetTransactionId,
      reason: codeRow.reason,
      approvalCode: codeTrim,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "void", sourceId: input.approvalCodeId });
  }
  if (codeRow.actionType === "pos.transaction.refund") {
    const res = await refundTransaction({
      transactionId: codeRow.targetTransactionId,
      reason: codeRow.reason,
      approvalCode: codeTrim,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "refund", sourceId: input.approvalCodeId });
  }
  return fail(
    "MISMATCH",
    "Approval ini bukan void/refund — pakai flow yang sesuai",
  );
}

/**
 * Reject dispatcher. Untuk void/refund (yang tidak punya tabel queue), reject
 * = revoke approval_code. Untuk yang lain, panggil reject existing per-flow.
 */
export async function rejectApproval(input: {
  kind: ApprovalKind;
  sourceId: string;
  reason: string;
}): Promise<ApiResult<{ kind: ApprovalKind; sourceId: string }>> {
  const session = await requireSession();
  const reasonTrim = input.reason.trim();
  if (reasonTrim.length < 3) {
    return fail("VALIDATION_ERROR", "Alasan reject minimal 3 karakter");
  }

  if (input.kind === "rebalance") {
    const res = await rejectShiftRebalance({
      rebalanceId: input.sourceId,
      reason: reasonTrim,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "rebalance", sourceId: input.sourceId });
  }

  if (input.kind === "correction") {
    const res = await rejectTransactionCorrection({
      correctionId: input.sourceId,
      reason: reasonTrim,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "correction", sourceId: input.sourceId });
  }

  if (input.kind === "entry_change") {
    const res = await rejectEntryChange({
      changeId: input.sourceId,
      reason: reasonTrim,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "entry_change", sourceId: input.sourceId });
  }

  if (input.kind === "void" || input.kind === "refund") {
    // Void/refund tidak punya tabel state — reject = revoke code.
    // Owner/manager bisa reject (sama seperti reject di flow lain).
    if (session.user.role !== "owner" && session.user.role !== "manager") {
      return fail(
        "FORBIDDEN",
        "Hanya owner/manager yang bisa reject void/refund",
      );
    }
    const [codeRow] = await db
      .select({
        id: approvalCodes.id,
        consumedAt: approvalCodes.consumedAt,
        revokedAt: approvalCodes.revokedAt,
        outletId: approvalCodes.outletId,
        requestedByUserId: approvalCodes.requestedByUserId,
      })
      .from(approvalCodes)
      .where(eq(approvalCodes.id, input.sourceId))
      .limit(1);
    if (!codeRow) return fail("NOT_FOUND", "Approval tidak ditemukan");
    if (codeRow.outletId !== session.user.outletId) {
      return fail("FORBIDDEN", "Outlet lain");
    }
    if (codeRow.consumedAt || codeRow.revokedAt) {
      return fail("INVALID_STATE", "Approval sudah di-process");
    }
    // Submitter tidak boleh reject pengajuan sendiri (semantic = cancel).
    if (
      codeRow.requestedByUserId === session.user.id &&
      session.user.role !== "owner"
    ) {
      return fail(
        "FORBIDDEN_SELF_REJECT",
        "Tidak bisa reject pengajuan sendiri — pakai Cancel.",
      );
    }
    await db
      .update(approvalCodes)
      .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
      .where(eq(approvalCodes.id, input.sourceId));
    return ok({ kind: input.kind, sourceId: input.sourceId });
  }

  return fail("UNKNOWN_KIND", `Kind tidak dikenal: ${input.kind}`);
}

/**
 * Cancel dispatcher (requester sendiri). Untuk void/refund cancel-nya juga
 * revoke approval_code, tapi requester-only (bukan owner override).
 */
export async function cancelApproval(input: {
  kind: ApprovalKind;
  sourceId: string;
}): Promise<ApiResult<{ kind: ApprovalKind; sourceId: string }>> {
  const session = await requireSession();

  if (input.kind === "rebalance") {
    const res = await cancelShiftRebalance({ rebalanceId: input.sourceId });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "rebalance", sourceId: input.sourceId });
  }

  if (input.kind === "correction") {
    const res = await cancelTransactionCorrection({
      correctionId: input.sourceId,
    });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "correction", sourceId: input.sourceId });
  }

  if (input.kind === "entry_change") {
    const res = await cancelEntryChange({ changeId: input.sourceId });
    if (!isOk(res)) return fail(res.error.code, res.error.message);
    return ok({ kind: "entry_change", sourceId: input.sourceId });
  }

  if (input.kind === "void" || input.kind === "refund") {
    const [codeRow] = await db
      .select({
        id: approvalCodes.id,
        consumedAt: approvalCodes.consumedAt,
        revokedAt: approvalCodes.revokedAt,
        outletId: approvalCodes.outletId,
        requestedByUserId: approvalCodes.requestedByUserId,
      })
      .from(approvalCodes)
      .where(eq(approvalCodes.id, input.sourceId))
      .limit(1);
    if (!codeRow) return fail("NOT_FOUND", "Approval tidak ditemukan");
    if (codeRow.outletId !== session.user.outletId) {
      return fail("FORBIDDEN", "Outlet lain");
    }
    if (codeRow.consumedAt || codeRow.revokedAt) {
      return fail("INVALID_STATE", "Sudah di-process");
    }
    if (
      codeRow.requestedByUserId !== session.user.id &&
      session.user.role !== "owner"
    ) {
      return fail("FORBIDDEN", "Hanya requester yang bisa cancel");
    }
    await db
      .update(approvalCodes)
      .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
      .where(
        and(
          eq(approvalCodes.id, input.sourceId),
          isNull(approvalCodes.consumedAt),
          isNull(approvalCodes.revokedAt),
        ),
      );
    return ok({ kind: input.kind, sourceId: input.sourceId });
  }

  return fail("UNKNOWN_KIND", `Kind tidak dikenal: ${input.kind}`);
}
