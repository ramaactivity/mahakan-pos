"use server";

import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses, incomes, shifts, transactions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAndSanitize } from "@/lib/server-error";
import { todayWibRangeUtc, toJakartaDateOnly } from "@/lib/date";
import {
  fetchActiveShiftForOutlet,
  fetchActiveShiftForUser,
  fetchLastClosedShiftForOutlet,
  fetchShiftById,
  fetchShifts,
  type ListShiftsOptions,
} from "./queries";
import {
  computeExpectedCash,
  computeShiftCashSummary,
} from "./close-pure";
import {
  fail,
  ok,
  type ApiResult,
  type CloseShiftInput,
  type CloseShiftResult,
  type OpenShiftInput,
  type Paginated,
  type Shift,
  type ShiftWithOpener,
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
  /* Sesi AE-62n — qrisSettlement: kasir input fisik dari HP/app QRIS
   * sebagai double-check. Sebelumnya server auto-fill dari paidQris
   * (AE-56). Sekarang owner mau kasir input manual untuk verify
   * balance. Backward compat: kalau null → fallback ke paidQris. */
  qrisSettlement: moneyOptional,
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

/**
 * Sesi AE-63 phase10 — Return active shift di OUTLET (bukan per-user).
 * Workflow Mahakan: 1 shift per outlet, multi-user share. Owner di laptop
 * akan SEE shift yang staff buka di tablet (kasir-shift jadi single source
 * of truth untuk POS transactions).
 *
 * Pre-fix `fetchActiveShiftForUser(session.user.id)` bikin owner ga lihat
 * shift staff → ShiftPanel render "Buka Shift" walau shift sudah jalan
 * (contradict dengan CashOnHandTile yang udah outlet-scoped).
 */
export async function getActiveShift(): Promise<
  ApiResult<ShiftWithOpener | null>
> {
  const session = await requireSession();
  const row = await fetchActiveShiftForOutlet(session.user.outletId);
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

  /* Sesi AE-63 phase10 — Pre-check OUTLET active shift (any user). Schema
   * partial unique index ux_shifts_outlet_active is hard guarantee, but
   * pre-check gives friendly error daripada 23505 (duplicate key).
   *
   * Workflow Mahakan: 1 shift per outlet. Kalau staff sudah buka, owner/
   * manager TIDAK perlu buka shift sendiri — share shift yang sama. */
  const existing = await fetchActiveShiftForOutlet(session.user.outletId);
  if (existing) {
    /* Different user opened? Show info. Same user? Standard already-open msg. */
    if (existing.userId !== session.user.id) {
      return fail(
        "ALREADY_OPEN_BY_OTHER",
        "Shift outlet sudah dibuka oleh user lain. Lanjut transaksi pakai shift itu, atau tutup dulu kalau perlu reset.",
      );
    }
    return fail("ALREADY_OPEN", "Kamu masih punya shift aktif");
  }

  // Sesi AE-32 — daily lock: 1 user cuma boleh 1 shift per hari (WIB).
  // Owner request supaya audit trail bersih + cegah duplikat shift dalam
  // sehari (mis. close → open lagi → forensic tax/payroll jadi rumit).
  // Cek shift apapun (open atau closed) yang dibuka di WIB hari ini.
  const wibToday = toJakartaDateOnly(new Date());
  const { from, to } = todayWibRangeUtc();
  const todayShifts = await db
    .select({ id: shifts.id, status: shifts.status })
    .from(shifts)
    .where(
      and(
        eq(shifts.userId, session.user.id),
        gte(shifts.openedAt, new Date(from)),
        lte(shifts.openedAt, new Date(to)),
      ),
    )
    .limit(1);
  if (todayShifts.length > 0) {
    return fail(
      "DAILY_LIMIT",
      `Shift hari ini (${wibToday}) sudah pernah dibuka. Hanya 1× shift per hari per user.`,
    );
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
    if (/ux_shifts_outlet_active|ux_shifts_user_active|unique/i.test(msg)) {
      return fail("ALREADY_OPEN", "Shift outlet sudah aktif");
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
  /* Sesi AE-63 phase10 — outlet scope check + supervisor close.
   * Workflow Mahakan: 1 shift per outlet, shared. Staff close shift sendiri
   * normal; tapi owner/manager juga boleh close (supervise/handle edge case
   * staff lupa close, urgensi handover, dll). */
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Shift dari outlet lain");
  }
  const canCloseAny = hasPermission(session.user.role, "shift.close_any");
  if (current.userId !== session.user.id && !canCloseAny) {
    return fail(
      "NOT_OWNER_OF_SHIFT",
      "Kamu tidak bisa tutup shift orang lain. Hubungi owner/manager.",
    );
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

  // Aggregate transactions in this shift via pure helper (sesi AE-44).
  // refundedAmount column wajib di-select supaya partial refund bisa
  // di-deduct presisi (bukan over-deduct pakai total).
  const txns = await db
    .select({
      status: transactions.status,
      paymentMethod: transactions.paymentMethod,
      total: transactions.total,
      refundedAmount: transactions.refundedAmount,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, current.id));

  /* Sesi AE-49 — fetch petty cash expense + income yang affect kas drawer
   * fisik. Filter:
   *   - outletId = session outlet
   *   - paymentMethod = 'cash' (transfer/other tidak affect laci kasir)
   *   - deletedAt IS NULL
   *   - date dalam range shift (open → close). Pakai expenseDate per WIB.
   *     Untuk handle overnight shift, range = WIB date of shift.openedAt
   *     sampai WIB date of close (= today saat tutup).
   *
   * Sum di server (bukan trust client) — single source of truth supaya
   * tidak bisa di-bypass dari client. */
  const shiftStartDate = toJakartaDateOnly(current.openedAt);
  const todayDate = toJakartaDateOnly(new Date());

  const pettyExpenseRows = await db
    .select({ amount: expenses.amount })
    .from(expenses)
    .where(
      and(
        eq(expenses.outletId, current.outletId),
        eq(expenses.paymentMethod, "cash"),
        gte(expenses.expenseDate, shiftStartDate),
        lte(expenses.expenseDate, todayDate),
        isNull(expenses.deletedAt),
      ),
    );
  const pettyExpenseCash = pettyExpenseRows.reduce((s, r) => s + r.amount, 0);

  const pettyIncomeRows = await db
    .select({ amount: incomes.amount })
    .from(incomes)
    .where(
      and(
        eq(incomes.outletId, current.outletId),
        eq(incomes.paymentMethod, "cash"),
        gte(incomes.incomeDate, shiftStartDate),
        lte(incomes.incomeDate, todayDate),
        isNull(incomes.deletedAt),
      ),
    );
  const pettyIncomeCash = pettyIncomeRows.reduce((s, r) => s + r.amount, 0);

  const cashSummary = computeShiftCashSummary(txns, {
    expenseCash: pettyExpenseCash,
    incomeCash: pettyIncomeCash,
  });
  // refundedCash dipakai di computeExpectedCash internal — destructure
  // di sini cuma untuk audit log + response. Skip refundedCash di destructure.
  const {
    paidCount,
    paidCash,
    paidQris,
    paidCard,
    voidedCount,
    voidedAmount,
    refundedCount,
    refundedAmount,
  } = cashSummary;

  // Sesi AE-49 — pakai helper terpadu supaya formula konsisten di
  // server + UI preview. Kas Harusnya sekarang include petty cash.
  const expectedCash = computeExpectedCash(current.openingCash, cashSummary);
  const variance = v.actualCash - expectedCash;

  /* Sesi AE-56 — auto-fill qrisSettlement dari sum paidQris.
   * Sesi AE-62n — kalau kasir input manual (UI baru: balance verification),
   * prefer kasir input untuk audit trail. Backward compat: fallback ke
   * paidQris kalau kasir tidak input (legacy client / API caller). */
  const qrisSettlement = v.qrisSettlement ?? paidQris;

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
      qrisSettlement,
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
  // Sesi AE-62h — kalau gagal, surface error ke kasir supaya tidak silent.
  let autoDepositId: string | null = null;
  let autoDepositError: { code: string; message: string } | null = null;
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
        autoDepositError = {
          code: depRes.error.code,
          message: depRes.error.message,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Internal error";
      console.warn("[closeShift auto-deposit threw]", e);
      autoDepositError = { code: "INTERNAL", message: msg };
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
      // Sesi AE-49 — expose petty cash di response supaya UI bisa
      // verifikasi & owner punya audit trail jelas.
      pettyExpenseCash,
      pettyIncomeCash,
      depositId: autoDepositId,
      depositError: autoDepositError,
    },
  });
}
