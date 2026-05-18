"use server";

import { createHash } from "node:crypto";
import { and, between, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  historicalDailySummary,
  historicalExpense,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  fail,
  ok,
  type ApiResult,
  type BulkImportExpenseInput,
  type BulkImportResult,
  type BulkImportSummaryInput,
  type CreateHistoricalExpenseInput,
  type CreateHistoricalSummaryInput,
  type HistoricalDailySummary,
  type HistoricalDailySummaryRow,
  type HistoricalExpense,
  type HistoricalExpenseRow,
  type ListHistoricalExpenseOptions,
  type ListHistoricalSummaryOptions,
  type UpdateHistoricalSummaryInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateMoneyFields(
  v: Partial<CreateHistoricalSummaryInput>,
): string | null {
  const fields = [
    "grossRevenue",
    "totalRefund",
    "totalVoid",
    "totalDiscount",
    "netRevenue",
    "cogs",
    "cashIn",
    "qrisIn",
    "edcIn",
    "aggregatorIn",
  ] as const;
  for (const f of fields) {
    const n = v[f];
    if (n === undefined || n === null) continue;
    if (!Number.isFinite(n) || n < 0) {
      return `${f} harus angka >= 0`;
    }
  }
  if (v.transactionCount !== undefined && v.transactionCount !== null) {
    if (!Number.isInteger(v.transactionCount) || v.transactionCount < 0) {
      return "transactionCount harus integer >= 0";
    }
  }
  return null;
}

function withMarginPct(
  row: HistoricalDailySummary,
): HistoricalDailySummaryRow {
  const margin =
    row.netRevenue > 0
      ? Math.round(((row.netRevenue - row.cogs) / row.netRevenue) * 100 * 100) /
        100
      : null;
  return { ...row, marginPct: margin };
}

/* -------------------------------------------------------------------------- */
/* HISTORICAL DAILY SUMMARY                                                    */
/* -------------------------------------------------------------------------- */

export async function listHistoricalSummary(
  options: ListHistoricalSummaryOptions = {},
): Promise<ApiResult<HistoricalDailySummaryRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data historis");
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const filters = [eq(historicalDailySummary.outletId, session.user.outletId)];
  if (options.from && options.to && ISO_DATE_RE.test(options.from) && ISO_DATE_RE.test(options.to)) {
    filters.push(
      between(historicalDailySummary.businessDate, options.from, options.to),
    );
  } else {
    if (options.from && ISO_DATE_RE.test(options.from)) {
      filters.push(gte(historicalDailySummary.businessDate, options.from));
    }
    if (options.to && ISO_DATE_RE.test(options.to)) {
      filters.push(lte(historicalDailySummary.businessDate, options.to));
    }
  }
  const rows = await db
    .select()
    .from(historicalDailySummary)
    .where(and(...filters))
    .orderBy(desc(historicalDailySummary.businessDate))
    .limit(limit);
  return ok(rows.map(withMarginPct));
}

export async function createHistoricalSummary(
  input: CreateHistoricalSummaryInput,
): Promise<ApiResult<HistoricalDailySummary>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.import")) {
    return fail("FORBIDDEN", "Tidak punya hak input data historis");
  }
  if (!ISO_DATE_RE.test(input.businessDate)) {
    return fail("VALIDATION_ERROR", "Tanggal harus format YYYY-MM-DD");
  }
  const moneyErr = validateMoneyFields(input);
  if (moneyErr) return fail("VALIDATION_ERROR", moneyErr);

  const [created] = await db
    .insert(historicalDailySummary)
    .values({
      outletId: session.user.outletId,
      businessDate: input.businessDate,
      grossRevenue: input.grossRevenue ?? 0,
      totalRefund: input.totalRefund ?? 0,
      totalVoid: input.totalVoid ?? 0,
      totalDiscount: input.totalDiscount ?? 0,
      netRevenue: input.netRevenue ?? 0,
      transactionCount: input.transactionCount ?? 0,
      cogs: input.cogs ?? 0,
      cashIn: input.cashIn ?? 0,
      qrisIn: input.qrisIn ?? 0,
      edcIn: input.edcIn ?? 0,
      aggregatorIn: input.aggregatorIn ?? 0,
      sourceLabel: input.sourceLabel ?? null,
      notes: input.notes ?? null,
      createdBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [
        historicalDailySummary.outletId,
        historicalDailySummary.businessDate,
      ],
      set: {
        grossRevenue: input.grossRevenue ?? 0,
        totalRefund: input.totalRefund ?? 0,
        totalVoid: input.totalVoid ?? 0,
        totalDiscount: input.totalDiscount ?? 0,
        netRevenue: input.netRevenue ?? 0,
        transactionCount: input.transactionCount ?? 0,
        cogs: input.cogs ?? 0,
        cashIn: input.cashIn ?? 0,
        qrisIn: input.qrisIn ?? 0,
        edcIn: input.edcIn ?? 0,
        aggregatorIn: input.aggregatorIn ?? 0,
        sourceLabel: input.sourceLabel ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!created) return fail("INTERNAL", "Gagal simpan");

  logAudit({
    eventType: "historical.update",
    userId: session.user.id,
    entityType: "historical_daily_summary",
    entityId: created.id,
    payload: {
      summary: `Historis ${input.businessDate}: net Rp ${(input.netRevenue ?? 0).toLocaleString("id-ID")}`,
      after: created,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit historical.update]", e));

  return ok(created);
}

export async function updateHistoricalSummary(
  input: UpdateHistoricalSummaryInput,
): Promise<ApiResult<HistoricalDailySummary>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit data historis");
  }
  const moneyErr = validateMoneyFields(input);
  if (moneyErr) return fail("VALIDATION_ERROR", moneyErr);

  const [existing] = await db
    .select()
    .from(historicalDailySummary)
    .where(eq(historicalDailySummary.id, input.id))
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Data historis tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Data dari outlet lain");
  }

  const updateSet: Partial<typeof historicalDailySummary.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.grossRevenue !== undefined) updateSet.grossRevenue = input.grossRevenue;
  if (input.totalRefund !== undefined) updateSet.totalRefund = input.totalRefund;
  if (input.totalVoid !== undefined) updateSet.totalVoid = input.totalVoid;
  if (input.totalDiscount !== undefined) updateSet.totalDiscount = input.totalDiscount;
  if (input.netRevenue !== undefined) updateSet.netRevenue = input.netRevenue;
  if (input.transactionCount !== undefined)
    updateSet.transactionCount = input.transactionCount;
  if (input.cogs !== undefined) updateSet.cogs = input.cogs;
  if (input.cashIn !== undefined) updateSet.cashIn = input.cashIn;
  if (input.qrisIn !== undefined) updateSet.qrisIn = input.qrisIn;
  if (input.edcIn !== undefined) updateSet.edcIn = input.edcIn;
  if (input.aggregatorIn !== undefined) updateSet.aggregatorIn = input.aggregatorIn;
  if (input.sourceLabel !== undefined) updateSet.sourceLabel = input.sourceLabel;
  if (input.notes !== undefined) updateSet.notes = input.notes;

  const [updated] = await db
    .update(historicalDailySummary)
    .set(updateSet)
    .where(eq(historicalDailySummary.id, input.id))
    .returning();
  if (!updated) return fail("INTERNAL", "Gagal update");

  logAudit({
    eventType: "historical.update",
    userId: session.user.id,
    entityType: "historical_daily_summary",
    entityId: updated.id,
    payload: {
      summary: `Edit historis ${updated.businessDate}`,
      before: existing,
      after: updated,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit historical.update]", e));

  return ok(updated);
}

export async function deleteHistoricalSummary(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.update")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus data historis");
  }
  const [existing] = await db
    .select()
    .from(historicalDailySummary)
    .where(eq(historicalDailySummary.id, id))
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Data historis tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Data dari outlet lain");
  }
  await db
    .delete(historicalDailySummary)
    .where(eq(historicalDailySummary.id, id));

  logAudit({
    eventType: "historical.delete",
    userId: session.user.id,
    entityType: "historical_daily_summary",
    entityId: id,
    payload: {
      summary: `Hapus historis ${existing.businessDate}`,
      before: existing,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit historical.delete]", e));

  return ok({ id });
}

/** Bulk import dari CSV parser output. Idempotent: ON CONFLICT (outlet, date)
 *  DO UPDATE — kalau re-upload CSV yang sama, baris existing di-overwrite. */
export async function bulkImportHistoricalSummary(
  input: BulkImportSummaryInput,
): Promise<ApiResult<BulkImportResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.import")) {
    return fail("FORBIDDEN", "Tidak punya hak import data historis");
  }
  if (input.rows.length === 0) {
    return fail("VALIDATION_ERROR", "Tidak ada baris untuk di-import");
  }
  if (input.rows.length > 1000) {
    return fail(
      "VALIDATION_ERROR",
      "Maksimal 1000 baris per import (split jadi beberapa file)",
    );
  }

  // Cek baris mana yang sudah ada (untuk hitung inserted vs updated)
  const dates = input.rows.map((r) => r.businessDate);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const existing = await db
    .select({ businessDate: historicalDailySummary.businessDate })
    .from(historicalDailySummary)
    .where(
      and(
        eq(historicalDailySummary.outletId, session.user.outletId),
        between(historicalDailySummary.businessDate, minDate, maxDate),
      ),
    );
  const existingDates = new Set(existing.map((r) => r.businessDate));
  let inserted = 0;
  let updated = 0;
  for (const r of input.rows) {
    if (existingDates.has(r.businessDate)) updated++;
    else inserted++;
  }

  // Batch upsert
  const values = input.rows.map((r) => ({
    outletId: session.user.outletId,
    businessDate: r.businessDate,
    grossRevenue: r.grossRevenue,
    totalRefund: r.totalRefund,
    totalVoid: r.totalVoid,
    totalDiscount: r.totalDiscount,
    netRevenue: r.netRevenue,
    transactionCount: r.transactionCount,
    cogs: r.cogs,
    cashIn: r.cashIn,
    qrisIn: r.qrisIn,
    edcIn: r.edcIn,
    aggregatorIn: r.aggregatorIn,
    sourceLabel: input.sourceLabel,
    createdBy: session.user.id,
  }));
  await db
    .insert(historicalDailySummary)
    .values(values)
    .onConflictDoUpdate({
      target: [
        historicalDailySummary.outletId,
        historicalDailySummary.businessDate,
      ],
      set: {
        grossRevenue: sql`EXCLUDED.gross_revenue`,
        totalRefund: sql`EXCLUDED.total_refund`,
        totalVoid: sql`EXCLUDED.total_void`,
        totalDiscount: sql`EXCLUDED.total_discount`,
        netRevenue: sql`EXCLUDED.net_revenue`,
        transactionCount: sql`EXCLUDED.transaction_count`,
        cogs: sql`EXCLUDED.cogs`,
        cashIn: sql`EXCLUDED.cash_in`,
        qrisIn: sql`EXCLUDED.qris_in`,
        edcIn: sql`EXCLUDED.edc_in`,
        aggregatorIn: sql`EXCLUDED.aggregator_in`,
        sourceLabel: sql`EXCLUDED.source_label`,
        updatedAt: new Date(),
      },
    });

  const result: BulkImportResult = {
    inserted,
    updated,
    total: input.rows.length,
    dateRange: { from: minDate, to: maxDate },
  };

  logAudit({
    eventType: "historical.import_summary",
    userId: session.user.id,
    entityType: "historical_daily_summary",
    entityId: null,
    payload: {
      summary: `Import ${input.rows.length} hari (${minDate} → ${maxDate}): ${inserted} baru, ${updated} update`,
      context: {
        ...result,
        sourceLabel: input.sourceLabel,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit historical.import_summary]", e));

  return ok(result);
}

/* -------------------------------------------------------------------------- */
/* HISTORICAL EXPENSE                                                          */
/* -------------------------------------------------------------------------- */

export async function listHistoricalExpenses(
  options: ListHistoricalExpenseOptions = {},
): Promise<ApiResult<HistoricalExpenseRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data historis");
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const filters = [eq(historicalExpense.outletId, session.user.outletId)];
  if (options.from && ISO_DATE_RE.test(options.from)) {
    filters.push(gte(historicalExpense.businessDate, options.from));
  }
  if (options.to && ISO_DATE_RE.test(options.to)) {
    filters.push(lte(historicalExpense.businessDate, options.to));
  }
  if (options.categoryId) {
    filters.push(eq(historicalExpense.categoryId, options.categoryId));
  }
  const rows = await db
    .select({
      id: historicalExpense.id,
      outletId: historicalExpense.outletId,
      businessDate: historicalExpense.businessDate,
      categoryId: historicalExpense.categoryId,
      categoryLabelLegacy: historicalExpense.categoryLabelLegacy,
      amount: historicalExpense.amount,
      description: historicalExpense.description,
      sourceLabel: historicalExpense.sourceLabel,
      /* Sesi AE-62z — sourceRowHash include supaya inferred type match
       * HistoricalExpenseRow (which extends auto-inferred HistoricalExpense). */
      sourceRowHash: historicalExpense.sourceRowHash,
      createdBy: historicalExpense.createdBy,
      createdAt: historicalExpense.createdAt,
      masterCategoryName: expenseCategories.name,
    })
    .from(historicalExpense)
    .leftJoin(
      expenseCategories,
      eq(expenseCategories.id, historicalExpense.categoryId),
    )
    .where(and(...filters))
    .orderBy(desc(historicalExpense.businessDate))
    .limit(limit);

  const out: HistoricalExpenseRow[] = rows.map((r) => ({
    id: r.id,
    outletId: r.outletId,
    businessDate: r.businessDate,
    categoryId: r.categoryId,
    categoryLabelLegacy: r.categoryLabelLegacy,
    amount: r.amount,
    description: r.description,
    sourceLabel: r.sourceLabel,
    sourceRowHash: r.sourceRowHash,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    categoryLabel: r.masterCategoryName ?? r.categoryLabelLegacy,
  }));
  return ok(out);
}

/**
 * Sesi AE-62z — deterministic row hash untuk idempotent CSV re-upload.
 *
 * Canonical input: business_date, category-identity (id atau label trim-lc),
 * amount, description (trim-lc, null → ""). Output: SHA-256 hex truncated
 * 32 chars (collision risk negligible di owner scale).
 *
 * Berbeda row di owner CSV (mis. 2 expense beda description tapi same
 * category+date+amount) → hash beda → insert sukses. Re-upload row sama
 * persis → hash sama → ON CONFLICT DO NOTHING di partial UNIQUE.
 */
function computeHistoricalExpenseRowHash(input: {
  businessDate: string;
  categoryId: string | null | undefined;
  categoryLabelLegacy: string | null | undefined;
  amount: number;
  description: string | null | undefined;
}): string {
  const canonical = [
    input.businessDate,
    /* CategoryId menang kalau ada; else fallback ke label-lc untuk match
     * row dengan category yang tidak ke-link ke master. */
    input.categoryId ?? `legacy:${(input.categoryLabelLegacy ?? "").trim().toLowerCase()}`,
    String(input.amount),
    (input.description ?? "").trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export async function bulkImportHistoricalExpenses(
  input: BulkImportExpenseInput,
): Promise<ApiResult<BulkImportResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.import")) {
    return fail("FORBIDDEN", "Tidak punya hak import data historis");
  }
  if (input.rows.length === 0) {
    return fail("VALIDATION_ERROR", "Tidak ada baris untuk di-import");
  }
  if (input.rows.length > 2000) {
    return fail(
      "VALIDATION_ERROR",
      "Maksimal 2000 baris per import (split jadi beberapa file)",
    );
  }

  // Validate per-row
  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i]!;
    if (!ISO_DATE_RE.test(r.businessDate)) {
      return fail(
        "VALIDATION_ERROR",
        `Baris ${i + 1}: tanggal "${r.businessDate}" tidak valid (YYYY-MM-DD)`,
      );
    }
    if (!Number.isFinite(r.amount) || r.amount <= 0) {
      return fail(
        "VALIDATION_ERROR",
        `Baris ${i + 1}: amount harus > 0`,
      );
    }
  }

  const dates = input.rows.map((r) => r.businessDate);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  /* Sesi AE-62z — compute deterministic hash per row. Use ON CONFLICT DO
   * NOTHING di partial UNIQUE (ux_hist_expense_outlet_row_hash) supaya
   * re-upload skip duplikat. Returning row ids = newly-inserted, sisa =
   * skipped (already existed). Owner UI tampil count inserted vs skipped. */
  const values = input.rows.map((r) => ({
    outletId: session.user.outletId,
    businessDate: r.businessDate,
    categoryId: r.categoryId ?? null,
    categoryLabelLegacy: r.categoryLabelLegacy ?? null,
    amount: r.amount,
    description: r.description ?? null,
    sourceLabel: r.sourceLabel ?? input.sourceLabel,
    sourceRowHash: computeHistoricalExpenseRowHash({
      businessDate: r.businessDate,
      categoryId: r.categoryId ?? null,
      categoryLabelLegacy: r.categoryLabelLegacy ?? null,
      amount: r.amount,
      description: r.description ?? null,
    }),
    createdBy: session.user.id,
  }));
  const insertedRows = await db
    .insert(historicalExpense)
    .values(values)
    .onConflictDoNothing({
      target: [historicalExpense.outletId, historicalExpense.sourceRowHash],
    })
    .returning({ id: historicalExpense.id });
  const skippedCount = input.rows.length - insertedRows.length;

  const result: BulkImportResult = {
    inserted: insertedRows.length,
    updated: 0,
    total: input.rows.length,
    dateRange: { from: minDate, to: maxDate },
  };

  logAudit({
    eventType: "historical.import_expense",
    userId: session.user.id,
    entityType: "historical_expense",
    entityId: null,
    payload: {
      summary:
        skippedCount > 0
          ? `Import ${insertedRows.length} expense (${minDate} → ${maxDate}) · ${skippedCount} skipped (duplicate)`
          : `Import ${insertedRows.length} expense (${minDate} → ${maxDate})`,
      context: {
        ...result,
        skipped: skippedCount,
        sourceLabel: input.sourceLabel,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit historical.import_expense]", e));

  return ok({ ...result, skipped: skippedCount });
}

export async function createHistoricalExpense(
  input: CreateHistoricalExpenseInput,
): Promise<ApiResult<HistoricalExpense>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.import")) {
    return fail("FORBIDDEN", "Tidak punya hak input data historis");
  }
  if (!ISO_DATE_RE.test(input.businessDate)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return fail("VALIDATION_ERROR", "Amount harus > 0");
  }
  /* Sesi AE-62z — compute hash + ON CONFLICT DO NOTHING. Owner click
   * "Tambah Expense" 2x dengan nilai sama → second click return existing
   * (idempotent), no duplicate. */
  const rowHash = computeHistoricalExpenseRowHash({
    businessDate: input.businessDate,
    categoryId: input.categoryId ?? null,
    categoryLabelLegacy: input.categoryLabelLegacy ?? null,
    amount: input.amount,
    description: input.description ?? null,
  });
  const insertedRows = await db
    .insert(historicalExpense)
    .values({
      outletId: session.user.outletId,
      businessDate: input.businessDate,
      categoryId: input.categoryId ?? null,
      categoryLabelLegacy: input.categoryLabelLegacy ?? null,
      amount: input.amount,
      description: input.description ?? null,
      sourceLabel: input.sourceLabel ?? null,
      sourceRowHash: rowHash,
      createdBy: session.user.id,
    })
    .onConflictDoNothing({
      target: [historicalExpense.outletId, historicalExpense.sourceRowHash],
    })
    .returning();
  let created: typeof historicalExpense.$inferSelect;
  if (insertedRows.length > 0) {
    created = insertedRows[0]!;
  } else {
    /* Race / re-submit: row dengan hash sama sudah ada. Return existing
     * supaya UI tetap sukses + show existing detail. */
    const [existing] = await db
      .select()
      .from(historicalExpense)
      .where(
        and(
          eq(historicalExpense.outletId, session.user.outletId),
          eq(historicalExpense.sourceRowHash, rowHash),
        ),
      )
      .limit(1);
    if (!existing) {
      return fail("DB_ERROR", "Gagal insert historical expense");
    }
    created = existing;
  }
  if (!created) return fail("INTERNAL", "Gagal simpan");
  return ok(created);
}

export async function deleteHistoricalExpense(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.update")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus data historis");
  }
  const [existing] = await db
    .select()
    .from(historicalExpense)
    .where(eq(historicalExpense.id, id))
    .limit(1);
  if (!existing) return fail("NOT_FOUND", "Data tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Data dari outlet lain");
  }
  await db.delete(historicalExpense).where(eq(historicalExpense.id, id));

  logAudit({
    eventType: "historical.delete",
    userId: session.user.id,
    entityType: "historical_expense",
    entityId: id,
    payload: {
      summary: `Hapus historis expense ${existing.businessDate} Rp ${existing.amount.toLocaleString("id-ID")}`,
      before: existing,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit historical.delete]", e));

  return ok({ id });
}

/** Aggregate untuk dashboard "Rekonsiliasi": total per kategori dalam range. */
export async function getHistoricalSummaryRange(
  from: string,
  to: string,
): Promise<
  ApiResult<{
    days: number;
    totalGross: number;
    totalNet: number;
    totalCogs: number;
    totalCashFlow: number;
    avgDailyNet: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "historical.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data historis");
  }
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  const [agg] = await db
    .select({
      days: sql<number>`COUNT(*)::int`,
      totalGross: sql<number>`COALESCE(SUM(${historicalDailySummary.grossRevenue}), 0)::bigint`,
      totalNet: sql<number>`COALESCE(SUM(${historicalDailySummary.netRevenue}), 0)::bigint`,
      totalCogs: sql<number>`COALESCE(SUM(${historicalDailySummary.cogs}), 0)::bigint`,
      totalCashFlow: sql<number>`COALESCE(SUM(${historicalDailySummary.cashIn} + ${historicalDailySummary.qrisIn} + ${historicalDailySummary.edcIn} + ${historicalDailySummary.aggregatorIn}), 0)::bigint`,
    })
    .from(historicalDailySummary)
    .where(
      and(
        eq(historicalDailySummary.outletId, session.user.outletId),
        between(historicalDailySummary.businessDate, from, to),
      ),
    );

  const days = agg?.days ?? 0;
  const totalNet = Number(agg?.totalNet ?? 0);
  return ok({
    days,
    totalGross: Number(agg?.totalGross ?? 0),
    totalNet,
    totalCogs: Number(agg?.totalCogs ?? 0),
    totalCashFlow: Number(agg?.totalCashFlow ?? 0),
    avgDailyNet: days > 0 ? Math.round(totalNet / days) : 0,
  });
}
