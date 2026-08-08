"use server";

import { and, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  approvalCodes,
  expenses,
  incomes,
  outlets,
  shiftRebalances,
  shifts,
  splitPayments,
  transactionCorrections,
  transactions,
} from "@/db/schema";
import type { OutletSettings } from "@/db/schema/outlets";
import { pendingEntryChanges } from "@/db/schema/pending_entry_changes";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { consumeApproverToken } from "@/lib/auth/approver";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { todayWibRangeUtc, toJakartaDateOnly } from "@/lib/date";
import {
  fetchActiveShiftForOutlet,
  fetchActiveShiftForUser,
  fetchLastClosedShiftForOutlet,
  fetchShiftById,
  fetchShiftPettyBreakdown,
  fetchShifts,
  type ListShiftsOptions,
  type ShiftPettyBreakdown,
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

/**
 * Sesi AE-64 — Petty cash breakdown per-shift, dipakai UI ShiftDetailModal
 * + ShiftRebalanceModal untuk display formula variance lengkap (Kas
 * Awal + Penjualan Tunai - Pengeluaran Tunai + Pemasukan Tunai).
 *
 * Server side single source of truth — mirror filter di closeShift
 * (paymentMethod='cash' + WIB date range shift open→close).
 */
export async function getShiftPettyBreakdown(
  shiftId: string,
): Promise<ApiResult<ShiftPettyBreakdown>> {
  const session = await requireSession();
  const row = await fetchShiftById(shiftId);
  if (!row) return fail("NOT_FOUND", "Shift tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Shift bukan outlet kamu");
  }
  return ok(await fetchShiftPettyBreakdown(row));
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
    /* Audit POS E2E 2026-06-12 — buka shift dulu satu-satunya aksi shift
     * tanpa jejak audit eksplisit (tutup/koreksi/rebalance sudah ada). */
    logAudit({
      eventType: "shift.open",
      userId: session.user.id,
      entityType: "shift",
      entityId: row.id,
      payload: {
        summary: `Buka shift — kas awal ${parsed.data.openingCash.toLocaleString("id-ID")}`,
        after: { openingCash: parsed.data.openingCash },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit shift.open]", e));
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
  /* Sesi AE-63 phase10 / AE-166 — outlet scope check.
   * Workflow Mahakan: 1 register/shift per outlet, SHARED. Siapa pun staff
   * di outlet yang sama boleh menutup shift aktif walau dibuka kolega
   * (handover: mis. manager buka pagi, staff nutup malam). close_own sudah
   * dicek di atas; outlet scope dicek di sini; penutup ter-audit (actorId
   * di logAudit). Owner/manager tetap bisa via close_any lintas-skenario. */
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Shift dari outlet lain");
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

  /* Sesi AE-160c — BLOCK close kalau ada pending approval.
   *
   * Reason: sebelumnya shift bisa ditutup walaupun ada void/refund/koreksi/
   * rebalance/edit-catatan pending. Akibatnya:
   *   - expected_cash dihitung dengan status trx "paid" (void belum apply)
   *   - kode masih bisa di-consume setelah shift tutup (tidak ada cek)
   *   - status berubah `voided` setelah close → drift expected vs aktual
   *   - audit trail kacau (shift closed dengan transaksi status berubah)
   *
   * Fix: kasir/manager wajib resolve dulu di Pusat Persetujuan sebelum
   * close. Owner bisa Approve langsung. Atau Tolak/Batalkan dulu. */
  const trxInShiftRows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.shiftId, current.id));
  const trxIdsInShift = trxInShiftRows.map((r) => r.id);

  const now = new Date();
  const [
    pendingVoidRefundCodes,
    pendingRebalances,
    pendingCorrections,
    pendingEntryChangesInShift,
  ] = await Promise.all([
    trxIdsInShift.length > 0
      ? db
          .select({
            id: approvalCodes.id,
            actionType: approvalCodes.actionType,
            trxId: approvalCodes.targetTransactionId,
          })
          .from(approvalCodes)
          .where(
            and(
              eq(approvalCodes.outletId, current.outletId),
              inArray(approvalCodes.targetTransactionId, trxIdsInShift),
              inArray(approvalCodes.actionType, [
                "pos.transaction.void",
                "pos.transaction.refund",
              ]),
              isNull(approvalCodes.consumedAt),
              isNull(approvalCodes.revokedAt),
              gt(approvalCodes.expiresAt, now),
            ),
          )
      : Promise.resolve(
          [] as Array<{
            id: string;
            actionType: string;
            trxId: string | null;
          }>,
        ),
    db
      .select({ id: shiftRebalances.id })
      .from(shiftRebalances)
      .where(
        and(
          eq(shiftRebalances.shiftId, current.id),
          eq(shiftRebalances.status, "pending_approval"),
        ),
      ),
    trxIdsInShift.length > 0
      ? db
          .select({
            id: transactionCorrections.id,
            transactionId: transactionCorrections.transactionId,
          })
          .from(transactionCorrections)
          .where(
            and(
              inArray(transactionCorrections.transactionId, trxIdsInShift),
              eq(transactionCorrections.status, "pending_approval"),
            ),
          )
      : Promise.resolve(
          [] as Array<{ id: string; transactionId: string }>,
        ),
    db
      .select({ id: pendingEntryChanges.id })
      .from(pendingEntryChanges)
      .where(
        and(
          eq(pendingEntryChanges.shiftId, current.id),
          eq(pendingEntryChanges.status, "pending_approval"),
          gt(pendingEntryChanges.expiresAt, now),
        ),
      ),
  ]);

  const voidCount = pendingVoidRefundCodes.filter(
    (r) => r.actionType === "pos.transaction.void",
  ).length;
  const refundCount = pendingVoidRefundCodes.filter(
    (r) => r.actionType === "pos.transaction.refund",
  ).length;
  const totalPending =
    voidCount +
    refundCount +
    pendingRebalances.length +
    pendingCorrections.length +
    pendingEntryChangesInShift.length;

  if (totalPending > 0) {
    const parts: string[] = [];
    if (voidCount > 0) parts.push(`${voidCount} void`);
    if (refundCount > 0) parts.push(`${refundCount} refund`);
    if (pendingCorrections.length > 0)
      parts.push(`${pendingCorrections.length} koreksi`);
    if (pendingRebalances.length > 0)
      parts.push(`${pendingRebalances.length} rebalance`);
    if (pendingEntryChangesInShift.length > 0)
      parts.push(`${pendingEntryChangesInShift.length} edit catatan`);
    return fail(
      "PENDING_APPROVALS_EXIST",
      `Ada pending approval (${parts.join(" + ")}) di shift ini. ` +
        `Selesaikan dulu di Pusat Persetujuan (Owner approve langsung, ` +
        `atau Manager input kode, atau Tolak/Batalkan) sebelum tutup shift. ` +
        `Kalau dipaksakan, hitungan kas bisa drift.`,
    );
  }

  // Aggregate transactions in this shift via pure helper (sesi AE-44).
  // refundedAmount column wajib di-select supaya partial refund bisa
  // di-deduct presisi (bukan over-deduct pakai total).
  // Sesi AE-155 — fetch trx + splits sekaligus supaya pure helper bisa
  // allocate per-method untuk paymentMethod="split". Tanpa join splits,
  // expectedCash hitung 0 dari split trx (variance alarm palsu).
  const txnRows = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      paymentMethod: transactions.paymentMethod,
      total: transactions.total,
      refundedAmount: transactions.refundedAmount,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, current.id));

  const splitTrxIds = txnRows
    .filter((t) => t.paymentMethod === "split")
    .map((t) => t.id);
  const splitsByTrxId = new Map<
    string,
    Array<{ paymentMethod: string; amount: number }>
  >();
  if (splitTrxIds.length > 0) {
    const splitRows = await db
      .select({
        transactionId: splitPayments.transactionId,
        paymentMethod: splitPayments.paymentMethod,
        amount: splitPayments.amount,
      })
      .from(splitPayments)
      .where(inArray(splitPayments.transactionId, splitTrxIds));
    for (const s of splitRows) {
      const list = splitsByTrxId.get(s.transactionId) ?? [];
      list.push({ paymentMethod: s.paymentMethod, amount: s.amount });
      splitsByTrxId.set(s.transactionId, list);
    }
  }
  const txns = txnRows.map((t) => ({
    status: t.status,
    paymentMethod: t.paymentMethod,
    total: t.total,
    refundedAmount: t.refundedAmount,
    splits: splitsByTrxId.get(t.id),
  }));

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
      ? toJakartaDateOnly(updated.closedAt)
      : toJakartaDateOnly(new Date());
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

  /* Sesi AE-193 — jurnal penjualan HARIAN. Shift di sini biasa buka pagi dan
   * tutup lewat tengah malam, jadi satu shift bisa menyentuh dua tanggal
   * kalender WIB dan masing-masing punya batch sendiri (kalau dipukul rata ke
   * tanggal tutup, 632 dari 1.752 transaksi mendarat di hari yang salah dan
   * sebagian lompat bulan).
   *
   * `force: true` karena shift ini sedang ditutup — penundaan "masih ada shift
   * terbuka" tidak berlaku untuk dirinya sendiri. Tetap fire-and-forget: jurnal
   * yang gagal TIDAK boleh menggagalkan penutupan shift kasir; sapuan berkala
   * yang menambalnya. */
  {
    const { datesTouchedByShift } = await import(
      "@/features/accounting/daily-sales-pure"
    );
    const { postJournalForPosDailySales } = await import(
      "@/features/accounting/daily-sales"
    );
    const { fireJournalHook } = await import("@/features/accounting/hooks");
    const dates = datesTouchedByShift(
      current.openedAt,
      updated.closedAt,
      new Date(),
    );
    for (const entryDate of dates) {
      const dailyArgs = {
        outletId: session.user.outletId,
        entryDate,
        actorId: session.user.id,
        force: true,
      };
      fireJournalHook(
        () => postJournalForPosDailySales(dailyArgs).then(() => undefined),
        "pos_daily_sales",
        {
          outletId: session.user.outletId,
          actorId: session.user.id,
        },
        { label: "pos_daily_sales", args: dailyArgs },
      );
    }
  }

  // Phase 2.4 (sesi AB) — auto-create pending cash_deposit kalau kasir
  // input setoran ke owner. Owner verify nanti di Admin → Setoran Tunai.
  // Sesi AE-62h — kalau gagal, surface error ke kasir supaya tidak silent.
  let autoDepositId: string | null = null;
  let autoDepositError: { code: string; message: string } | null = null;
  if (v.depositAmount && v.depositAmount > 0) {
    try {
      const { createCashDeposit } = await import("@/features/finance/actions");
      const isoDate = (d: Date | string | null | undefined): string =>
        toJakartaDateOnly(d ?? new Date());
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

  /* Sesi AE-124 — push notif Finance + Manager kalau variance significant.
   * Threshold 50.000 (lebih kecil dari itu = noise normal). Fire-and-forget.
   * Honor quiet hours + snooze via sendCategorizedPush. */
  if (Math.abs(variance) >= 50_000) {
    void (async () => {
      try {
        const { sendCategorizedPush } = await import(
          "@/features/push-notifications/server"
        );
        const sign = variance > 0 ? "+" : "−";
        const absVar = Math.abs(variance).toLocaleString("id-ID");
        await sendCategorizedPush(
          "shift",
          session.user.outletId,
          {
            title: `Shift variance Rp ${sign}${absVar}`,
            body: `Shift ${updated.id.slice(0, 8)} closed dengan variance signifikan. Mohon review balance.`,
            url: "/dashboard#shifts",
            tag: `shift-variance-${updated.id.slice(0, 8)}`,
          },
        );
      } catch (e) {
        console.error("[push] shift.variance notif fail:", e);
      }
    })();
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

/**
 * Audit POS E2E 2026-06-12 — TUTUP PAKSA shift nginep (owner-only).
 *
 * Skenario: kasir lupa tutup shift semalam → besoknya shift masih open,
 * transaksi hari ini nyangkut ke shift kemarin, dan tidak ada jalan tutup
 * dari backoffice (harus lewat POS). Action ini = WRAPPER TIPIS di atas
 * `closeShift` supaya SEMUA logika uang ikut otomatis (guard open-bill +
 * pending-approval, expected cash, variance + jurnal 6902, settlement
 * fallback) — TANPA duplikasi kode uang. Owner tetap wajib hitung kas fisik
 * laci (variance jujur, bukan auto-0) + isi alasan.
 *
 * Bedanya dari tutup normal: permission `shift.force_close` (owner) +
 * jejak audit `shift.force_close` + alasan dicap di notes.
 */
export async function forceCloseShift(input: {
  shiftId: string;
  actualCash: number;
  reason: string;
}): Promise<ApiResult<CloseShiftResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.force_close")) {
    return fail("FORBIDDEN", "Hanya Owner yang bisa tutup paksa shift");
  }
  const reason = input.reason.trim();
  if (reason.length < 3) {
    return fail("VALIDATION_ERROR", "Alasan minimal 3 karakter");
  }
  if (!Number.isFinite(input.actualCash) || input.actualCash < 0) {
    return fail("VALIDATION_ERROR", "Kas dihitung tidak boleh negatif");
  }

  const res = await closeShift({
    shiftId: input.shiftId,
    actualCash: Math.round(input.actualCash),
    notes: `[TUTUP PAKSA owner] ${reason}`,
    handoverMessage: null,
  });
  if (!res.success) return res;

  logAudit({
    eventType: "shift.force_close",
    userId: session.user.id,
    entityType: "shift",
    entityId: input.shiftId,
    payload: {
      summary: `Tutup paksa shift — ${reason} (variance ${(res.data.shift.variance ?? 0).toLocaleString("id-ID")})`,
      after: {
        actualCash: Math.round(input.actualCash),
        variance: res.data.shift.variance,
        reason,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  }).catch((e) => console.error("[audit shift.force_close]", e));

  return res;
}

// =========================================================================
// Sesi AE-167 — Kas Awal Standar (float harian) + koreksi kas awal
// =========================================================================

const DEFAULT_STANDARD_OPENING_CASH = 200_000;

/** Baca kas awal standar (float harian) outlet. Default Rp 200rb kalau unset.
 * Boleh dibaca semua role yang bisa buka shift (dipakai OpenShiftModal). */
export async function getStandardOpeningCash(): Promise<
  ApiResult<{ standardOpeningCash: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.open_own")) {
    return fail("FORBIDDEN", "Tidak punya hak");
  }
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const v = row?.settings?.shift?.standardOpeningCash;
  return ok({
    standardOpeningCash:
      typeof v === "number" && v >= 0 ? v : DEFAULT_STANDARD_OPENING_CASH,
  });
}

/** Atur kas awal standar (owner/manager). */
export async function updateStandardOpeningCash(input: {
  amount: number;
}): Promise<ApiResult<{ standardOpeningCash: number }>> {
  const session = await requireSession();
  /* close_any = owner/manager (sama gate dgn supervise close). */
  if (!hasPermission(session.user.role, "shift.close_any")) {
    return fail(
      "FORBIDDEN",
      "Hanya Owner/Manager yang bisa atur kas awal standar",
    );
  }
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
    return fail("VALIDATION", "Nominal tidak valid (0–99.999.999)");
  }
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const current: OutletSettings = row?.settings ?? {};
  const next: OutletSettings = {
    ...current,
    shift: { ...(current.shift ?? {}), standardOpeningCash: amount },
  };
  await db
    .update(outlets)
    .set({ settings: next })
    .where(eq(outlets.id, session.user.outletId));
  logAudit({
    eventType: "outlet.standard_opening_cash.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: session.user.outletId,
    payload: {
      summary: `Set kas awal standar = Rp ${amount.toLocaleString("id-ID")}`,
      after: { standardOpeningCash: amount },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  }).catch((e) => console.error("[audit standard_opening_cash.update]", e));
  return ok({ standardOpeningCash: amount });
}

/**
 * Sesi AE-167 — koreksi KAS AWAL (opening cash) shift yang salah input.
 *
 * Otorisasi: owner/manager langsung; staff/supervisor WAJIB approverToken
 * (PIN owner/manager via verify-approver, actionType shift.opening_cash.correct).
 *
 * Shift BUKA: update openingCash saja (variance dihitung fresh saat tutup).
 * Shift TUTUP: hanya boleh s/d 24:00 WIB hari shift ditutup. Variance digeser
 *   eksak (newVariance = oldVariance − Δopening) — konsisten dgn formula close
 *   tanpa refetch transaksi. Jurnal selisih kas di-reverse + post ulang
 *   (postJournalForOpeningCashCorrection), idempoten untuk koreksi berulang.
 */
export async function correctOpeningCash(input: {
  shiftId: string;
  correctedOpeningCash: number;
  reason: string;
  approverToken?: string | null;
}): Promise<ApiResult<Shift>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "shift.close_own")) {
    return fail("FORBIDDEN", "Tidak punya hak");
  }

  const correctedOpeningCash = Math.round(input.correctedOpeningCash);
  if (
    !Number.isFinite(correctedOpeningCash) ||
    correctedOpeningCash < 0 ||
    correctedOpeningCash > 99_999_999
  ) {
    return fail("VALIDATION", "Kas awal tidak valid (0–99.999.999)");
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) {
    return fail("VALIDATION", "Alasan koreksi wajib (min 3 karakter)");
  }

  const shift = await fetchShiftById(input.shiftId);
  if (!shift) return fail("NOT_FOUND", "Shift tidak ditemukan");
  if (shift.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Shift dari outlet lain");
  }

  /* Otorisasi: owner/manager (punya shift.opening_cash.correct) bisa langsung.
   * Selain itu (staff/supervisor) wajib approver token owner/manager. */
  const isSupervisor = hasPermission(
    session.user.role,
    "shift.opening_cash.correct",
  );
  if (!isSupervisor) {
    if (!input.approverToken) {
      return fail(
        "APPROVAL_REQUIRED",
        "Butuh persetujuan Owner/Manager (PIN) untuk koreksi kas awal",
      );
    }
    try {
      await consumeApproverToken(
        input.approverToken,
        "shift.opening_cash.correct",
        input.shiftId,
      );
    } catch {
      return fail(
        "APPROVAL_INVALID",
        "Persetujuan tidak valid / kadaluarsa — minta PIN ulang",
      );
    }
  }

  const oldOpening = shift.openingCash;
  if (oldOpening === correctedOpeningCash) {
    return fail("NO_CHANGE", "Kas awal sama — tidak ada yang dikoreksi");
  }
  const delta = correctedOpeningCash - oldOpening;

  const auditCorrection = (extra: Record<string, unknown>) =>
    logAudit({
      eventType: "shift.opening_cash.correct",
      userId: session.user.id,
      entityType: "shift",
      entityId: shift.id,
      payload: {
        summary: `Koreksi kas awal shift ${shift.id.slice(0, 8)}: Rp ${oldOpening.toLocaleString("id-ID")} → Rp ${correctedOpeningCash.toLocaleString("id-ID")}`,
        before: { openingCash: oldOpening, variance: shift.variance ?? null },
        after: { openingCash: correctedOpeningCash, ...extra },
        context: { reason, status: shift.status },
      },
      metadata: {
        outletId: shift.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit shift.opening_cash.correct]", e));

  try {
    /* ---------- Shift BUKA: update opening saja, no jurnal. ---------- */
    if (shift.status === "open") {
      const [updated] = await db
        .update(shifts)
        .set({ openingCash: correctedOpeningCash, updatedAt: new Date() })
        .where(eq(shifts.id, shift.id))
        .returning();
      auditCorrection({ varianceImpact: null });
      return ok(updated);
    }

    /* ---------- Shift TUTUP: window s/d 24:00 WIB + jurnal. ---------- */
    if (!shift.closedAt) {
      return fail("INVALID_STATE", "Shift tutup tanpa closedAt");
    }
    const closedWibDate = toJakartaDateOnly(shift.closedAt);
    const todayWib = toJakartaDateOnly(new Date());
    if (closedWibDate !== todayWib) {
      return fail(
        "TOO_LATE",
        "Koreksi kas awal shift tutup hanya bisa di hari yang sama (s/d 24:00 WIB). Untuk koreksi shift lebih lama, gunakan Rebalance Shift.",
      );
    }

    const oldVariance = shift.variance ?? 0;
    const newVariance = oldVariance - delta;

    const [updated] = await db
      .update(shifts)
      .set({
        openingCash: correctedOpeningCash,
        variance: newVariance,
        updatedAt: new Date(),
      })
      .where(eq(shifts.id, shift.id))
      .returning();

    /* Jurnal: reverse selisih kas lama + post baru (fire-and-forget). */
    const { fireJournalHook, postJournalForOpeningCashCorrection } =
      await import("@/features/accounting/hooks");
    fireJournalHook(
      () =>
        postJournalForOpeningCashCorrection({
          outletId: shift.outletId,
          shiftId: shift.id,
          shiftLabel: `Shift ${shift.id.slice(0, 8)}`,
          originalVariance: oldVariance,
          correctedVariance: newVariance,
          reason,
          entryDate: closedWibDate,
          actorId: session.user.id,
        }),
      "shift_opening_cash_correction",
    );

    auditCorrection({ varianceBefore: oldVariance, varianceAfter: newVariance });
    return ok(updated);
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "shift.correct-opening-cash", "Operasi database gagal"),
    );
  }
}
