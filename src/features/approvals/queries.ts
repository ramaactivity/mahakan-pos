"use server";

import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalCodes,
  outlets as outletsSchema,
  shiftRebalances,
  shifts as shiftsSchema,
  transactionCorrections,
  transactions,
  users,
} from "@/db/schema";
import { pendingEntryChanges } from "@/db/schema/pending_entry_changes";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { listShiftRebalances } from "@/features/shifts/rebalance-actions";
import { listTransactionCorrections } from "@/features/transactions/correction-actions";
import { listPendingEntryChanges } from "@/features/cash/entry-change-actions";
import { isOk as isShiftOk } from "@/features/shifts/types";
import {
  fail,
  ok,
  isOk,
  type ApiResult,
} from "@/features/approval-codes/types";
import type { UnifiedApprovalItem } from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

interface VoidRefundPendingRow {
  approvalCodeId: string;
  actionType: "pos.transaction.void" | "pos.transaction.refund";
  transactionId: string;
  transactionNumber: string;
  total: number;
  reason: string;
  codeFirstTwo: string;
  requestedByUserId: string;
  requesterName: string | null;
  requestedAt: Date;
  outletId: string;
}

/**
 * List pending void/refund codes (active, unconsumed, unrevoked, unexpired).
 * Void/refund tidak punya tabel queue khusus — kode di-approval_codes saja —
 * jadi kita pull dari sana + join trx untuk display info.
 */
async function listPendingVoidRefundFromCodes(): Promise<
  ApiResult<VoidRefundPendingRow[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_queue.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat queue approval");
  }
  const now = new Date();
  const rows = await db
    .select({
      codeId: approvalCodes.id,
      actionType: approvalCodes.actionType,
      transactionId: approvalCodes.targetTransactionId,
      reason: approvalCodes.reason,
      codeFirstTwo: approvalCodes.codeFirstTwo,
      requestedByUserId: approvalCodes.requestedByUserId,
      requestedAt: approvalCodes.createdAt,
      outletId: approvalCodes.outletId,
      requesterName: users.name,
      transactionNumber: transactions.transactionNumber,
      total: transactions.total,
      trxStatus: transactions.status,
    })
    .from(approvalCodes)
    .leftJoin(users, eq(users.id, approvalCodes.requestedByUserId))
    .leftJoin(
      transactions,
      eq(transactions.id, approvalCodes.targetTransactionId),
    )
    .where(
      and(
        eq(approvalCodes.outletId, session.user.outletId),
        inArray(approvalCodes.actionType, [
          "pos.transaction.void",
          "pos.transaction.refund",
        ]),
        isNull(approvalCodes.consumedAt),
        isNull(approvalCodes.revokedAt),
        gt(approvalCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(approvalCodes.createdAt))
    .limit(100);

  const filtered = rows.filter(
    (r) =>
      r.transactionId !== null &&
      r.transactionNumber !== null &&
      r.total !== null &&
      r.trxStatus === "paid",
  );
  return ok(
    filtered.map((r) => ({
      approvalCodeId: r.codeId,
      actionType: r.actionType as
        | "pos.transaction.void"
        | "pos.transaction.refund",
      transactionId: r.transactionId!,
      transactionNumber: r.transactionNumber!,
      total: r.total!,
      reason: r.reason,
      codeFirstTwo: r.codeFirstTwo,
      requestedByUserId: r.requestedByUserId,
      requesterName: r.requesterName,
      requestedAt: r.requestedAt,
      outletId: r.outletId,
    })),
  );
}

/**
 * Public: load full unified approval queue (pending only by default, atau
 * dengan filter status). Output di-flatten ke UnifiedApprovalItem shape.
 *
 * Note: ini fetch 4 source paralel — ada cost. UI cache via React Query.
 */
export async function listUnifiedApprovals(opts: {
  status?: "pending" | "approved" | "rejected" | "cancelled" | "all";
  limit?: number;
} = {}): Promise<ApiResult<UnifiedApprovalItem[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_queue.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat queue approval");
  }
  const status = opts.status ?? "pending";
  const limit = opts.limit ?? 50;

  // Convert "pending" → per-source "pending_approval" string.
  const sourceStatus =
    status === "pending"
      ? "pending_approval"
      : status === "all"
        ? "all"
        : status;

  const [rebalanceRes, correctionRes, entryRes, voidRefundRes] =
    await Promise.all([
      listShiftRebalances({ status: sourceStatus as never, limit }),
      listTransactionCorrections({ status: sourceStatus as never, limit }),
      listPendingEntryChanges({
        status: status === "all" ? undefined : (sourceStatus as never),
        limit,
      }),
      // Void/refund pending only — non-pending history will surface from
      // RefundVoidComplimentReport. Untuk MVP cuma show "active code" pending.
      status === "pending" || status === "all"
        ? listPendingVoidRefundFromCodes()
        : Promise.resolve(ok([])),
    ]);

  const items: UnifiedApprovalItem[] = [];

  if (isShiftOk(rebalanceRes)) {
    for (const r of rebalanceRes.data) {
      const variancePart =
        r.originalActualCash !== r.correctedActualCash
          ? `Rp ${r.originalActualCash.toLocaleString("id-ID")} → Rp ${r.correctedActualCash.toLocaleString("id-ID")}`
          : "Multi-channel adjust";
      items.push({
        key: `rebalance:${r.id}`,
        kind: "rebalance",
        sourceId: r.id,
        status: mapShiftStatusToUnified(r.status),
        title: "Rebalance Shift",
        subtitle: `${r.cashierName ?? "Kasir"} · ${variancePart}`,
        amount: r.correctedActualCash - r.originalActualCash,
        reason: r.reason,
        requesterName: r.requesterName,
        requesterId: r.requestedBy,
        requestedAt: new Date(r.requestedAt),
        outletId: r.outletId,
        codeFirstTwo: null,
        resolvedAt:
          r.approvedAt ?? r.rejectedAt ?? r.cancelledAt
            ? new Date(
                (r.approvedAt ?? r.rejectedAt ?? r.cancelledAt) as Date,
              )
            : null,
        resolverName: r.approverName,
        rejectedReason: r.rejectedReason,
        journalStatus: r.correctedJournalEntryId
          ? "posted"
          : r.status === "approved"
            ? "pending"
            : "n/a",
        shiftCorrectionStatus:
          r.status === "approved" ? "applied" : "pending",
        canDirectApprove: r.status === "pending_approval",
      });
    }
  }

  if (isOk(correctionRes)) {
    for (const c of correctionRes.data) {
      const trxLabel = c.transactionNumber ?? c.transactionId.slice(0, 8);
      items.push({
        key: `correction:${c.id}`,
        kind: "correction",
        sourceId: c.id,
        status: mapStatusToUnified(c.status),
        title: "Koreksi Transaksi",
        subtitle: `${trxLabel} · ${c.originalPaymentMethod}→${c.correctedPaymentMethod}, Rp ${c.originalTotal.toLocaleString("id-ID")}→Rp ${c.correctedTotal.toLocaleString("id-ID")}`,
        amount: c.correctedTotal - c.originalTotal,
        reason: c.reason,
        requesterName: c.requesterName,
        requesterId: c.requestedBy,
        requestedAt: new Date(c.requestedAt),
        outletId: c.outletId,
        codeFirstTwo: null,
        resolvedAt: c.approvedAt
          ? new Date(c.approvedAt)
          : c.rejectedAt
            ? new Date(c.rejectedAt)
            : c.cancelledAt
              ? new Date(c.cancelledAt)
              : null,
        resolverName: c.approverName,
        rejectedReason: c.rejectedReason,
        journalStatus: c.correctedJournalEntryId
          ? "posted"
          : c.status === "approved"
            ? "pending"
            : "n/a",
        shiftCorrectionStatus:
          c.status === "approved" ? "applied" : "pending",
        canDirectApprove: c.status === "pending_approval",
      });
    }
  }

  if (isOk(entryRes)) {
    for (const e of entryRes.data) {
      const proposed = (e.proposedData ?? {}) as Record<string, unknown>;
      const opLabel = e.operation === "delete" ? "Hapus" : "Edit";
      const entityLabel = e.entityType === "expense" ? "Pengeluaran" : "Pemasukan";
      const amount = typeof proposed.amount === "number" ? proposed.amount : null;
      items.push({
        key: `entry_change:${e.id}`,
        kind: "entry_change",
        sourceId: e.id,
        status: mapEntryStatusToUnified(e.status),
        title: `${opLabel} ${entityLabel}`,
        subtitle:
          amount !== null
            ? `Rp ${amount.toLocaleString("id-ID")} · ${(proposed.description as string) ?? "—"}`
            : ((proposed.description as string) ?? e.reason),
        amount,
        reason: e.reason,
        requesterName: e.requestedByName,
        requesterId: e.requestedBy,
        requestedAt: new Date(e.requestedAt),
        outletId: e.outletId,
        codeFirstTwo: null,
        resolvedAt: e.approvedAt
          ? new Date(e.approvedAt)
          : e.rejectedAt
            ? new Date(e.rejectedAt)
            : e.cancelledAt
              ? new Date(e.cancelledAt)
              : null,
        resolverName: null,
        rejectedReason: e.rejectedReason,
        journalStatus: "n/a",
        shiftCorrectionStatus:
          e.status === "approved" ? "applied" : "pending",
        canDirectApprove: e.status === "pending_approval",
      });
    }
  }

  if (isOk(voidRefundRes)) {
    for (const v of voidRefundRes.data) {
      const isVoid = v.actionType === "pos.transaction.void";
      items.push({
        key: `${isVoid ? "void" : "refund"}:${v.approvalCodeId}`,
        kind: isVoid ? "void" : "refund",
        sourceId: v.approvalCodeId,
        status: "pending",
        title: isVoid ? "Void Transaksi" : "Refund Transaksi",
        subtitle: `${v.transactionNumber} · Rp ${v.total.toLocaleString("id-ID")}`,
        amount: -v.total, // negative = pengurangan revenue
        reason: v.reason,
        requesterName: v.requesterName,
        requesterId: v.requestedByUserId,
        requestedAt: new Date(v.requestedAt),
        outletId: v.outletId,
        codeFirstTwo: v.codeFirstTwo,
        resolvedAt: null,
        resolverName: null,
        rejectedReason: null,
        journalStatus: "n/a",
        shiftCorrectionStatus: "pending",
        canDirectApprove: true,
      });
    }
  }

  // Sort: pending pertama (sorted oldest first → urgent on top), lalu yang
  // lain (resolved) sort newest first.
  items.sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    // Same bucket: pending oldest first (urgent), resolved newest first.
    if (a.status === "pending") {
      return a.requestedAt.getTime() - b.requestedAt.getTime();
    }
    return b.requestedAt.getTime() - a.requestedAt.getTime();
  });

  return ok(items);
}

/**
 * Ringkasan jumlah pending per kind — untuk badge sidebar + summary chips.
 * Lebih murah dari listUnifiedApprovals (cuma count, no joins).
 */
export async function getApprovalQueueSummary(): Promise<
  ApiResult<{
    total: number;
    byKind: Record<"rebalance" | "correction" | "entry_change" | "void" | "refund", number>;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "approval_queue.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat queue approval");
  }
  const outletId = session.user.outletId;
  const now = new Date();

  const [rebalanceRows, correctionRows, entryRows, codeRows] =
    await Promise.all([
      db
        .select({ id: shiftRebalances.id })
        .from(shiftRebalances)
        .where(
          and(
            eq(shiftRebalances.outletId, outletId),
            eq(shiftRebalances.status, "pending_approval"),
          ),
        ),
      db
        .select({ id: transactionCorrections.id })
        .from(transactionCorrections)
        .where(
          and(
            eq(transactionCorrections.outletId, outletId),
            eq(transactionCorrections.status, "pending_approval"),
          ),
        ),
      db
        .select({ id: pendingEntryChanges.id })
        .from(pendingEntryChanges)
        .where(
          and(
            eq(pendingEntryChanges.outletId, outletId),
            eq(pendingEntryChanges.status, "pending_approval"),
            gt(pendingEntryChanges.expiresAt, now),
          ),
        ),
      db
        .select({
          id: approvalCodes.id,
          actionType: approvalCodes.actionType,
        })
        .from(approvalCodes)
        .where(
          and(
            eq(approvalCodes.outletId, outletId),
            inArray(approvalCodes.actionType, [
              "pos.transaction.void",
              "pos.transaction.refund",
            ]),
            isNull(approvalCodes.consumedAt),
            isNull(approvalCodes.revokedAt),
            gt(approvalCodes.expiresAt, now),
          ),
        ),
    ]);

  const voidCount = codeRows.filter(
    (r) => r.actionType === "pos.transaction.void",
  ).length;
  const refundCount = codeRows.filter(
    (r) => r.actionType === "pos.transaction.refund",
  ).length;

  const byKind = {
    rebalance: rebalanceRows.length,
    correction: correctionRows.length,
    entry_change: entryRows.length,
    void: voidCount,
    refund: refundCount,
  } as const;
  const total =
    byKind.rebalance +
    byKind.correction +
    byKind.entry_change +
    byKind.void +
    byKind.refund;
  return ok({ total, byKind });
}

/** Map shift_rebalances.status ke unified status. */
function mapShiftStatusToUnified(
  s: "pending_approval" | "approved" | "rejected" | "cancelled",
): "pending" | "approved" | "rejected" | "cancelled" {
  if (s === "pending_approval") return "pending";
  return s;
}

function mapStatusToUnified(
  s: "pending_approval" | "approved" | "rejected" | "cancelled",
): "pending" | "approved" | "rejected" | "cancelled" {
  if (s === "pending_approval") return "pending";
  return s;
}

function mapEntryStatusToUnified(
  s: "pending_approval" | "approved" | "rejected" | "cancelled" | "expired",
): "pending" | "approved" | "rejected" | "cancelled" | "expired" {
  if (s === "pending_approval") return "pending";
  return s;
}

// Silence unused-import lint kalau ada (outlets/shifts terimport for type only di future).
void outletsSchema;
void shiftsSchema;
