import "server-only";

/**
 * Sesi AE-182 — AUTO-RETRY + SAPU JURNAL KOSONG.
 *
 * Jaring pengaman lapis ketiga supaya tidak ada lagi transaksi yang tidak
 * punya jurnal. Tiga lapis pertahanan sekarang:
 *
 *   Lapis 1 — `runAfterResponse` di fireJournalHook: instance serverless
 *             ditahan sampai jurnal selesai (akar masalah lama).
 *   Lapis 2 — retry in-process 3x untuk error koneksi sesaat.
 *   Lapis 3 — MODUL INI: sapu berkala. Dua kerjaan:
 *             (a) retry otomatis semua baris `journal_retry_queue` pending,
 *             (b) SCAN transaksi/pengeluaran yang tidak punya jurnal DAN
 *                 tidak punya baris antrian (kasus "hilang senyap" — ini
 *                 yang bikin 855 transaksi lolos tanpa jurnal sebelum
 *                 audit 2026-08-04), lalu posting jurnalnya.
 *
 * Semua aman diulang: `recordJournal` idempotent per
 * (outletId, sourceType, sourceId) lewat unique index
 * `ux_je_outlet_source_active`. Kalau jurnalnya ternyata sudah ada, hook
 * mengembalikan entry lama tanpa bikin duplikat.
 *
 * Dipanggil dari:
 *   - cron tiap jam (`/api/cron/notifications`) — lookback 7 hari,
 *   - tombol "Sapu Jurnal Kosong" di Back Office → Antrian Jurnal Gagal,
 *   - script backfill sekali jalan (`scripts/_oneshot/backfill-missing-journals.ts`).
 */

import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
  journalEntries,
  journalRetryQueue,
  purchases,
  transactionItems,
  transactions,
  users,
} from "@/db/schema";
import { logAudit } from "@/lib/audit/logger";
import { extractDbError } from "@/lib/db-error";
import {
  postJournalForExpenseCreate,
  postJournalForPosSale,
  postJournalForPosVoid,
} from "./hooks";
import {
  isRetryableHookLabel,
  type RetryQueueHookLabel,
} from "./retry-queue-types";

export interface JournalSweepResult {
  /** Baris antrian yang dicoba ulang otomatis. */
  queueAttempted: number;
  /** Baris antrian yang berhasil → ditandai resolved. */
  queueResolved: number;
  /** Baris antrian yang masih gagal (tetap pending untuk owner). */
  queueStillFailing: number;
  /** Transaksi lunas tanpa jurnal yang berhasil di-posting. */
  salesPosted: number;
  /** Jurnal void yang berhasil di-posting. */
  voidsPosted: number;
  /** Pengeluaran tanpa jurnal yang berhasil di-posting. */
  expensesPosted: number;
  /** Sumber yang di-scan (transaksi + pengeluaran dalam window). */
  scanned: number;
  /** Sumber yang tetap gagal saat di-posting ulang. */
  failed: number;
  errors: string[];
}

export interface JournalSweepOptions {
  /** Batasi ke satu outlet. Default: semua outlet. */
  outletId?: string;
  /** Mundur berapa hari dari sekarang. Default 7. */
  lookbackDays?: number;
  /** Tanggal mulai eksplisit (YYYY-MM-DD) — menang atas lookbackDays. */
  fromDate?: string;
  /** Batas jumlah sumber yang diposting per sapuan. Default 200. */
  limit?: number;
  /** Jeda minimal sejak percobaan terakhir sebelum baris antrian diulang. */
  queueCooldownMinutes?: number;
  /** Dry-run: hitung saja, jangan posting apa pun. */
  dryRun?: boolean;
  /** Kalau true, tulis audit log ringkasan. Default true. */
  audit?: boolean;
}

/**
 * Baris antrian dengan retryCount setinggi ini tidak diulang otomatis lagi —
 * hampir pasti butuh keputusan owner (mis. periode terkunci, akun dihapus).
 * Tetap pending di layar, tetap bisa di-Retry manual.
 */
const MAX_AUTO_RETRY_COUNT = 25;

function emptyResult(): JournalSweepResult {
  return {
    queueAttempted: 0,
    queueResolved: 0,
    queueStillFailing: 0,
    salesPosted: 0,
    voidsPosted: 0,
    expensesPosted: 0,
    scanned: 0,
    failed: 0,
    errors: [],
  };
}

/** YYYY-MM-DD menurut kalender WIB (mirror helper di hooks.ts). */
function jakartaDateOf(d: Date): string {
  const wib = new Date(new Date(d).getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function errMsg(e: unknown): string {
  return extractDbError(e).formatted.slice(0, 300);
}

function startDateOf(opts: JournalSweepOptions): Date {
  if (opts.fromDate) return new Date(`${opts.fromDate}T00:00:00.000Z`);
  const days = opts.lookbackDays ?? 7;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ============================================================
// Bagian A — auto-retry baris antrian yang pending
// ============================================================

/**
 * Registry eksekutor untuk hook yang argumennya self-contained. Sengaja
 * dipisah dari HOOK_REGISTRY di retry-queue.ts (file itu "use server",
 * semua export-nya harus async server action).
 */
async function executeQueuedHook(
  label: RetryQueueHookLabel,
  args: Record<string, unknown>,
): Promise<void> {
  const {
    postJournalForIncomeCreate,
    postJournalForOpnameAdjustment,
    postJournalForPosRefund,
  } = await import("./hooks");
  switch (label) {
    case "pos_sale":
      return postJournalForPosSale(
        args as unknown as Parameters<typeof postJournalForPosSale>[0],
      );
    case "pos_void":
      return postJournalForPosVoid(
        args as unknown as Parameters<typeof postJournalForPosVoid>[0],
      );
    case "pos_refund":
      return postJournalForPosRefund(
        args as unknown as Parameters<typeof postJournalForPosRefund>[0],
      );
    case "expense_create":
      return postJournalForExpenseCreate(
        args as unknown as Parameters<typeof postJournalForExpenseCreate>[0],
      );
    case "income_create":
      return postJournalForIncomeCreate(
        args as unknown as Parameters<typeof postJournalForIncomeCreate>[0],
      );
    case "opname_adjustment":
      return postJournalForOpnameAdjustment(
        args as unknown as Parameters<typeof postJournalForOpnameAdjustment>[0],
      );
  }
}

/**
 * Constraint `ck_journal_retry_resolved_pair` mewajibkan resolved_at dan
 * resolved_by_user_id diisi bersamaan. Sapuan otomatis tidak punya sesi
 * pengguna, jadi baris ditandai atas nama Owner outlet — pemilik keputusan
 * pembukuan. Jejak "ini otomatis, bukan klik manusia" tetap terbaca dari
 * audit log `journal.sweep.completed`.
 *
 * Kalau outlet tidak punya user owner aktif, jatuh ke actorId yang tersimpan
 * di args hook (pelaku aksi aslinya).
 */
const ownerCache = new Map<string, string | null>();

async function resolveSweepActor(
  outletId: string,
  hookArgs: unknown,
): Promise<string | null> {
  if (!ownerCache.has(outletId)) {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.outletId, outletId),
          eq(users.role, "owner"),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    ownerCache.set(outletId, row?.id ?? null);
  }
  const owner = ownerCache.get(outletId) ?? null;
  if (owner) return owner;
  const fallback = (hookArgs as { actorId?: unknown } | null)?.actorId;
  return typeof fallback === "string" ? fallback : null;
}

async function retryPendingQueue(
  opts: JournalSweepOptions,
  result: JournalSweepResult,
): Promise<void> {
  const cooldownMs = (opts.queueCooldownMinutes ?? 10) * 60 * 1000;
  const cooldownCutoff = new Date(Date.now() - cooldownMs);

  const conds = [
    isNull(journalRetryQueue.resolvedAt),
    isNull(journalRetryQueue.abandonedAt),
    lt(journalRetryQueue.retryCount, MAX_AUTO_RETRY_COUNT),
    or(
      isNull(journalRetryQueue.lastRetryAt),
      lt(journalRetryQueue.lastRetryAt, cooldownCutoff),
    )!,
  ];
  if (opts.outletId) {
    conds.push(eq(journalRetryQueue.outletId, opts.outletId));
  }

  const rows = await db
    .select()
    .from(journalRetryQueue)
    .where(and(...conds))
    .limit(opts.limit ?? 200);

  for (const row of rows) {
    if (!isRetryableHookLabel(row.hookLabel)) continue;
    result.queueAttempted++;
    if (opts.dryRun) continue;

    const now = new Date();
    try {
      await executeQueuedHook(
        row.hookLabel,
        (row.hookArgs ?? {}) as Record<string, unknown>,
      );
      /* Best-effort: tautkan ke entry yang barusan/sudah ada. */
      let resolvedEntryId: string | null = null;
      if (row.sourceType && row.sourceId) {
        const [entry] = await db
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.outletId, row.outletId),
              eq(journalEntries.sourceId, row.sourceId),
              sql`${journalEntries.status} <> 'reversed'`,
            ),
          )
          .limit(1);
        resolvedEntryId = entry?.id ?? null;
      }
      const actorId = await resolveSweepActor(row.outletId, row.hookArgs);
      await db
        .update(journalRetryQueue)
        .set({
          /* Tanpa actor, constraint ck_journal_retry_resolved_pair menolak
           * baris ini. Jurnalnya sendiri sudah ter-posting, jadi baris
           * dibiarkan pending (bukan gagal) supaya owner bisa menutupnya
           * manual — bukan malah dianggap error. */
          ...(actorId
            ? { resolvedAt: now, resolvedByUserId: actorId }
            : {}),
          resolvedJournalEntryId: resolvedEntryId,
          retryCount: row.retryCount + 1,
          lastRetryAt: now,
        })
        .where(eq(journalRetryQueue.id, row.id));
      if (actorId) result.queueResolved++;
    } catch (e) {
      result.queueStillFailing++;
      result.errors.push(`queue ${row.id.slice(0, 8)}: ${errMsg(e)}`);
      await db
        .update(journalRetryQueue)
        .set({
          retryCount: row.retryCount + 1,
          lastRetryAt: now,
          lastError: errMsg(e).slice(0, 500),
        })
        .where(eq(journalRetryQueue.id, row.id))
        .catch(() => undefined);
    }
  }
}

// ============================================================
// Bagian B — scan sumber yang tidak punya jurnal sama sekali
// ============================================================

interface SourceJournalIndex {
  /** sourceId yang punya jurnal APA PUN, termasuk yang sudah dibalik. */
  any: Set<string>;
  /** `${sourceId}:${sourceType}` — jurnal apa pun, termasuk dibalik. */
  anyByType: Set<string>;
  /** `${sourceId}:${sourceType}` — hanya jurnal yang masih aktif. */
  activeByType: Set<string>;
}

/**
 * Petakan sumber mana yang sudah punya jurnal. Sengaja dua query + diff di
 * JS, bukan `NOT EXISTS` korelasi — pola `${table.col}` di dalam sql`` bisa
 * ter-render tanpa kualifikasi tabel dan menangkap kolom senama dari query
 * luar (jebakan drizzle yang pernah menggigit di sesi sebelumnya).
 *
 * PENTING: jurnal berstatus 'reversed' TETAP dihitung di `any`. Sapuan
 * otomatis hanya boleh menyentuh sumber yang BELUM PERNAH dijurnal sama
 * sekali. Kalau jurnalnya pernah ada lalu dibalik, itu keputusan sadar
 * (koreksi/void/hapus) — memposting ulang justru menghidupkan lagi biaya
 * atau pendapatan yang sengaja dihapus.
 */
async function indexJournaledSources(
  ids: string[],
): Promise<SourceJournalIndex> {
  const index: SourceJournalIndex = {
    any: new Set(),
    anyByType: new Set(),
    activeByType: new Set(),
  };
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const rows = await db
      .select({
        sourceId: journalEntries.sourceId,
        sourceType: journalEntries.sourceType,
        status: journalEntries.status,
      })
      .from(journalEntries)
      .where(inArray(journalEntries.sourceId, slice));
    for (const r of rows) {
      if (!r.sourceId) continue;
      index.any.add(r.sourceId);
      index.anyByType.add(`${r.sourceId}:${r.sourceType}`);
      if (r.status !== "reversed") {
        index.activeByType.add(`${r.sourceId}:${r.sourceType}`);
      }
    }
  }
  return index;
}

async function sweepMissingSales(
  opts: JournalSweepOptions,
  result: JournalSweepResult,
): Promise<void> {
  const since = startDateOf(opts);
  const conds = [
    gte(transactions.createdAt, since),
    sql`${transactions.status} in ('paid','partially_refunded')`,
  ];
  if (opts.outletId) conds.push(eq(transactions.outletId, opts.outletId));

  const rows = await db
    .select({
      id: transactions.id,
      outletId: transactions.outletId,
      cashierId: transactions.cashierId,
      transactionNumber: transactions.transactionNumber,
    })
    .from(transactions)
    .where(and(...conds));

  result.scanned += rows.length;
  if (rows.length === 0) return;

  const index = await indexJournaledSources(rows.map((r) => r.id));
  const missing = rows.filter((r) => !index.any.has(r.id));
  const budget = opts.limit ?? 200;

  for (const trx of missing.slice(0, budget)) {
    if (opts.dryRun) {
      result.salesPosted++;
      continue;
    }
    try {
      await postJournalForPosSale({
        outletId: trx.outletId,
        transactionId: trx.id,
        /* Kasir yang menjalankan transaksi = actor jurnalnya. */
        actorId: trx.cashierId,
      });
      result.salesPosted++;
    } catch (e) {
      result.failed++;
      result.errors.push(`${trx.transactionNumber}: ${errMsg(e)}`);
    }
  }
  if (missing.length > budget) {
    result.errors.push(
      `${missing.length - budget} transaksi lagi belum diproses (batas ${budget} per sapuan) — sapuan berikutnya lanjut.`,
    );
  }
}

async function sweepMissingVoids(
  opts: JournalSweepOptions,
  result: JournalSweepResult,
): Promise<void> {
  const since = startDateOf(opts);
  const conds = [
    gte(transactions.createdAt, since),
    eq(transactions.status, "voided"),
  ];
  if (opts.outletId) conds.push(eq(transactions.outletId, opts.outletId));

  const rows = await db
    .select({
      id: transactions.id,
      outletId: transactions.outletId,
      cashierId: transactions.cashierId,
      transactionNumber: transactions.transactionNumber,
      voidedBy: transactions.voidedBy,
      voidedAt: transactions.voidedAt,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(and(...conds));
  if (rows.length === 0) return;
  result.scanned += rows.length;

  const index = await indexJournaledSources(rows.map((r) => r.id));
  /* PENTING: hanya posting jurnal void kalau jurnal penjualannya ADA.
   * Kalau penjualannya tidak pernah terjurnal (kasus lama), memposting
   * void saja akan bikin pendapatan negatif yang tidak punya lawan —
   * justru merusak GL. Penjualan + void yang dua-duanya absen = netral,
   * biarkan saja. */
  const needVoid = rows.filter(
    (r) =>
      index.activeByType.has(`${r.id}:pos_sale`) &&
      !index.anyByType.has(`${r.id}:pos_void`),
  );

  for (const trx of needVoid) {
    if (opts.dryRun) {
      result.voidsPosted++;
      continue;
    }
    try {
      const items = await db
        .select({
          itemCategoryName: transactionItems.itemCategoryName,
          subtotal: transactionItems.subtotal,
          cogs: transactionItems.cogs,
        })
        .from(transactionItems)
        .where(eq(transactionItems.transactionId, trx.id));
      await postJournalForPosVoid({
        outletId: trx.outletId,
        transactionId: trx.id,
        items: items.map((it) => ({
          itemCategoryName: it.itemCategoryName,
          amount: Number(it.subtotal),
          cogs: Number(it.cogs ?? 0),
        })),
        actorId: trx.voidedBy ?? trx.cashierId,
        /* Tanggal jurnal = tanggal void-nya, bukan tanggal sapuan. Kalau
         * tidak dipaksa, backfill void bulan lalu akan mendarat di bulan
         * berjalan dan bikin laporan dua bulan sama-sama salah. */
        entryDate: jakartaDateOf(trx.voidedAt ?? trx.createdAt),
      });
      result.voidsPosted++;
    } catch (e) {
      result.failed++;
      result.errors.push(`void ${trx.transactionNumber}: ${errMsg(e)}`);
    }
  }
}

async function sweepMissingExpenses(
  opts: JournalSweepOptions,
  result: JournalSweepResult,
): Promise<void> {
  const since = startDateOf(opts);
  const sinceIso = since.toISOString().slice(0, 10);
  /* HANYA sourceType 'manual'. Pengeluaran yang lahir dari modul Payroll /
   * Pembelian / Hutang Internal PUNYA jurnal sendiri dengan sourceId
   * berbeda (payroll_paid, purchase_create, internal_debt_expense), jadi
   * dari sudut pandang query "expense tanpa jurnal" mereka selalu terlihat
   * kosong padahal tidak. postJournalForExpenseCreate memang menolaknya
   * (guard sourceType !== 'manual'), tapi tanpa filter di sini sapuan akan
   * mencobanya lagi tiap jam selamanya dan angka laporannya menyesatkan. */
  const conds = [
    gte(expenses.expenseDate, sinceIso),
    eq(expenses.sourceType, "manual"),
  ];
  if (opts.outletId) conds.push(eq(expenses.outletId, opts.outletId));

  const rows = await db
    .select({
      id: expenses.id,
      outletId: expenses.outletId,
      createdBy: expenses.createdBy,
      description: expenses.description,
    })
    .from(expenses)
    .where(and(...conds));
  if (rows.length === 0) return;
  result.scanned += rows.length;

  /* Pengeluaran yang lahir dari modul Pembelian / Payroll / Hutang Internal
   * dijurnal lewat sumber lain (purchase_create, payroll_paid,
   * internal_debt_expense) dengan sourceId berbeda — JANGAN diposting ulang
   * sebagai expense_create, nanti dobel. */
  const linkedPurchase = await db
    .select({ expenseId: purchases.expenseId })
    .from(purchases)
    .where(inArray(purchases.expenseId, rows.map((r) => r.id)));
  const fromPurchase = new Set(
    linkedPurchase.map((p) => p.expenseId).filter((x): x is string => !!x),
  );

  const index = await indexJournaledSources(rows.map((r) => r.id));
  const missing = rows.filter(
    (r) => !index.any.has(r.id) && !fromPurchase.has(r.id),
  );

  for (const exp of missing) {
    if (opts.dryRun) {
      result.expensesPosted++;
      continue;
    }
    try {
      await postJournalForExpenseCreate({
        outletId: exp.outletId,
        expenseId: exp.id,
        actorId: exp.createdBy,
      });
      result.expensesPosted++;
    } catch (e) {
      result.failed++;
      result.errors.push(`expense "${exp.description}": ${errMsg(e)}`);
    }
  }
}

// ============================================================
// Entry point
// ============================================================

export async function sweepJournalGaps(
  opts: JournalSweepOptions = {},
): Promise<JournalSweepResult> {
  const result = emptyResult();

  const steps: Array<[string, () => Promise<void>]> = [
    ["antrian", () => retryPendingQueue(opts, result)],
    ["penjualan", () => sweepMissingSales(opts, result)],
    ["void", () => sweepMissingVoids(opts, result)],
    ["pengeluaran", () => sweepMissingExpenses(opts, result)],
  ];

  for (const [name, run] of steps) {
    try {
      await run();
    } catch (e) {
      result.errors.push(`tahap ${name}: ${errMsg(e)}`);
    }
  }

  const fixed =
    result.queueResolved +
    result.salesPosted +
    result.voidsPosted +
    result.expensesPosted;

  if ((opts.audit ?? true) && !opts.dryRun && (fixed > 0 || result.failed > 0)) {
    await logAudit({
      eventType: "journal.sweep.completed",
      userId: null,
      entityType: "journal_entry",
      entityId: null,
      payload: {
        summary: `🧹 Sapu jurnal kosong: ${fixed} jurnal dipulihkan (${result.salesPosted} penjualan, ${result.voidsPosted} void, ${result.expensesPosted} pengeluaran, ${result.queueResolved} dari antrian)${result.failed > 0 ? `, ${result.failed} masih gagal` : ""}`,
        context: { ...result, errors: result.errors.slice(0, 10) },
      },
      metadata: opts.outletId
        ? { outletId: opts.outletId, actorRole: "system" }
        : { actorRole: "system" },
    }).catch((e) => console.error("[audit journal.sweep]", e));
  }

  return result;
}
