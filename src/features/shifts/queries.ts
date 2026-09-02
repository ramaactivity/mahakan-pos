import "server-only";
import { and, desc, eq, getTableColumns, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, incomes, shifts, transactions, users } from "@/db/schema";
import { toJakartaDateOnly } from "@/lib/date";
import type {
  Paginated,
  Shift,
  ShiftStatus,
  ShiftWithOpener,
} from "./types";
import {
  expenseAffectsDrawer,
  incomeAffectsDrawer,
} from "@/features/cash/drawer-origin";

/**
 * Sesi AE-63 phase10 — Active shift di-resolve OUTLET-SCOPED (bukan
 * per-user). Workflow Mahakan: 1 shift active per outlet, multi-user
 * (kasir + owner + manager) sharing. Pre-fix `fetchActiveShiftForUser`
 * filter userId → owner di laptop ga lihat shift staff yang buka di
 * tablet. Migration 0059 added partial unique `(outletId) WHERE
 * status='open'` → DB sekarang juga enforce 1-per-outlet.
 *
 * Caller `getActiveShift` action pakai session.user.outletId.
 */
export async function fetchActiveShiftForOutlet(
  outletId: string,
): Promise<ShiftWithOpener | null> {
  const [row] = await db
    .select({
      ...getTableColumns(shifts),
      openedByName: users.name,
      openedByRole: users.role,
    })
    .from(shifts)
    .leftJoin(users, eq(users.id, shifts.userId))
    .where(and(eq(shifts.outletId, outletId), eq(shifts.status, "open")))
    .limit(1);
  return row ?? null;
}

/** @deprecated Use fetchActiveShiftForOutlet. Kept for tests yang specifically
 * test per-user scoping (rare). */
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

/**
 * Sesi AE-64 — Petty cash breakdown per-shift untuk display formula
 * variance lengkap di UI. Mirror filter logic di `closeShift`:
 *   - outletId scope
 *   - paymentMethod='cash' (transfer/other tidak affect laci)
 *   - range = WIB date dari shift.openedAt sampai shift.closedAt (atau today
 *     kalau still open)
 *   - deletedAt IS NULL
 *
 * Hasil sum konsisten dengan computeExpectedCash di server, sehingga
 * UI display formula sama dengan variance yang sudah ke-persist di DB.
 */
export interface ShiftPettyBreakdown {
  pettyExpenseCash: number;
  pettyExpenseCashCount: number;
  pettyIncomeCash: number;
  pettyIncomeCashCount: number;
}

export async function fetchShiftPettyBreakdown(
  shift: Pick<Shift, "id" | "outletId" | "openedAt" | "closedAt">,
): Promise<ShiftPettyBreakdown> {
  const fromDate = toJakartaDateOnly(shift.openedAt);
  const toDate = toJakartaDateOnly(shift.closedAt ?? new Date());

  const expenseRows = await db
    .select({ amount: expenses.amount })
    .from(expenses)
    .where(
      and(
        eq(expenses.outletId, shift.outletId),
        eq(expenses.paymentMethod, "cash"),
        /* Sesi AE-227 — cermin filter closeShift; kalau beda, rincian yang
         * ditampilkan tidak akan menjumlah ke variance yang ter-persist. */
        expenseAffectsDrawer(),
        gte(expenses.expenseDate, fromDate),
        lte(expenses.expenseDate, toDate),
        isNull(expenses.deletedAt),
      ),
    );
  const incomeRows = await db
    .select({ amount: incomes.amount })
    .from(incomes)
    .where(
      and(
        eq(incomes.outletId, shift.outletId),
        eq(incomes.paymentMethod, "cash"),
        incomeAffectsDrawer(),
        gte(incomes.incomeDate, fromDate),
        lte(incomes.incomeDate, toDate),
        isNull(incomes.deletedAt),
      ),
    );

  return {
    pettyExpenseCash: expenseRows.reduce((s, r) => s + Number(r.amount), 0),
    pettyExpenseCashCount: expenseRows.length,
    pettyIncomeCash: incomeRows.reduce((s, r) => s + Number(r.amount), 0),
    pettyIncomeCashCount: incomeRows.length,
  };
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
