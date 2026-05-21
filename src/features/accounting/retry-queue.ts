"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { journalRetryQueue, journalEntries, users } from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { extractDbError } from "@/lib/db-error";
import { logAndSanitize } from "@/lib/server-error";
import {
  postJournalForExpenseCreate,
  postJournalForIncomeCreate,
  postJournalForOpnameAdjustment,
  postJournalForPosRefund,
  postJournalForPosSale,
  postJournalForPosVoid,
} from "./hooks";
import type { ApiResult } from "./types";
import { ok, fail } from "./types";
import {
  RETRY_QUEUE_HOOK_LABELS,
  isRetryableHookLabel,
  type EnqueueJournalFailureInput,
  type JournalRetryQueueListRow,
  type ListJournalQueueOptions,
  type RetryQueueHookLabel,
} from "./retry-queue-types";

/**
 * Sesi AE-62w — store-and-forward retry queue untuk failed journal posting
 * hooks. Caller (fireJournalHook) snapshot args + label saat hook throw
 * post-commit. Owner trigger retry via Admin → Antrian Jurnal Gagal.
 *
 * Dispatcher pattern:
 *   - HOOK_REGISTRY: map label → { zod schema, executor }
 *   - enqueueFailedJournal(spec, error): insert row + audit log
 *   - retryJournalQueueRow(id, actor): validate args, dispatch, mark resolved
 *   - abandonJournalQueueRow(id, reason, actor): owner manual fix elsewhere
 *
 * Idempotency safety: recordJournal sudah punya UNIQUE
 * ux_je_outlet_source_active (sesi AE-62t) → duplicate retry tidak posting
 * 2x. Worst case row resolved 2x oleh 2 owner taps → both succeed (idempotent),
 * last writer wins on resolved fields.
 *
 * Hooks belum di-wire ke retry queue (defer): payroll_paid,
 * cash_deposit_verified, cash_deposit_unverified, aggregator_settlement,
 * shift_variance, shift_rebalance, purchase_create/pay/cancel,
 * pos_compliment, pos_sale_correction/reversal, transaction.correction.
 * Yang complex args / banyak field → fallback ke manual entry via owner di
 * Akuntansi → Jurnal Manual. Bisa di-add bertahap kalau ada kasus real-world.
 */

// ============================================================
// Hook registry — zod schemas + executors
// ============================================================

const posSaleArgsSchema = z.object({
  outletId: z.uuid(),
  transactionId: z.uuid(),
  actorId: z.uuid(),
});

const aggregatedItemSchema = z.object({
  itemCategoryName: z.string(),
  amount: z.number().int().min(0),
  cogs: z.number().int().min(0),
});

const posVoidArgsSchema = z.object({
  outletId: z.uuid(),
  transactionId: z.uuid(),
  items: z.array(aggregatedItemSchema).optional(),
  actorId: z.uuid(),
  entryDate: z.string().optional(),
});

const posRefundArgsSchema = z.object({
  outletId: z.uuid(),
  transactionId: z.uuid(),
  refundEventId: z.uuid(),
  refundedAmount: z.number().int().min(0),
  items: z.array(aggregatedItemSchema).optional(),
  reverseCogs: z.boolean().optional(),
  actorId: z.uuid(),
  entryDate: z.string().optional(),
});

const expenseCreateArgsSchema = z.object({
  outletId: z.uuid(),
  expenseId: z.uuid(),
  actorId: z.uuid(),
});

const incomeCreateArgsSchema = z.object({
  outletId: z.uuid(),
  incomeId: z.uuid(),
  amount: z.number().int().min(0),
  description: z.string(),
  paymentMethod: z.enum(["cash", "transfer_bca"]),
  entryDate: z.string(),
  actorId: z.uuid(),
});

const opnameAdjustmentArgsSchema = z.object({
  outletId: z.uuid(),
  opnameSessionId: z.uuid(),
  sessionLabel: z.string(),
  sectionDiffs: z.array(z.unknown()),
  entryDate: z.string(),
  actorId: z.uuid(),
});

interface HookRegistryEntry<TArgs> {
  schema: z.ZodType<TArgs>;
  execute: (args: TArgs) => Promise<void>;
  /** Human label untuk UI display. */
  displayName: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HOOK_REGISTRY: Record<RetryQueueHookLabel, HookRegistryEntry<any>> = {
  pos_sale: {
    schema: posSaleArgsSchema,
    execute: postJournalForPosSale,
    displayName: "Penjualan POS",
  },
  pos_void: {
    schema: posVoidArgsSchema,
    execute: postJournalForPosVoid,
    displayName: "Void POS",
  },
  pos_refund: {
    schema: posRefundArgsSchema,
    execute: postJournalForPosRefund,
    displayName: "Refund POS",
  },
  expense_create: {
    schema: expenseCreateArgsSchema,
    execute: postJournalForExpenseCreate,
    displayName: "Pengeluaran",
  },
  income_create: {
    schema: incomeCreateArgsSchema,
    execute: postJournalForIncomeCreate,
    displayName: "Pemasukan",
  },
  opname_adjustment: {
    schema: opnameAdjustmentArgsSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: postJournalForOpnameAdjustment as (args: any) => Promise<void>,
    displayName: "Penyesuaian Opname",
  },
};

// ============================================================
// Public: enqueue (called from fireJournalHook error path)
// ============================================================

/**
 * Insert row ke journal_retry_queue. Best-effort — kalau insert itself
 * gagal, log ke console + audit (existing behavior dari fireJournalHook
 * already does that). Tidak throw.
 *
 * Caller di fireJournalHook — non-action context, so tidak via auth().
 * actorId di-pull dari hookArgs.actorId kalau ada (best-effort untuk audit).
 */
export async function enqueueFailedJournal(
  input: EnqueueJournalFailureInput,
): Promise<{ queueId: string | null }> {
  /* Sesi AE-76 — extract PG reason + SQLSTATE dari cause chain. Sebelum
   * AE-76 kita store e.message saja yang cuma "Failed query: <SQL>" tanpa
   * reason — owner gak bisa diagnose tanpa SSH ke Vercel logs. */
  const dbErr = extractDbError(input.error);
  const fallbackMsg =
    input.error instanceof Error ? input.error.message : String(input.error);
  const stack = input.error instanceof Error ? input.error.stack : undefined;
  const actorIdMaybe = (input.hookArgs as { actorId?: unknown }).actorId;
  const actorId = typeof actorIdMaybe === "string" ? actorIdMaybe : null;
  try {
    const [row] = await db
      .insert(journalRetryQueue)
      .values({
        outletId: input.outletId,
        hookLabel: input.hookLabel,
        hookArgs: input.hookArgs,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        lastError: dbErr.formatted.slice(0, 500),
        lastErrorStack: stack?.split("\n").slice(0, 8).join("\n") ?? null,
      })
      .returning({ id: journalRetryQueue.id });
    if (!row) return { queueId: null };
    // Audit (best-effort)
    void logAudit({
      eventType: "journal.retry.enqueued",
      userId: actorId,
      entityType: "journal_retry_queue",
      entityId: row.id,
      payload: {
        summary: `🔁 Journal queued for retry: ${input.hookLabel} — ${dbErr.formatted.slice(0, 200)}`,
        context: {
          hookLabel: input.hookLabel,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          reason: dbErr.reason,
          sqlstate: dbErr.sqlstate,
          constraint: dbErr.constraint,
          detail: dbErr.detail,
          rawError: fallbackMsg,
        },
      },
      metadata: { outletId: input.outletId, actorRole: "system" },
    }).catch((e) => console.error("[audit journal.retry.enqueued]", e));
    return { queueId: row.id };
  } catch (e) {
    console.error("[journal-retry-queue.enqueue]", e);
    return { queueId: null };
  }
}

// ============================================================
// Public: retry (owner-triggered)
// ============================================================

async function requireSession() {
  const s = await auth();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

export async function retryJournalQueueRow(input: {
  id: string;
}): Promise<
  ApiResult<{
    queueId: string;
    journalEntryId: string | null;
    retryCount: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "journal_retry.retry")) {
    return fail("FORBIDDEN", "Tidak punya hak retry jurnal");
  }

  const [row] = await db
    .select()
    .from(journalRetryQueue)
    .where(eq(journalRetryQueue.id, input.id))
    .limit(1);
  if (!row) return fail("NOT_FOUND", "Antrian tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Antrian dari outlet lain");
  }
  if (row.resolvedAt) {
    return fail(
      "ALREADY_RESOLVED",
      "Antrian sudah resolved — refresh untuk lihat status terbaru.",
    );
  }
  if (row.abandonedAt) {
    return fail(
      "ALREADY_ABANDONED",
      "Antrian sudah di-abandon — tidak bisa retry.",
    );
  }

  if (!isRetryableHookLabel(row.hookLabel)) {
    return fail(
      "UNSUPPORTED_HOOK",
      `Hook "${row.hookLabel}" belum di-support oleh dispatcher retry. Manual fix via Akuntansi → Jurnal Manual.`,
    );
  }

  const registry = HOOK_REGISTRY[row.hookLabel];
  const parsed = registry.schema.safeParse(row.hookArgs);
  if (!parsed.success) {
    return fail(
      "ARGS_SCHEMA_INVALID",
      `Args snapshot tidak valid untuk hook "${row.hookLabel}": ${parsed.error.issues[0]?.message ?? "unknown"}. Mungkin schema hook berubah sejak enqueue.`,
    );
  }

  const now = new Date();
  try {
    await registry.execute(parsed.data);
    /* Lookup the journal entry yang ter-post (idempotent — kalau hook ini
     * sudah post sebelumnya via path lain, recordJournal returns existing).
     * Best-effort untuk link audit. */
    let resolvedEntryId: string | null = null;
    if (row.sourceType && row.sourceId) {
      const [entry] = await db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.outletId, row.outletId),
            sql`${journalEntries.sourceType} = ${row.sourceType}`,
            eq(journalEntries.sourceId, row.sourceId),
            sql`${journalEntries.status} <> 'reversed'`,
          ),
        )
        .limit(1);
      resolvedEntryId = entry?.id ?? null;
    }
    const newRetryCount = row.retryCount + 1;
    await db
      .update(journalRetryQueue)
      .set({
        resolvedAt: now,
        resolvedByUserId: session.user.id,
        resolvedJournalEntryId: resolvedEntryId,
        retryCount: newRetryCount,
        lastRetryAt: now,
        lastRetryByUserId: session.user.id,
      })
      .where(eq(journalRetryQueue.id, row.id));

    await logAudit({
      eventType: "journal.retry.succeeded",
      userId: session.user.id,
      entityType: "journal_retry_queue",
      entityId: row.id,
      payload: {
        summary: `✓ Retry journal ${row.hookLabel} sukses (attempt ${newRetryCount})`,
        context: {
          hookLabel: row.hookLabel,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          journalEntryId: resolvedEntryId,
          retryCount: newRetryCount,
        },
      },
      metadata: { outletId: row.outletId, actorRole: session.user.role },
    });

    return ok({
      queueId: row.id,
      journalEntryId: resolvedEntryId,
      retryCount: newRetryCount,
    });
  } catch (e) {
    /* Sesi AE-76 — extract PG reason supaya audit log + lastError berisi
     * info actionable (SQLSTATE + constraint + detail), bukan cuma SQL. */
    const dbErr = extractDbError(e);
    const fallbackMsg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    const newRetryCount = row.retryCount + 1;
    await db
      .update(journalRetryQueue)
      .set({
        retryCount: newRetryCount,
        lastRetryAt: now,
        lastRetryByUserId: session.user.id,
        lastError: dbErr.formatted.slice(0, 500),
        lastErrorStack: stack?.split("\n").slice(0, 8).join("\n") ?? null,
      })
      .where(eq(journalRetryQueue.id, row.id))
      .catch((updateErr) => {
        console.error("[journal-retry-queue.retry update]", updateErr);
      });

    await logAudit({
      eventType: "journal.retry.failed",
      userId: session.user.id,
      entityType: "journal_retry_queue",
      entityId: row.id,
      payload: {
        summary: `✗ Retry journal ${row.hookLabel} gagal (attempt ${newRetryCount}): ${dbErr.formatted.slice(0, 200)}`,
        context: {
          hookLabel: row.hookLabel,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          retryCount: newRetryCount,
          reason: dbErr.reason,
          sqlstate: dbErr.sqlstate,
          constraint: dbErr.constraint,
          detail: dbErr.detail,
          rawError: fallbackMsg,
        },
      },
      metadata: { outletId: row.outletId, actorRole: session.user.role },
    }).catch((auditErr) =>
      console.error("[audit journal.retry.failed]", auditErr),
    );

    return fail(
      "RETRY_FAILED",
      logAndSanitize(e, "journal-retry-queue.retry", "Retry gagal — cek detail error di audit log"),
    );
  }
}

// ============================================================
// Public: abandon (owner mark manual-fixed elsewhere)
// ============================================================

export async function abandonJournalQueueRow(input: {
  id: string;
  reason: string;
}): Promise<ApiResult<{ queueId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "journal_retry.abandon")) {
    return fail("FORBIDDEN", "Tidak punya hak abandon antrian");
  }
  const reason = input.reason.trim();
  if (reason.length < 3) {
    return fail("VALIDATION_ERROR", "Alasan minimal 3 karakter");
  }

  const [row] = await db
    .select()
    .from(journalRetryQueue)
    .where(eq(journalRetryQueue.id, input.id))
    .limit(1);
  if (!row) return fail("NOT_FOUND", "Antrian tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Antrian dari outlet lain");
  }
  if (row.resolvedAt) {
    return fail("ALREADY_RESOLVED", "Antrian sudah resolved");
  }
  if (row.abandonedAt) {
    return fail("ALREADY_ABANDONED", "Antrian sudah di-abandon");
  }

  const now = new Date();
  await db
    .update(journalRetryQueue)
    .set({
      abandonedAt: now,
      abandonedByUserId: session.user.id,
      abandonedReason: reason,
    })
    .where(eq(journalRetryQueue.id, input.id));

  await logAudit({
    eventType: "journal.retry.abandoned",
    userId: session.user.id,
    entityType: "journal_retry_queue",
    entityId: row.id,
    payload: {
      summary: `Abandon antrian retry ${row.hookLabel}: ${reason}`,
      context: {
        hookLabel: row.hookLabel,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        reason,
      },
    },
    metadata: { outletId: row.outletId, actorRole: session.user.role },
  });

  return ok({ queueId: row.id });
}

// ============================================================
// Public: list + stats
// ============================================================

export async function listJournalQueue(
  opts: ListJournalQueueOptions = {},
): Promise<ApiResult<JournalRetryQueueListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "journal_retry.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat antrian jurnal");
  }
  const status = opts.status ?? "pending";
  const limit = Math.min(opts.limit ?? 100, 500);

  const conds = [eq(journalRetryQueue.outletId, session.user.outletId)];
  if (status === "pending") {
    conds.push(isNull(journalRetryQueue.resolvedAt));
    conds.push(isNull(journalRetryQueue.abandonedAt));
  } else if (status === "resolved") {
    conds.push(sql`${journalRetryQueue.resolvedAt} IS NOT NULL`);
  } else if (status === "abandoned") {
    conds.push(sql`${journalRetryQueue.abandonedAt} IS NOT NULL`);
  }

  const rows = await db
    .select()
    .from(journalRetryQueue)
    .where(and(...conds))
    .orderBy(desc(journalRetryQueue.createdAt))
    .limit(limit);

  // Resolve display names
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.lastRetryByUserId) userIds.add(r.lastRetryByUserId);
    if (r.resolvedByUserId) userIds.add(r.resolvedByUserId);
    if (r.abandonedByUserId) userIds.add(r.abandonedByUserId);
  }
  const nameById = new Map<string, string>();
  if (userIds.size > 0) {
    const usrRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(sql`${users.id} = ANY(${Array.from(userIds)})`);
    for (const u of usrRows) nameById.set(u.id, u.name);
  }

  return ok(
    rows.map((r) => ({
      ...r,
      lastRetryByName: r.lastRetryByUserId
        ? (nameById.get(r.lastRetryByUserId) ?? null)
        : null,
      resolvedByName: r.resolvedByUserId
        ? (nameById.get(r.resolvedByUserId) ?? null)
        : null,
      abandonedByName: r.abandonedByUserId
        ? (nameById.get(r.abandonedByUserId) ?? null)
        : null,
      hookDisplayName: isRetryableHookLabel(r.hookLabel)
        ? HOOK_REGISTRY[r.hookLabel].displayName
        : r.hookLabel,
    })),
  );
}

export async function getJournalQueuePendingCount(): Promise<
  ApiResult<{ pending: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "journal_retry.view")) {
    return fail("FORBIDDEN", "Tidak punya hak");
  }
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(journalRetryQueue)
    .where(
      and(
        eq(journalRetryQueue.outletId, session.user.outletId),
        isNull(journalRetryQueue.resolvedAt),
        isNull(journalRetryQueue.abandonedAt),
      ),
    );
  return ok({ pending: cnt });
}
