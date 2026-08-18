import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  stockOpnameLines,
  stockOpnameSessions,
  users,
} from "@/db/schema";
import { jakartaMonthKey, jakartaMonthLabel } from "./cadence";
import { computeStockValue } from "./stock-value";
import {
  cutoffStartInstant,
  getOpnameCutoffDate,
} from "@/features/cutoff/cutoff";
import type {
  MonthlyCadenceStatus,
  OpnameLineWithIngredient,
  OpnameSession,
  OpnameSessionDetail,
  OpnameSessionWithCounts,
} from "./types";

export async function fetchActiveSession(
  outletId: string,
): Promise<OpnameSession | null> {
  const [row] = await db
    .select()
    .from(stockOpnameSessions)
    .where(
      and(
        eq(stockOpnameSessions.outletId, outletId),
        inArray(stockOpnameSessions.status, [
          "in_progress",
          "pending_review",
        ]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function fetchSessions(
  outletId: string,
  opts: { limit?: number } = {},
): Promise<OpnameSessionWithCounts[]> {
  const limit = Math.min(opts.limit ?? 30, 200);
  /* Sesi AE-207 — daftar opname ikut batas buku, tapi pakai `opnameDate` yang
   * SENGAJA lebih tua dari batas utama: sesi yang dihitung akhir bulan
   * sebelum cutoff adalah STOK AWAL periode baru dan wajib tetap terlihat.
   * Lihat features/cutoff/cutoff.ts. */
  const cutoffAt = cutoffStartInstant(await getOpnameCutoffDate(outletId));
  const conds = [eq(stockOpnameSessions.outletId, outletId)];
  if (cutoffAt) conds.push(gte(stockOpnameSessions.startedAt, cutoffAt));
  const rows = await db
    .select({
      session: stockOpnameSessions,
      startedByName: users.name,
    })
    .from(stockOpnameSessions)
    .leftJoin(users, eq(users.id, stockOpnameSessions.startedBy))
    .where(and(...conds))
    .orderBy(desc(stockOpnameSessions.startedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Resolve other actor names in a single follow-up query.
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.session.submittedBy) userIds.add(r.session.submittedBy);
    if (r.session.finalizedBy) userIds.add(r.session.finalizedBy);
    if (r.session.cancelledBy) userIds.add(r.session.cancelledBy);
  }
  const nameById = new Map<string, string>();
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));
    for (const u of userRows) nameById.set(u.id, u.name);
  }

  /* Sesi AE-210 — nilai rupiah stok per sesi (Σ qty aktual × unit cost beku).
   * Dijumlah di SQL, bukan dengan menarik semua baris: 30 sesi × ~160 bahan
   * = ribuan baris yang tidak dipakai untuk apa pun di layar daftar.
   * COALESCE ke decimal dulu — bigint-nya di-clamp 0 oleh check constraint. */
  const valueBySession = new Map<string, number>();
  const valueRows = await db
    .select({
      sessionId: stockOpnameLines.sessionId,
      value: sql<string>`COALESCE(SUM(
        COALESCE(
          ${stockOpnameLines.actualQtyDecimal},
          ${stockOpnameLines.actualQty}::numeric,
          0
        ) * ${stockOpnameLines.unitCostAtSnapshot}
      ), 0)`,
    })
    .from(stockOpnameLines)
    .where(
      inArray(
        stockOpnameLines.sessionId,
        rows.map((r) => r.session.id),
      ),
    )
    .groupBy(stockOpnameLines.sessionId);
  for (const v of valueRows) {
    const n = Number(v.value);
    valueBySession.set(v.sessionId, Number.isFinite(n) ? n : 0);
  }

  return rows.map((r) => ({
    ...r.session,
    stockValue: valueBySession.get(r.session.id) ?? 0,
    startedByName: r.startedByName,
    submittedByName: r.session.submittedBy
      ? nameById.get(r.session.submittedBy) ?? null
      : null,
    finalizedByName: r.session.finalizedBy
      ? nameById.get(r.session.finalizedBy) ?? null
      : null,
    cancelledByName: r.session.cancelledBy
      ? nameById.get(r.session.cancelledBy) ?? null
      : null,
  }));
}

export async function fetchSessionDetail(
  sessionId: string,
  outletId: string,
): Promise<OpnameSessionDetail | null> {
  const [sessionRow] = await db
    .select({
      session: stockOpnameSessions,
      startedByName: users.name,
    })
    .from(stockOpnameSessions)
    .leftJoin(users, eq(users.id, stockOpnameSessions.startedBy))
    .where(
      and(
        eq(stockOpnameSessions.id, sessionId),
        eq(stockOpnameSessions.outletId, outletId),
      ),
    )
    .limit(1);
  if (!sessionRow) return null;

  // Resolve other actor names.
  const userIds = new Set<string>();
  if (sessionRow.session.submittedBy)
    userIds.add(sessionRow.session.submittedBy);
  if (sessionRow.session.finalizedBy)
    userIds.add(sessionRow.session.finalizedBy);
  if (sessionRow.session.cancelledBy)
    userIds.add(sessionRow.session.cancelledBy);
  const nameById = new Map<string, string>();
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));
    for (const u of userRows) nameById.set(u.id, u.name);
  }

  const lineRows = await db
    .select({
      line: stockOpnameLines,
      ingredient: {
        id: ingredients.id,
        name: ingredients.name,
        unit: ingredients.unit,
        isActive: ingredients.isActive,
        deletedAt: ingredients.deletedAt,
        section: ingredients.section,
        /* Sesi AE-62y — pack conversions diteruskan ke UI untuk picker. */
        packConversions: ingredients.packConversions,
        /* Sesi AE-130 — multi-unit tier (Anisa feedback). Opname mobile
         * pakai untuk picker + tracking preview. */
        unitTracking: ingredients.unitTracking,
        unitTrackingPerCogs: ingredients.unitTrackingPerCogs,
        unitBelanja: ingredients.unitBelanja,
        unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
      },
    })
    .from(stockOpnameLines)
    .innerJoin(
      ingredients,
      eq(ingredients.id, stockOpnameLines.ingredientId),
    )
    .where(eq(stockOpnameLines.sessionId, sessionId))
    .orderBy(ingredients.section, ingredients.name);

  const lines: OpnameLineWithIngredient[] = lineRows.map((r) => ({
    ...r.line,
    ingredient: {
      ...r.ingredient,
      /* Cast jsonb to typed array. Null = no alternatives. */
      packConversions: (r.ingredient.packConversions as
        | Array<{ unitLabel: string; qtyPerBase: number }>
        | null) ?? null,
    },
  }));

  return {
    ...sessionRow.session,
    /* Sesi AE-210 — dihitung dari baris yang sudah ada di tangan, pakai
     * pemetaan section→akun yang sama dengan jurnal opname. */
    stockValue: computeStockValue(
      lines.map((l) => ({
        actualQty: l.actualQty,
        actualQtyDecimal: l.actualQtyDecimal,
        unitCostAtSnapshot: l.unitCostAtSnapshot,
        section: l.ingredient.section,
      })),
    ).total,
    startedByName: sessionRow.startedByName,
    submittedByName: sessionRow.session.submittedBy
      ? nameById.get(sessionRow.session.submittedBy) ?? null
      : null,
    finalizedByName: sessionRow.session.finalizedBy
      ? nameById.get(sessionRow.session.finalizedBy) ?? null
      : null,
    cancelledByName: sessionRow.session.cancelledBy
      ? nameById.get(sessionRow.session.cancelledBy) ?? null
      : null,
    lines,
  };
}

export async function fetchMonthlyCadenceStatus(
  outletId: string,
  now: Date,
): Promise<MonthlyCadenceStatus> {
  const monthKey = jakartaMonthKey(now);
  const monthLabel = jakartaMonthLabel(now);
  const monthStart = monthStartUtc(monthKey);

  const [active] = await db
    .select({
      id: stockOpnameSessions.id,
      status: stockOpnameSessions.status,
    })
    .from(stockOpnameSessions)
    .where(
      and(
        eq(stockOpnameSessions.outletId, outletId),
        inArray(stockOpnameSessions.status, [
          "in_progress",
          "pending_review",
        ]),
      ),
    )
    .limit(1);

  const [completedThisMonthRow] = await db
    .select({ id: stockOpnameSessions.id })
    .from(stockOpnameSessions)
    .where(
      and(
        eq(stockOpnameSessions.outletId, outletId),
        eq(stockOpnameSessions.status, "completed"),
        gte(stockOpnameSessions.finalizedAt, monthStart),
      ),
    )
    .limit(1);

  const [lastCompleted] = await db
    .select({
      finalizedAt: stockOpnameSessions.finalizedAt,
      periodLabel: stockOpnameSessions.periodLabel,
    })
    .from(stockOpnameSessions)
    .where(
      and(
        eq(stockOpnameSessions.outletId, outletId),
        eq(stockOpnameSessions.status, "completed"),
      ),
    )
    .orderBy(desc(stockOpnameSessions.finalizedAt))
    .limit(1);

  return {
    currentMonthKey: monthKey,
    currentMonthLabel: monthLabel,
    activeSessionId: active?.id ?? null,
    activeStatus: active?.status ?? null,
    hasCompletedThisMonth: Boolean(completedThisMonthRow),
    lastCompletedAt: lastCompleted?.finalizedAt ?? null,
    lastCompletedPeriodLabel: lastCompleted?.periodLabel ?? null,
  };
}

/** YYYY-MM key → first instant of that month in Asia/Jakarta, returned
 * as a Date (UTC absolute). Cheap impl: WIB is UTC+7 with no DST. */
function monthStartUtc(monthKey: string): Date {
  const [y, m] = monthKey.split("-").map((s) => parseInt(s, 10));
  // 00:00 WIB = 17:00 UTC of the previous day
  const utc = Date.UTC(y, m - 1, 1, -7, 0, 0);
  return new Date(utc);
}

export async function fetchActiveIngredientsForSnapshot(
  outletId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    unit: string;
    currentStock: number;
    currentStockDecimal: string | null;
    costPerUnit: number;
  }>
> {
  return db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      currentStock: ingredients.currentStock,
      currentStockDecimal: ingredients.currentStockDecimal,
      costPerUnit: ingredients.costPerUnit,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outletId),
        eq(ingredients.isActive, true),
        isNull(ingredients.deletedAt),
        /* Sesi AE-176 — preparation (Prep - X) dibuat in-house dari resep,
         * bukan bahan yang dihitung fisik. Owner: keluarkan dari stock opname
         * supaya tidak double-count (bahan baku-nya sudah dihitung terpisah). */
        eq(ingredients.isPreparation, false),
      ),
    )
    .orderBy(ingredients.name);
}

/**
 * Sesi AE-130 — Last finalized opname per outlet (Anisa anti-double-count).
 *
 * Dipakai oleh purchase flow untuk detect backdated entry: kalau purchase
 * date < lastFinalizedAt date, staff sudah hitung fisik termasuk belanja
 * tsb, jadi add lagi via Catat Pembelian = double-count.
 *
 * Returns null kalau outlet belum pernah punya opname finalized
 * (fresh setup; backdate logic dormant sampai baseline pertama dibuat).
 */
export async function fetchLastFinalizedOpname(
  outletId: string,
): Promise<{
  sessionId: string;
  finalizedAt: Date;
  periodLabel: string;
} | null> {
  const [row] = await db
    .select({
      sessionId: stockOpnameSessions.id,
      finalizedAt: stockOpnameSessions.finalizedAt,
      periodLabel: stockOpnameSessions.periodLabel,
    })
    .from(stockOpnameSessions)
    .where(
      and(
        eq(stockOpnameSessions.outletId, outletId),
        eq(stockOpnameSessions.status, "completed"),
      ),
    )
    .orderBy(desc(stockOpnameSessions.finalizedAt))
    .limit(1);
  if (!row || !row.finalizedAt) return null;
  return {
    sessionId: row.sessionId,
    finalizedAt: row.finalizedAt,
    periodLabel: row.periodLabel,
  };
}

export async function countSessionLines(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stockOpnameLines)
    .where(eq(stockOpnameLines.sessionId, sessionId));
  return row?.n ?? 0;
}
