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
  const rows = await db
    .select({
      session: stockOpnameSessions,
      startedByName: users.name,
    })
    .from(stockOpnameSessions)
    .leftJoin(users, eq(users.id, stockOpnameSessions.startedBy))
    .where(eq(stockOpnameSessions.outletId, outletId))
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

  return rows.map((r) => ({
    ...r.session,
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
    ingredient: r.ingredient,
  }));

  return {
    ...sessionRow.session,
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
    costPerUnit: number;
  }>
> {
  return db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      currentStock: ingredients.currentStock,
      costPerUnit: ingredients.costPerUnit,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outletId),
        eq(ingredients.isActive, true),
        isNull(ingredients.deletedAt),
      ),
    )
    .orderBy(ingredients.name);
}

export async function countSessionLines(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stockOpnameLines)
    .where(eq(stockOpnameLines.sessionId, sessionId));
  return row?.n ?? 0;
}
