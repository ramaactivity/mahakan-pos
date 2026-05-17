import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { shifts, transactions } from "@/db/schema";
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
  const items = hasMore ? rows.slice(0, limit) : rows;

  // Sesi AE-62f — derive QRIS live untuk closed shifts dengan
  // qris_settlement IS NULL (legacy pre-AE56). Tanpa fallback, kolom QRIS
  // di Shift History tampil "—" untuk shift lama padahal real sales ada
  // di transactions table. Sum qris paid transactions per shift dalam
  // single batched query.
  const needsQrisDerive = items
    .filter((s) => s.status === "closed" && s.qrisSettlement === null)
    .map((s) => s.id);
  if (needsQrisDerive.length > 0) {
    const derived = await db
      .select({
        shiftId: transactions.shiftId,
        total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.paymentMethod, "qris"),
          eq(transactions.status, "paid"),
          inArray(transactions.shiftId, needsQrisDerive),
        ),
      )
      .groupBy(transactions.shiftId);
    const qrisByShift = new Map<string, number>();
    for (const r of derived) {
      if (r.shiftId) qrisByShift.set(r.shiftId, Number(r.total));
    }
    for (const s of items) {
      if (s.status === "closed" && s.qrisSettlement === null) {
        s.qrisSettlement = qrisByShift.get(s.id) ?? 0;
      }
    }
  }

  return {
    items,
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
