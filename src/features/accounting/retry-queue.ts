"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  journalEntries,
  journalRetryQueue,
  refundEvents,
  stockOpnameSessions,
  transactions,
  users,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { extractDbError } from "@/lib/db-error";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
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
  type JournalRetryQueueRow,
  type ListJournalQueueOptions,
  type RetryQueueHookLabel,
  type SourceContextField,
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
// Public: sapu jurnal kosong (manual trigger, sesi AE-182)
// ============================================================

/**
 * Jalankan sapuan sekarang juga: retry semua antrian pending + cari
 * transaksi/pengeluaran yang tidak punya jurnal lalu posting ulang.
 *
 * Versi cron-nya jalan otomatis tiap jam dengan lookback 7 hari. Tombol ini
 * untuk owner yang mau langsung menutup celah tanpa menunggu, dan bisa
 * mundur lebih jauh (default 30 hari).
 */
export async function sweepJournalGapsAction(input?: {
  lookbackDays?: number;
}): Promise<
  ApiResult<{
    fixed: number;
    salesPosted: number;
    voidsPosted: number;
    expensesPosted: number;
    settlementsPosted: number;
    queueResolved: number;
    failed: number;
    errors: string[];
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "journal_retry.retry")) {
    return fail("FORBIDDEN", "Tidak punya hak menjalankan sapuan jurnal");
  }
  const { sweepJournalGaps } = await import("./auto-retry");
  try {
    const r = await sweepJournalGaps({
      outletId: session.user.outletId,
      lookbackDays: Math.min(Math.max(input?.lookbackDays ?? 30, 1), 400),
      limit: 300,
      queueCooldownMinutes: 0,
    });
    return ok({
      fixed:
        r.queueResolved +
        r.salesPosted +
        r.voidsPosted +
        r.expensesPosted +
        r.settlementsPosted,
      salesPosted: r.salesPosted,
      voidsPosted: r.voidsPosted,
      expensesPosted: r.expensesPosted,
      settlementsPosted: r.settlementsPosted,
      queueResolved: r.queueResolved,
      failed: r.failed,
      errors: r.errors.slice(0, 10),
    });
  } catch (e) {
    return fail(
      "SWEEP_FAILED",
      logAndSanitize(e, "journal-sweep", "Sapuan jurnal gagal dijalankan"),
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
// Source context enrichment (list view)
// ============================================================

/* Feedback owner 2026-06-12 — orang finance/accounting/inventory butuh tahu
 * "ini jurnal pending milik transaksi/aksi APA" sebelum berani klik Retry,
 * bukan cuma stack trace coding. Lookup batch ke tabel sumber (best-effort,
 * try/catch per lookup — lookup gagal tidak boleh nge-blank list, pattern
 * sama dengan user-names lookup di bawah). */

function argStr(args: unknown, key: string): string | null {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : null;
}

function argNum(args: unknown, key: string): number | null {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const TRX_PAYMENT_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  card_bca: "Kartu BCA",
  card_bni: "Kartu BNI",
  card_mandiri: "Kartu Mandiri",
  card_bri: "Kartu BRI",
  card_other: "Kartu Lainnya",
  split: "Split Metode",
};

const TRX_STATUS_LABEL: Record<string, string> = {
  paid: "Lunas",
  voided: "Di-void",
  refunded: "Refund penuh",
  partially_refunded: "Refund sebagian",
  open: "Open bill",
};

const EXPENSE_PAYMENT_LABEL: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  other: "Lainnya",
};

const INCOME_PAYMENT_LABEL: Record<string, string> = {
  cash: "Tunai",
  transfer_bca: "Transfer BCA",
};

const OPNAME_STATUS_LABEL: Record<string, string> = {
  in_progress: "Sedang berjalan",
  pending_review: "Menunggu review",
  completed: "Selesai (final)",
  cancelled: "Dibatalkan",
};

interface TrxContextRow {
  id: string;
  transactionNumber: string;
  total: number;
  paymentMethod: string;
  status: string;
  customerName: string | null;
  createdAt: Date;
  cashierId: string;
  voidReason: string | null;
  refundReason: string | null;
}

interface SourceContextMaps {
  trxById: Map<string, TrxContextRow>;
  refundById: Map<
    string,
    { totalRefunded: number; reason: string; kind: string }
  >;
  expenseById: Map<
    string,
    {
      description: string;
      amount: number;
      expenseDate: string;
      paymentMethod: string;
      categoryName: string | null;
    }
  >;
  opnameById: Map<string, { periodLabel: string; status: string }>;
  nameById: Map<string, string>;
}

function trxFields(
  trx: TrxContextRow,
  nameById: Map<string, string>,
): SourceContextField[] {
  const fields: SourceContextField[] = [
    { label: "No. transaksi", value: trx.transactionNumber },
    { label: "Waktu transaksi", value: formatDateTime(trx.createdAt) },
    { label: "Total transaksi", value: formatRupiah(trx.total) },
    {
      label: "Pembayaran",
      value: TRX_PAYMENT_LABEL[trx.paymentMethod] ?? trx.paymentMethod,
    },
    { label: "Kasir", value: nameById.get(trx.cashierId) ?? "—" },
  ];
  if (trx.customerName) {
    fields.push({ label: "Pelanggan", value: trx.customerName });
  }
  fields.push({
    label: "Status transaksi",
    value: TRX_STATUS_LABEL[trx.status] ?? trx.status,
  });
  return fields;
}

/** Build ringkasan + detail bisnis per row. Return summary null kalau source
 * record tidak ketemu (mis. sudah dihapus / args snapshot incomplete) —
 * UI fallback ke tampilan lama. */
function buildSourceContext(
  r: JournalRetryQueueRow,
  maps: SourceContextMaps,
): { summary: string | null; fields: SourceContextField[] } {
  const a = r.hookArgs;
  const fields: SourceContextField[] = [];

  if (
    r.hookLabel === "pos_sale" ||
    r.hookLabel === "pos_void" ||
    r.hookLabel === "pos_refund"
  ) {
    const trxId = argStr(a, "transactionId");
    const trx = trxId ? maps.trxById.get(trxId) : undefined;
    if (!trx) {
      return {
        summary: trxId
          ? `Transaksi POS (ID ${trxId.slice(0, 8)}…) — data transaksi tidak ditemukan`
          : null,
        fields,
      };
    }
    fields.push(...trxFields(trx, maps.nameById));
    const kasir = maps.nameById.get(trx.cashierId) ?? "—";

    if (r.hookLabel === "pos_sale") {
      fields.push({
        label: "Jurnal yang tertunda",
        value:
          "Pencatatan penjualan (pendapatan + kas/bank + HPP) — transaksi sudah tersimpan di POS, tinggal pembukuannya",
      });
      return {
        summary: `Transaksi ${trx.transactionNumber} — ${formatRupiah(trx.total)} (${TRX_PAYMENT_LABEL[trx.paymentMethod] ?? trx.paymentMethod}), kasir ${kasir}`,
        fields,
      };
    }

    if (r.hookLabel === "pos_void") {
      if (trx.voidReason) {
        fields.push({ label: "Alasan void", value: trx.voidReason });
      }
      fields.push({
        label: "Jurnal yang tertunda",
        value:
          "Pembalikan jurnal penjualan (void) — void sudah terjadi di POS, pembukuannya belum",
      });
      return {
        summary: `Void transaksi ${trx.transactionNumber} — ${formatRupiah(trx.total)}, kasir ${kasir}`,
        fields,
      };
    }

    // pos_refund
    const refundEventId = argStr(a, "refundEventId");
    const refund = refundEventId
      ? maps.refundById.get(refundEventId)
      : undefined;
    const refundedAmount =
      refund?.totalRefunded ?? argNum(a, "refundedAmount") ?? null;
    if (refundedAmount !== null) {
      fields.push({
        label: "Nominal refund",
        value: `${formatRupiah(refundedAmount)}${refund?.kind === "partial" ? " (refund sebagian)" : refund?.kind === "full" ? " (refund penuh)" : ""}`,
      });
    }
    if (refund?.reason) {
      fields.push({ label: "Alasan refund", value: refund.reason });
    }
    fields.push({
      label: "Jurnal yang tertunda",
      value:
        "Pengurangan pendapatan + kas keluar refund — refund sudah terjadi di POS, pembukuannya belum",
    });
    return {
      summary: `Refund ${refundedAmount !== null ? formatRupiah(refundedAmount) : "—"} untuk transaksi ${trx.transactionNumber}`,
      fields,
    };
  }

  if (r.hookLabel === "expense_create") {
    const expenseId = argStr(a, "expenseId");
    const exp = expenseId ? maps.expenseById.get(expenseId) : undefined;
    if (!exp) {
      return {
        summary: expenseId
          ? `Pengeluaran (ID ${expenseId.slice(0, 8)}…) — data pengeluaran tidak ditemukan`
          : null,
        fields,
      };
    }
    fields.push(
      { label: "Deskripsi", value: exp.description },
      { label: "Kategori", value: exp.categoryName ?? "—" },
      { label: "Nominal", value: formatRupiah(exp.amount) },
      { label: "Tanggal pengeluaran", value: formatDate(exp.expenseDate) },
      {
        label: "Pembayaran",
        value: EXPENSE_PAYMENT_LABEL[exp.paymentMethod] ?? exp.paymentMethod,
      },
      {
        label: "Jurnal yang tertunda",
        value:
          "Pencatatan beban + kas keluar — pengeluaran sudah tersimpan, pembukuannya belum",
      },
    );
    return {
      summary: `Pengeluaran "${exp.description}" — ${formatRupiah(exp.amount)} (${formatDate(exp.expenseDate)})`,
      fields,
    };
  }

  if (r.hookLabel === "income_create") {
    // Args snapshot sudah self-contained (amount/description/dll) — tidak
    // perlu lookup DB.
    const description = argStr(a, "description");
    const amount = argNum(a, "amount");
    const paymentMethod = argStr(a, "paymentMethod");
    const entryDate = argStr(a, "entryDate");
    if (description === null && amount === null) {
      return { summary: null, fields };
    }
    if (description) fields.push({ label: "Deskripsi", value: description });
    if (amount !== null) {
      fields.push({ label: "Nominal", value: formatRupiah(amount) });
    }
    if (paymentMethod) {
      fields.push({
        label: "Pembayaran",
        value: INCOME_PAYMENT_LABEL[paymentMethod] ?? paymentMethod,
      });
    }
    if (entryDate) {
      fields.push({ label: "Tanggal", value: formatDate(entryDate) });
    }
    fields.push({
      label: "Jurnal yang tertunda",
      value:
        "Pencatatan pemasukan lain + kas masuk — pemasukan sudah tersimpan, pembukuannya belum",
    });
    return {
      summary: `Pemasukan "${description ?? "—"}" — ${amount !== null ? formatRupiah(amount) : "—"}`,
      fields,
    };
  }

  if (r.hookLabel === "opname_adjustment") {
    const sessionId = argStr(a, "opnameSessionId");
    const session = sessionId ? maps.opnameById.get(sessionId) : undefined;
    const sessionLabel =
      argStr(a, "sessionLabel") ?? session?.periodLabel ?? null;
    const entryDate = argStr(a, "entryDate");
    if (!sessionLabel && !session) {
      return { summary: null, fields };
    }
    if (sessionLabel) {
      fields.push({ label: "Sesi opname", value: sessionLabel });
    }
    if (session) {
      fields.push({
        label: "Status sesi",
        value: OPNAME_STATUS_LABEL[session.status] ?? session.status,
      });
    }
    if (entryDate) {
      fields.push({ label: "Tanggal jurnal", value: formatDate(entryDate) });
    }
    // sectionDiffs = [{section, diffValue}] — net rupiah per bagian.
    // Positif = surplus stok, negatif = kekurangan.
    const diffs = (a as Record<string, unknown> | null)?.sectionDiffs;
    let totalDiff: number | null = null;
    if (Array.isArray(diffs)) {
      totalDiff = 0;
      for (const d of diffs) {
        const v = (d as Record<string, unknown> | null)?.diffValue;
        if (typeof v === "number" && Number.isFinite(v)) totalDiff += v;
      }
    }
    if (totalDiff !== null) {
      fields.push({
        label: "Nilai penyesuaian",
        value: `${totalDiff < 0 ? "-" : "+"}${formatRupiah(Math.abs(totalDiff))} (${totalDiff < 0 ? "stok kurang dari catatan" : totalDiff > 0 ? "stok lebih dari catatan" : "tidak ada selisih"})`,
      });
    }
    fields.push({
      label: "Jurnal yang tertunda",
      value:
        "Penyesuaian nilai persediaan hasil opname — hasil opname sudah tersimpan, pembukuannya belum",
    });
    return {
      summary: `Opname ${sessionLabel ?? "—"}${totalDiff !== null ? ` — penyesuaian ${totalDiff < 0 ? "-" : "+"}${formatRupiah(Math.abs(totalDiff))}` : ""}`,
      fields,
    };
  }

  return { summary: null, fields };
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

  /* Sesi AE-76 — wrap primary query di try/catch + extractDbError → kalau
   * gagal, return fail() dengan reason aktual (bukan throw 500). UI bisa
   * tampilkan error message ke owner. Sebelumnya error throw → server
   * action throws → React Query error state ditelan UI → blank list. */
  let rows;
  try {
    rows = await db
      .select()
      .from(journalRetryQueue)
      .where(and(...conds))
      .orderBy(desc(journalRetryQueue.createdAt))
      .limit(limit);
  } catch (e) {
    const dbErr = extractDbError(e);
    console.error("[listJournalQueue primary query]", e);
    return fail("DB_ERROR", `Gagal load antrian: ${dbErr.formatted}`);
  }

  /* Lookup batch ke tabel sumber per hook label — semua best-effort
   * (lookup gagal → row tampil tanpa konteks bisnis, bukan blank list). */
  const trxIds = new Set<string>();
  const refundEventIds = new Set<string>();
  const expenseIds = new Set<string>();
  const opnameSessionIds = new Set<string>();
  for (const r of rows) {
    if (
      r.hookLabel === "pos_sale" ||
      r.hookLabel === "pos_void" ||
      r.hookLabel === "pos_refund"
    ) {
      const id = argStr(r.hookArgs, "transactionId");
      if (id) trxIds.add(id);
    }
    if (r.hookLabel === "pos_refund") {
      const id = argStr(r.hookArgs, "refundEventId");
      if (id) refundEventIds.add(id);
    }
    if (r.hookLabel === "expense_create") {
      const id = argStr(r.hookArgs, "expenseId");
      if (id) expenseIds.add(id);
    }
    if (r.hookLabel === "opname_adjustment") {
      const id = argStr(r.hookArgs, "opnameSessionId");
      if (id) opnameSessionIds.add(id);
    }
  }

  const maps: SourceContextMaps = {
    trxById: new Map(),
    refundById: new Map(),
    expenseById: new Map(),
    opnameById: new Map(),
    nameById: new Map(),
  };

  if (trxIds.size > 0) {
    try {
      const trxRows = await db
        .select({
          id: transactions.id,
          transactionNumber: transactions.transactionNumber,
          total: transactions.total,
          paymentMethod: transactions.paymentMethod,
          status: transactions.status,
          customerName: transactions.customerName,
          createdAt: transactions.createdAt,
          cashierId: transactions.cashierId,
          voidReason: transactions.voidReason,
          refundReason: transactions.refundReason,
        })
        .from(transactions)
        .where(inArray(transactions.id, Array.from(trxIds)));
      for (const t of trxRows) maps.trxById.set(t.id, t);
    } catch (e) {
      console.error("[listJournalQueue trx lookup]", e);
    }
  }
  if (refundEventIds.size > 0) {
    try {
      const refundRows = await db
        .select({
          id: refundEvents.id,
          totalRefunded: refundEvents.totalRefunded,
          reason: refundEvents.reason,
          kind: refundEvents.kind,
        })
        .from(refundEvents)
        .where(inArray(refundEvents.id, Array.from(refundEventIds)));
      for (const r of refundRows) maps.refundById.set(r.id, r);
    } catch (e) {
      console.error("[listJournalQueue refund lookup]", e);
    }
  }
  if (expenseIds.size > 0) {
    try {
      const expRows = await db
        .select({
          id: expenses.id,
          description: expenses.description,
          amount: expenses.amount,
          expenseDate: expenses.expenseDate,
          paymentMethod: expenses.paymentMethod,
          categoryName: expenseCategories.name,
        })
        .from(expenses)
        .leftJoin(
          expenseCategories,
          eq(expenses.categoryId, expenseCategories.id),
        )
        .where(inArray(expenses.id, Array.from(expenseIds)));
      for (const x of expRows) maps.expenseById.set(x.id, x);
    } catch (e) {
      console.error("[listJournalQueue expense lookup]", e);
    }
  }
  if (opnameSessionIds.size > 0) {
    try {
      const opRows = await db
        .select({
          id: stockOpnameSessions.id,
          periodLabel: stockOpnameSessions.periodLabel,
          status: stockOpnameSessions.status,
        })
        .from(stockOpnameSessions)
        .where(inArray(stockOpnameSessions.id, Array.from(opnameSessionIds)));
      for (const o of opRows) maps.opnameById.set(o.id, o);
    } catch (e) {
      console.error("[listJournalQueue opname lookup]", e);
    }
  }

  /* Resolve display names. Sesi AE-76 — replace `sql\`= ANY(${array})\``
   * dengan inArray() helper. Pattern lama tidak reliable di prod
   * (Neon serverless) — sama bug yang fix-ed di sesi AE-68 (investors).
   * Plus wrap di try/catch supaya secondary query failure tidak nge-blank
   * seluruh list — owner masih lihat row dengan "—" di kolom user. */
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.lastRetryByUserId) userIds.add(r.lastRetryByUserId);
    if (r.resolvedByUserId) userIds.add(r.resolvedByUserId);
    if (r.abandonedByUserId) userIds.add(r.abandonedByUserId);
  }
  // Nama kasir transaksi sumber ikut di-resolve (1 query gabungan).
  for (const t of maps.trxById.values()) userIds.add(t.cashierId);
  const nameById = new Map<string, string>();
  if (userIds.size > 0) {
    try {
      const usrRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, Array.from(userIds)));
      for (const u of usrRows) nameById.set(u.id, u.name);
    } catch (e) {
      console.error("[listJournalQueue user names lookup]", e);
      /* Fallthrough — nameById empty, UI tampil "—" untuk nama. Lebih baik
       * partial data daripada blank list (sesi AE-68 lesson). */
    }
  }

  maps.nameById = nameById;

  return ok(
    rows.map((r) => {
      const ctx = buildSourceContext(r, maps);
      return {
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
        sourceSummary: ctx.summary,
        sourceContext: ctx.fields,
      };
    }),
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
