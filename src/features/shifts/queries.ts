import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import type { Paginated, Shift, ShiftStatus } from "./types";

export async function fetchActiveShiftForUser(
  userId: string,
): Promise<Shift | null> {
  const [row] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, userId), eq(shifts.status, "open")))
    .limit(1);
  return row ?? null;
}

export interface ListShiftsOptions {
  userId?: string;
  from?: string;
  to?: string;
  status?: ShiftStatus;
  limit?: number;
}

export async function fetchShifts(
  opts: ListShiftsOptions = {},
): Promise<Paginated<Shift>> {
  const limit = opts.limit ?? 50;
  const conds = [];
  if (opts.userId) conds.push(eq(shifts.userId, opts.userId));
  if (opts.status) conds.push(eq(shifts.status, opts.status));
  if (opts.from) conds.push(gte(shifts.openedAt, new Date(opts.from)));
  if (opts.to) conds.push(lte(shifts.openedAt, new Date(opts.to)));

  const rows = await db
    .select()
    .from(shifts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(shifts.openedAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    total: rows.length,
    hasMore,
  };
}

export async function fetchShiftById(id: string): Promise<Shift | null> {
  const [row] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1);
  return row ?? null;
}

/** Most recently closed shift at this outlet — surfaced to the next
 * kasir's OpenShiftModal so any handover_message they left is shown as
 * a banner before step 1. Returns null when no prior closed shift
 * exists at the outlet. Galih ask #10. */
export async function fetchLastClosedShiftForOutlet(
  outletId: string,
): Promise<Shift | null> {
  const [row] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.outletId, outletId), eq(shifts.status, "closed")))
    .orderBy(desc(shifts.closedAt))
    .limit(1);
  return row ?? null;
}
