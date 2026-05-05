"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shifts, transactions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAndSanitize } from "@/lib/server-error";
import {
  fetchActiveShiftForUser,
  fetchLastClosedShiftForOutlet,
  fetchShiftById,
  fetchShifts,
  type ListShiftsOptions,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type CloseShiftInput,
  type CloseShiftResult,
  type OpenShiftInput,
  type Paginated,
  type Shift,
} from "./types";

const openShiftSchema = z.object({
  openingCash: z.number().int().min(0).max(99_999_999),
});

const moneyOptional = z
  .number()
  .int()
  .min(0)
  .max(99_999_999)
  .nullish()
  .transform((n) => (typeof n === "number" ? n : null));

const closeShiftSchema = z.object({
  shiftId: z.uuid(),
  actualCash: z.number().int().min(0).max(99_999_999),
  notes: z.string().max(500).nullable(),
  handoverMessage: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  edcSettlement: moneyOptional,
  gofoodSettlement: moneyOptional,
  grabfoodSettlement: moneyOptional,
  shopeefoodSettlement: moneyOptional,
  // Phase 2.4 (sesi AB) — setoran ke owner.
  depositAmount: z
    .number()
    .int()
    .min(0)
    .max(99_999_999)
    .nullish()
    .transform((n) => (typeof n === "number" && n > 0 ? n : null)),
  depositBankDestination: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  depositNotes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
});

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function getActiveShift(): Promise<ApiResult<Shift | null>> {
  const session = await requireSession();
  const row = await fetchActiveShiftForUser(session.user.id);
  return ok(row);
}

/** Returns the most recent closed shift at the kasir's outlet. Used by
 * OpenShiftModal to display the handover_message banner. Galih ask #10. */
export async function getLastClosedShiftAtOutlet(): Promise<
  ApiResult<Shift | null>
> {
  const session = await requireSession();
  const row = await fetchLastClosedShiftForOutlet(session.user.outletId);
  return ok(row);
}

export async function getShift(id: string): Promise<ApiResult<Shift>> {
  await requireSession();
  const row = await fetchShiftById(id);
  if (!row) return fail("NOT_FOUND", "Shift tidak ditemukan");
  return ok(row);
}

export async function listShifts(
  opts: ListShiftsOptions = {},
): Promise<ApiResult<Paginated<Shift>>> {
  const session = await requireSession();
  // RBAC: shift.view_all for owner/manager; staff only their own
  const canViewAll = hasPermission(session.user.role, "shift.view_all");
  const finalOpts = canViewAll ? opts : { ...opts, userId: session.user.id };
  return ok(await fetchShifts(finalOpts));
}

export async function openShift(
  input: OpenShiftInput,
): Promise<ApiResult<Shift>> {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "shift.open_own")) {
    return fail("FORBIDDEN", "Tidak punya hak buka shift");
  }

  const parsed = openShiftSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }

  // Pre-check active shift; the partial unique index ux_shifts_user_active
  // is the hard guarantee, but pre-check gives nicer error than 23505.
  const existing = await fetchActiveShiftForUser(session.user.id);
  if (existing) {
    return fail("ALREADY_OPEN", "Kamu masih punya shift aktif");
  }

  try {
    const [row] = await db
      .insert(shifts)
      .values({
        outletId: session.user.outletId,
        userId: session.user.id,
        status: "open",
        openingCash: parsed.data.openingCash,
      })
      .returning();
    return ok(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    if (/ux_shifts_user_active|unique/i.test(msg)) {
      return fail("ALREADY_OPEN", "Kamu masih punya shift aktif");
    }
    return fail("DB_ERROR", logAndSanitize(e, "shifts", "Operasi database gagal"));
  }
}

export async function closeShift(
  input: CloseShiftInput,
): Promise<ApiResult<CloseShiftResult>> {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "shift.close_own")) {
    return fail("FORBIDDEN", "Tidak punya hak tutup shift");
  }

  const parsed = closeShiftSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const current = await fetchShiftById(v.shiftId);
  if (!current) return fail("NOT_FOUND", "Shift tidak ditemukan");
  if (current.userId !== session.user.id) {
    return fail("NOT_OWNER_OF_SHIFT", "Kamu tidak bisa tutup shift orang lain");
  }
  if (current.status === "closed") {
    return fail("ALREADY_CLOSED", "Shift sudah tutup");
  }

  // Phase 2.1 guard — block close if any open bills (status="open") still
  // belong to this shift. Kasir must finish/void/refund them first; closing
  // mid-bill orphans the bill from a closed shift and breaks reconciliation.
  const openBillRows = await db
    .select({
      transactionNumber: transactions.transactionNumber,
      pagerNumber: transactions.pagerNumber,
      total: transactions.total,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.shiftId, current.id),
        eq(transactions.status, "open"),
      ),
    );
  if (openBillRows.length > 0) {
    const list = openBillRows
      .map((b) =>
        b.pagerNumber
          ? `${b.transactionNumber} (pager ${b.pagerNumber})`
          : b.transactionNumber,
      )
      .join(", ");
    return fail(
      "OPEN_BILLS_EXIST",
      `Ada ${openBillRows.length} bill belum dibayar di shift ini: ${list}. Selesaikan atau batalkan dulu sebelum tutup shift.`,
    );
  }

  // Aggregate transactions in this shift
  const txns = await db
    .select({
      status: transactions.status,
      paymentMethod: transactions.paymentMethod,
      total: transactions.total,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, current.id));

  let paidCount = 0;
  let paidCash = 0;
  let paidQris = 0;
  let paidCard = 0;
  let voidedCount = 0;
  let voidedAmount = 0;
  let refundedCount = 0;
  let refundedAmount = 0;
  let refundedCash = 0;

  for (const t of txns) {
    if (t.status === "paid") {
      paidCount += 1;
      if (t.paymentMethod === "cash") paidCash += t.total;
      else if (t.paymentMethod === "qris") paidQris += t.total;
      else paidCard += t.total;
    } else if (t.status === "voided") {
      voidedCount += 1;
      voidedAmount += t.total;
    } else if (t.status === "refunded") {
      refundedCount += 1;
      refundedAmount += t.total;
      if (t.paymentMethod === "cash") refundedCash += t.total;
    }
  }

  const expectedCash = current.openingCash + paidCash - refundedCash;
  const variance = v.actualCash - expectedCash;

  const [updated] = await db
    .update(shifts)
    .set({
      status: "closed",
      actualCash: v.actualCash,
      variance,
      notes: v.notes,
      handoverMessage: v.handoverMessage,
      edcSettlement: v.edcSettlement,
      gofoodSettlement: v.gofoodSettlement,
      grabfoodSettlement: v.grabfoodSettlement,
      shopeefoodSettlement: v.shopeefoodSettlement,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shifts.id, current.id))
    .returning();

  // Sesi T — Accounting auto-journal hook (shift variance ≠ 0).
  if (variance !== 0) {
    const { fireJournalHook, postJournalForShiftVariance } = await import(
      "@/features/accounting/hooks"
    );
    const closedDate = updated.closedAt
      ? new Date(updated.closedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    fireJournalHook(
      () =>
        postJournalForShiftVariance({
          outletId: session.user.outletId,
          shiftId: updated.id,
          shiftLabel: `Shift ${updated.id.slice(0, 8)}`,
          variance,
          entryDate: closedDate,
          actorId: session.user.id,
        }),
      "shift_variance",
    );
  }

  // Phase 2.4 (sesi AB) — auto-create pending cash_deposit kalau kasir
  // input setoran ke owner. Owner verify nanti di Admin → Setoran Tunai.
  // Best-effort: kalau gagal, log warning tapi shift close tetap success.
  let autoDepositId: string | null = null;
  if (v.depositAmount && v.depositAmount > 0) {
    try {
      const { createCashDeposit } = await import("@/features/finance/actions");
      const isoDate = (d: Date | string | null | undefined): string => {
        if (!d) return new Date().toISOString().slice(0, 10);
        const dt = typeof d === "string" ? new Date(d) : d;
        return dt.toISOString().slice(0, 10);
      };
      const closedDate = isoDate(updated.closedAt);
      const openedDate = isoDate(current.openedAt);
      const depRes = await createCashDeposit({
        depositDate: closedDate,
        amount: v.depositAmount,
        bankDestination: v.depositBankDestination ?? "Owner Tunai",
        referenceNo: `SHIFT-${updated.id.slice(0, 8)}`,
        notes: v.depositNotes,
        coversFromDate: openedDate,
        coversToDate: closedDate,
      });
      if (depRes.ok) {
        autoDepositId = depRes.data.id;
      } else {
        console.warn("[closeShift auto-deposit failed]", depRes.error);
      }
    } catch (e) {
      console.warn("[closeShift auto-deposit threw]", e);
    }
  }

  return ok({
    shift: updated,
    summary: {
      transactionCount: txns.length,
      paid: { count: paidCount, cash: paidCash, qris: paidQris, cardBca: paidCard },
      voided: { count: voidedCount, totalAmount: voidedAmount },
      refunded: { count: refundedCount, totalAmount: refundedAmount },
      expectedCash,
      depositId: autoDepositId,
    },
  });
}
