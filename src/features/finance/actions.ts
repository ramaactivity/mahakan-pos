"use server";

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  aggregatorSettlements,
  cashDeposits,
  chartOfAccounts,
  reconciliationNotes,
  splitPayments,
  transactions,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  createAggregatorSettlementSchema,
  createCashDepositSchema,
  rejectCashDepositSchema,
  unverifyCashDepositSchema,
  updateAggregatorSettlementSchema,
  updateCashDepositSchema,
  verifyCashDepositSchema,
} from "./schemas";
import {
  fetchReconciliationDrillDown,
  getCashDepositDashboard,
  getCashFlowLedger,
  getAggregatorSettlementDetail,
  getCashOnHand,
  getDailySettlementReport,
  getOutletThreshold,
  getSettlementReconciliation,
  listAggregatorSettlements,
  listCashDeposits,
  listOutstandingTopForFinance,
} from "./queries";
import {
  fail,
  ok,
  type AggregatorSettlement,
  type ApiResult,
  type CashDeposit,
  type CashDepositDashboard,
  type CashDepositStatus,
  type CashFlowLedgerReport,
  type CashOnHandSnapshot,
  type CreateAggregatorSettlementInput,
  type CreateCashDepositInput,
  type DailySettlementReport,
  type AggregatorChannel,
  type ReconciliationDrillDown,
  type RejectCashDepositInput,
  type SettlementReconciliationReport,
  type SetReconciliationStatusInput,
  type UpdateAggregatorSettlementInput,
  type UpdateCashDepositInput,
  type VerifyCashDepositInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** Add 1 day to YYYY-MM-DD ISO date. Used for period-overlap suggestion. */
function addOneDayIsoLocal(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------- Read wrappers ----------

export async function fetchDailySettlement(
  dateIso: string,
): Promise<ApiResult<DailySettlementReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.daily_settlement.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan settlement");
  }
  const data = await getDailySettlementReport(session.user.outletId, dateIso);
  return ok(data);
}

export async function fetchCashOnHand(): Promise<
  ApiResult<CashOnHandSnapshot>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.view")) {
    return fail("FORBIDDEN", "Tidak punya akses cash on hand");
  }
  const data = await getCashOnHand(session.user.outletId);
  return ok(data);
}

/**
 * Sesi AE-8 — Setoran Tunai dashboard payload (cards + 30-day rollup).
 * Single fetch untuk dedicated module di backoffice + POS Kas tab.
 */
export async function fetchCashDepositDashboard(): Promise<
  ApiResult<CashDepositDashboard>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.view")) {
    return fail("FORBIDDEN", "Tidak punya akses dashboard setoran tunai");
  }
  const data = await getCashDepositDashboard(session.user.outletId);
  return ok(data);
}

export async function fetchCashDeposits(opts?: {
  status?: CashDepositStatus | "all";
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}): Promise<
  ApiResult<{
    rows: Array<
      CashDeposit & {
        depositorName: string | null;
        verifierName: string | null;
      }
    >;
    total: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.view")) {
    return fail("FORBIDDEN", "Tidak punya akses setoran tunai");
  }
  const data = await listCashDeposits({
    outletId: session.user.outletId,
    ...opts,
  });
  return ok(data);
}

export async function fetchCashFlowLedger(
  fromIso: string,
  toIso: string,
): Promise<ApiResult<CashFlowLedgerReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.cash_flow.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan arus kas");
  }
  const data = await getCashFlowLedger(
    session.user.outletId,
    fromIso,
    toIso,
  );
  return ok(data);
}

export async function fetchSettlementReconciliation(
  fromIso: string,
  toIso: string,
): Promise<ApiResult<SettlementReconciliationReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "aggregator_settlement.view")) {
    return fail("FORBIDDEN", "Tidak punya akses rekonsiliasi");
  }
  const data = await getSettlementReconciliation(
    session.user.outletId,
    fromIso,
    toIso,
  );
  return ok(data);
}

export async function fetchAggregatorSettlements(opts?: {
  channel?:
    | "edc_bca"
    | "gofood"
    | "grabfood"
    | "shopeefood"
    | "qris"
    | "all";
  fromDate?: string;
  toDate?: string;
}): Promise<ApiResult<Awaited<ReturnType<typeof listAggregatorSettlements>>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "aggregator_settlement.view")) {
    return fail("FORBIDDEN", "Tidak punya akses settlement aggregator");
  }
  const data = await listAggregatorSettlements({
    outletId: session.user.outletId,
    ...opts,
  });
  return ok(data);
}

/** Sesi AE-77 — Fetch detail 1 settlement (dengan line_items JSON) untuk
 * drilldown modal di Laporan Aggregator. */
export async function fetchAggregatorSettlementDetail(input: {
  id: string;
}): Promise<
  ApiResult<Awaited<ReturnType<typeof getAggregatorSettlementDetail>>>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "aggregator_settlement.view")) {
    return fail("FORBIDDEN", "Tidak punya akses settlement aggregator");
  }
  const data = await getAggregatorSettlementDetail({
    outletId: session.user.outletId,
    id: input.id,
  });
  return ok(data);
}

/**
 * Sesi AE-63 phase4 — Sales-by-channel reference untuk aggregator settlement
 * form. Staff finance request: "ketika klik tanggal bisa langsung muncul
 * total penjualan pada payment methode tsb". Untuk aggregator (monthly
 * statement), ini reference SUM POS sales channel itu di periode tsb —
 * staff bisa sanity-check statement vs POS sebelum input gross.
 *
 * Channel mapping: AggregatorChannel pakai `edc_bca`/`qris`/aggregator
 * names, sedangkan transactions.paymentMethod pakai `card_bca` untuk EDC.
 * Map di sini.
 *
 * Range inklusif: [fromDate, toDate] WIB hari penuh.
 */
export async function getAggregatorChannelSalesInRange(args: {
  channel: AggregatorChannel;
  fromDate: string;
  toDate: string;
}): Promise<
  ApiResult<{
    grossSales: number;
    transactionCount: number;
  }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "aggregator_settlement.view")) {
    return fail("FORBIDDEN", "Tidak punya akses settlement aggregator");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(args.fromDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(args.toDate)
  ) {
    return fail("INVALID_DATE", "Format tanggal harus YYYY-MM-DD");
  }
  if (args.toDate < args.fromDate) {
    return fail("INVALID_DATE", "Tanggal akhir harus >= awal");
  }

  /* Map aggregator channel → payment_method canonical di transactions.
   * Aggregator delivery channels (gofood/grabfood/shopeefood) TIDAK tracked
   * per-transaction di POS — sales-nya bulk via aggregator settlement
   * statement. Return 0 untuk channel ini biar staff sadar no POS reference. */
  type PosPaymentMethod =
    | "qris"
    | "card_bca"
    | "card_bni"
    | "card_mandiri"
    | "card_bri"
    | "card_other";
  let paymentMethod: PosPaymentMethod;
  if (args.channel === "edc_bca") paymentMethod = "card_bca";
  else if (args.channel === "qris") paymentMethod = "qris";
  else {
    /* gofood/grabfood/shopeefood: no POS reference data. */
    return ok({ grossSales: 0, transactionCount: 0 });
  }

  /* WIB inclusive range: from 00:00 WIB to next-day 00:00 WIB. */
  const dayStartUtc = new Date(`${args.fromDate}T00:00:00+07:00`);
  const dayEndExclusiveUtc = new Date(`${args.toDate}T00:00:00+07:00`);
  dayEndExclusiveUtc.setUTCDate(dayEndExclusiveUtc.getUTCDate() + 1);

  /* Single-method transactions (status='paid', exclude split parents). */
  const trxAgg = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, session.user.outletId),
        eq(transactions.status, "paid"),
        eq(transactions.paymentMethod, paymentMethod),
        gte(transactions.createdAt, dayStartUtc),
        lte(transactions.createdAt, dayEndExclusiveUtc),
      ),
    );

  /* Split legs untuk payment_method ini (parent must be paid). */
  const splitAgg = await db
    .select({
      total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(splitPayments)
    .innerJoin(transactions, eq(transactions.id, splitPayments.transactionId))
    .where(
      and(
        eq(splitPayments.outletId, session.user.outletId),
        eq(splitPayments.paymentMethod, paymentMethod),
        eq(transactions.status, "paid"),
        gte(transactions.createdAt, dayStartUtc),
        lte(transactions.createdAt, dayEndExclusiveUtc),
      ),
    );

  const grossSales =
    Number(trxAgg[0]?.total ?? 0) + Number(splitAgg[0]?.total ?? 0);
  const transactionCount =
    Number(trxAgg[0]?.count ?? 0) + Number(splitAgg[0]?.count ?? 0);

  return ok({ grossSales, transactionCount });
}

export async function fetchHutangOutstanding(): Promise<
  ApiResult<Awaited<ReturnType<typeof listOutstandingTopForFinance>>>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "finance.dashboard.view")) {
    return fail("FORBIDDEN", "Tidak punya akses keuangan");
  }
  const data = await listOutstandingTopForFinance(session.user.outletId);
  return ok(data);
}

// ---------- Cash Deposit mutations ----------

export async function createCashDeposit(
  input: CreateCashDepositInput,
): Promise<ApiResult<CashDeposit>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.create")) {
    return fail("FORBIDDEN", "Tidak punya hak setor tunai");
  }
  const parsed = createCashDepositSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }
  const v = parsed.data;

  // Sesi AE-10 — anti-fraud period overlap guard. Reject kalau periode kas
  // (coversFromDate..coversToDate) overlap dengan deposit yang sudah verified
  // di outlet yang sama. Prevents double-counting + ensures monotonic timeline.
  // Tidak block overlap dengan pending (owner mungkin lagi review/edit).
  const overlapping = await db
    .select({
      id: cashDeposits.id,
      coversFromDate: cashDeposits.coversFromDate,
      coversToDate: cashDeposits.coversToDate,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, session.user.outletId),
        eq(cashDeposits.status, "verified"),
        // Standard interval overlap: A.from <= B.to AND A.to >= B.from
        lte(cashDeposits.coversFromDate, v.coversToDate),
        gte(cashDeposits.coversToDate, v.coversFromDate),
      ),
    )
    .orderBy(desc(cashDeposits.coversToDate))
    .limit(1);
  if (overlapping.length > 0) {
    const conflict = overlapping[0];
    return fail(
      "PERIOD_OVERLAP",
      `Periode kas overlap dengan setoran verified ${conflict.coversFromDate}..${conflict.coversToDate}. Mulai dari ${addOneDayIsoLocal(conflict.coversToDate)}.`,
    );
  }

  const [row] = await db
    .insert(cashDeposits)
    .values({
      outletId: session.user.outletId,
      depositDate: v.depositDate,
      amount: v.amount,
      bankDestination: v.bankDestination,
      referenceNo: v.referenceNo,
      photoUrl: v.photoUrl ?? null,
      notes: v.notes,
      coversFromDate: v.coversFromDate,
      coversToDate: v.coversToDate,
      depositedBy: session.user.id,
    })
    .returning();

  logAudit({
    eventType: "cash_deposit.create",
    userId: session.user.id,
    entityType: "cash_deposit",
    entityId: row.id,
    payload: {
      summary: `Setoran tunai Rp ${row.amount.toLocaleString("id-ID")} ke ${row.bankDestination}`,
      after: {
        amount: row.amount,
        bankDestination: row.bankDestination,
        depositDate: row.depositDate,
        coversFromDate: row.coversFromDate,
        coversToDate: row.coversToDate,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit cash_deposit.create]", e));

  /* Sesi AE-123+124 — push notif ke user yang subscribed ke kategori
   * finance_payment di outlet. Honor quiet hours + snooze. Gracefully
   * no-op kalau VAPID env tidak di-set. Fire-and-forget. */
  void (async () => {
    try {
      const { sendCategorizedPush } = await import(
        "@/features/push-notifications/server"
      );
      const result = await sendCategorizedPush(
        "finance_payment",
        session.user.outletId,
        {
          title: "Setoran tunai baru menunggu verifikasi",
          body: `Rp ${row.amount.toLocaleString("id-ID")} ke ${row.bankDestination} (${row.depositDate})`,
          url: "/dashboard#setoran_tunai",
          tag: "setoran-pending",
        },
      );
      if (result.sent > 0 || result.skippedQuiet > 0 || result.skippedSnooze > 0) {
        console.info(
          `[push:finance_payment] sent=${result.sent} skipQuiet=${result.skippedQuiet} skipSnooze=${result.skippedSnooze} skipOptOut=${result.skippedOptOut}`,
        );
      }
    } catch (e) {
      console.error("[push] setoran-pending notif fail:", e);
    }
  })();

  return ok(row);
}

export async function updateCashDeposit(
  input: UpdateCashDepositInput,
): Promise<ApiResult<CashDeposit>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.create")) {
    return fail("FORBIDDEN", "Tidak punya hak edit setoran");
  }
  const parsed = updateCashDepositSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }
  const v = parsed.data;
  const [current] = await db
    .select()
    .from(cashDeposits)
    .where(eq(cashDeposits.id, v.id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Setoran tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Setoran dari outlet lain");
  }
  if (current.status !== "pending_verification") {
    return fail(
      "INVALID_STATE",
      "Hanya setoran pending yang bisa diedit",
    );
  }
  const next = {
    depositDate: v.depositDate ?? current.depositDate,
    amount: v.amount ?? current.amount,
    bankDestination: v.bankDestination ?? current.bankDestination,
    referenceNo: v.referenceNo ?? current.referenceNo,
    photoUrl:
      v.photoUrl !== undefined
        ? typeof v.photoUrl === "string" && v.photoUrl.length === 0
          ? null
          : (v.photoUrl as string | null)
        : current.photoUrl,
    notes: v.notes ?? current.notes,
    coversFromDate: v.coversFromDate ?? current.coversFromDate,
    coversToDate: v.coversToDate ?? current.coversToDate,
  };
  if (next.coversToDate < next.coversFromDate) {
    return fail("VALIDATION", "Tanggal akhir harus >= tanggal awal");
  }

  // Sesi AE-62g — anti-fraud bypass closed di update:
  // (1) Periode overlap guard — kalau coversFromDate/coversToDate berubah,
  //     re-cek vs verified deposits (sebelumnya cuma di-cek di createCashDeposit
  //     → owner bisa edit pending deposit untuk overlap verified period →
  //     double-count cash).
  // (2) Photo unmask guard — pending deposit yang sudah ada foto tidak boleh
  //     di-clear photoUrl (kalau tidak, owner bisa hapus foto sebelum verify
  //     untuk bypass anti-fraud requirement). User boleh REPLACE foto baru.
  const periodChanged =
    next.coversFromDate !== current.coversFromDate ||
    next.coversToDate !== current.coversToDate;
  if (periodChanged) {
    const overlapping = await db
      .select({
        id: cashDeposits.id,
        coversFromDate: cashDeposits.coversFromDate,
        coversToDate: cashDeposits.coversToDate,
      })
      .from(cashDeposits)
      .where(
        and(
          eq(cashDeposits.outletId, session.user.outletId),
          eq(cashDeposits.status, "verified"),
          lte(cashDeposits.coversFromDate, next.coversToDate),
          gte(cashDeposits.coversToDate, next.coversFromDate),
        ),
      )
      .orderBy(desc(cashDeposits.coversToDate))
      .limit(1);
    if (overlapping.length > 0) {
      const conflict = overlapping[0];
      return fail(
        "PERIOD_OVERLAP",
        `Periode kas overlap dengan setoran verified ${conflict.coversFromDate}..${conflict.coversToDate}. Mulai dari ${addOneDayIsoLocal(conflict.coversToDate)}.`,
      );
    }
  }
  if (current.photoUrl !== null && next.photoUrl === null) {
    return fail(
      "PHOTO_REQUIRED",
      "Foto bukti tidak boleh dihapus tanpa replace dengan foto baru.",
    );
  }

  const [row] = await db
    .update(cashDeposits)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(cashDeposits.id, v.id))
    .returning();

  logAudit({
    eventType: "cash_deposit.update",
    userId: session.user.id,
    entityType: "cash_deposit",
    entityId: row.id,
    payload: {
      summary: `Update setoran ${row.bankDestination}`,
      before: current,
      after: row,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit cash_deposit.update]", e));

  return ok(row);
}

export async function verifyCashDeposit(
  input: VerifyCashDepositInput,
): Promise<ApiResult<CashDeposit>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.verify")) {
    return fail("FORBIDDEN", "Tidak punya hak verifikasi setoran");
  }
  const parsed = verifyCashDepositSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }

  const [current] = await db
    .select()
    .from(cashDeposits)
    .where(eq(cashDeposits.id, parsed.data.id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Setoran tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Setoran dari outlet lain");
  }
  if (current.status !== "pending_verification") {
    return fail("INVALID_STATE", "Hanya setoran pending yang bisa diverifikasi");
  }
  // Sesi AE-8 — anti-fraud guard: tidak boleh verify tanpa foto bukti.
  // Auto-create dari shift close boleh skip foto (kasir input nominal saja),
  // tapi owner WAJIB upload foto via Edit dulu sebelum mark verified.
  if (!current.photoUrl) {
    return fail(
      "PHOTO_REQUIRED",
      "Upload foto bukti transfer dulu sebelum verifikasi (anti-fraud)",
    );
  }

  // Sesi AE-62h — block verify yang bikin cashOnHand jadi negatif kecuali
  // owner eksplisit acknowledge. Negatif cashOnHand sinyal data inconsistency
  // (refund/expense gak ke-record, atau setoran amount salah). Sebelumnya
  // warning-only di dashboard → owner gampang skip → cash tracking rusak.
  if (!parsed.data.acknowledgeNegativeCash) {
    const snapshot = await getCashOnHand(session.user.outletId);
    const projected = snapshot.cashOnHand - current.amount;
    if (projected < 0) {
      return fail(
        "NEGATIVE_CASH_NOT_ACKNOWLEDGED",
        `Setoran Rp ${current.amount.toLocaleString("id-ID")} bikin kas tersedia jadi minus ${Math.abs(projected).toLocaleString("id-ID")}. Biasanya berarti ada refund/expense belum ter-record. Re-submit dengan acknowledge=true untuk override (audit log akan flag).`,
      );
    }
  }

  const [row] = await db
    .update(cashDeposits)
    .set({
      status: "verified",
      verifiedBy: session.user.id,
      verifiedAt: new Date(),
      rejectedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(cashDeposits.id, parsed.data.id))
    .returning();

  logAudit({
    eventType: "cash_deposit.verify",
    userId: session.user.id,
    entityType: "cash_deposit",
    entityId: row.id,
    payload: {
      summary: `Setoran ${row.bankDestination} Rp ${row.amount.toLocaleString("id-ID")} diverifikasi`,
      after: { status: "verified", verifiedAt: row.verifiedAt },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit cash_deposit.verify]", e));

  // Sesi T — Accounting auto-journal hook (deposit verified). Resolve bank
  // account code via FK kalau di-set, else fallback heuristic dari destination.
  {
    const { fireJournalHook, postJournalForCashDepositVerified } = await import(
      "@/features/accounting/hooks"
    );
    let bankAccountCode: string | null = null;
    if (row.bankAccountId) {
      const [bankAcc] = await db
        .select({ code: chartOfAccounts.code })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.id, row.bankAccountId))
        .limit(1);
      bankAccountCode = bankAcc?.code ?? null;
    }
    fireJournalHook(
      () =>
        postJournalForCashDepositVerified({
          outletId: session.user.outletId,
          cashDepositId: row.id,
          amount: Number(row.amount),
          bankAccountCode,
          bankDestination: row.bankDestination,
          entryDate: String(row.depositDate),
          referenceNo: row.referenceNo,
          actorId: session.user.id,
        }),
      "cash_deposit_verified",
    );
  }

  return ok(row);
}

export async function rejectCashDeposit(
  input: RejectCashDepositInput,
): Promise<ApiResult<CashDeposit>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.verify")) {
    return fail("FORBIDDEN", "Tidak punya hak reject setoran");
  }
  const parsed = rejectCashDepositSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }

  const [current] = await db
    .select()
    .from(cashDeposits)
    .where(eq(cashDeposits.id, parsed.data.id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Setoran tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Setoran dari outlet lain");
  }
  if (current.status !== "pending_verification") {
    return fail("INVALID_STATE", "Hanya setoran pending yang bisa direject");
  }

  const [row] = await db
    .update(cashDeposits)
    .set({
      status: "rejected",
      rejectedReason: parsed.data.reason,
      verifiedBy: null,
      verifiedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(cashDeposits.id, parsed.data.id))
    .returning();

  logAudit({
    eventType: "cash_deposit.reject",
    userId: session.user.id,
    entityType: "cash_deposit",
    entityId: row.id,
    payload: {
      summary: `Setoran ${row.bankDestination} ditolak: ${parsed.data.reason}`,
      after: { status: "rejected", rejectedReason: parsed.data.reason },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit cash_deposit.reject]", e));

  return ok(row);
}

/**
 * Sesi AE-62h — Revert deposit yang sudah verified kembali ke pending.
 *
 * Use case: owner discover deposit fraudulent/duplicate/wrong amount setelah
 * verify. Sebelumnya tidak ada cara correct verified deposit kecuali manual
 * DB edit → audit trail rusak.
 *
 * Behavior:
 *   - Status verified → pending_verification
 *   - Clear verifiedBy / verifiedAt
 *   - Audit log dengan reason (mandatory)
 *   - Fire reverse journal entry hook (existing pattern: deposit verified
 *     posts DR Bank / CR Kas; revert posts DR Kas / CR Bank)
 *
 * Permission: cash_deposit.verify (same hak dengan verify — owner only).
 */
export async function unverifyCashDeposit(
  input: { id: string; reason: string },
): Promise<ApiResult<CashDeposit>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash_deposit.verify")) {
    return fail("FORBIDDEN", "Tidak punya hak revert setoran");
  }
  const parsed = unverifyCashDepositSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }
  const [current] = await db
    .select()
    .from(cashDeposits)
    .where(eq(cashDeposits.id, parsed.data.id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Setoran tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Setoran dari outlet lain");
  }
  if (current.status !== "verified") {
    return fail(
      "INVALID_STATE",
      "Hanya setoran verified yang bisa di-revert ke pending",
    );
  }

  const [row] = await db
    .update(cashDeposits)
    .set({
      status: "pending_verification",
      verifiedBy: null,
      verifiedAt: null,
      // Pakai notes (existing column) untuk track revert reason — append.
      notes: current.notes
        ? `${current.notes}\n[REVERTED ${new Date().toISOString().slice(0, 10)}]: ${parsed.data.reason}`
        : `[REVERTED ${new Date().toISOString().slice(0, 10)}]: ${parsed.data.reason}`,
      updatedAt: new Date(),
    })
    .where(eq(cashDeposits.id, parsed.data.id))
    .returning();

  logAudit({
    eventType: "cash_deposit.unverify",
    userId: session.user.id,
    entityType: "cash_deposit",
    entityId: row.id,
    payload: {
      summary: `Setoran ${row.bankDestination} Rp ${row.amount.toLocaleString("id-ID")} di-revert ke pending: ${parsed.data.reason}`,
      before: { status: "verified" },
      after: { status: "pending_verification" },
      context: { reason: parsed.data.reason },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit cash_deposit.unverify]", e));

  // Fire reverse journal entry. Hook handle: bank account reversal +
  // journal source linked to original cashDeposit id (mark reversed).
  // Best-effort; revert sukses walau journal hook fail (caught in fireJournalHook).
  {
    const { fireJournalHook, postJournalForCashDepositUnverified } = await import(
      "@/features/accounting/hooks"
    );
    let bankAccountCode: string | null = null;
    if (row.bankAccountId) {
      const [bankAcc] = await db
        .select({ code: chartOfAccounts.code })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.id, row.bankAccountId))
        .limit(1);
      bankAccountCode = bankAcc?.code ?? null;
    }
    fireJournalHook(
      () =>
        postJournalForCashDepositUnverified({
          outletId: session.user.outletId,
          cashDepositId: row.id,
          amount: Number(row.amount),
          bankAccountCode,
          bankDestination: row.bankDestination,
          entryDate: new Date().toISOString().slice(0, 10),
          referenceNo: row.referenceNo,
          reason: parsed.data.reason,
          actorId: session.user.id,
        }),
      "cash_deposit_unverified",
    );
  }

  return ok(row);
}

// ---------- Aggregator Settlement mutations ----------

export async function createAggregatorSettlement(
  input: CreateAggregatorSettlementInput,
): Promise<ApiResult<AggregatorSettlement>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "aggregator_settlement.create")) {
    return fail("FORBIDDEN", "Tidak punya hak input settlement");
  }
  const parsed = createAggregatorSettlementSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }
  const v = parsed.data;
  const net = v.grossAmount - v.feeAmount;

  /* Sesi AE-77 — line items (optional dari CSV import) stored di JSONB
   * column. UI drilldown lookup line_items[] untuk lihat per-order detail. */
  const lineItemsArr =
    v.lineItems && v.lineItems.length > 0 ? v.lineItems : null;
  const [row] = await db
    .insert(aggregatorSettlements)
    .values({
      outletId: session.user.outletId,
      channel: v.channel,
      periodFrom: v.periodFrom,
      periodTo: v.periodTo,
      grossAmount: v.grossAmount,
      feeAmount: v.feeAmount,
      netAmount: net,
      bankCreditedAt: v.bankCreditedAt ?? null,
      bankAccountId: v.bankAccountId ?? null,
      referenceNo: v.referenceNo ?? null,
      notes: v.notes ?? null,
      lineItems: lineItemsArr,
      lineItemsCount: lineItemsArr ? lineItemsArr.length : null,
      createdBy: session.user.id,
    })
    .returning();

  logAudit({
    eventType: "aggregator_settlement.create",
    userId: session.user.id,
    entityType: "aggregator_settlement",
    entityId: row.id,
    payload: {
      summary: `Settlement ${v.channel} Rp ${row.grossAmount.toLocaleString("id-ID")} (${v.periodFrom} → ${v.periodTo})`,
      after: row,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit aggregator_settlement.create]", e));

  // Sesi T — Accounting auto-journal hook (settlement create). Channel-aware:
  // QRIS/EDC clear piutang; GoFood/Grab/Shopee recognize revenue ke 4104.
  {
    const { fireJournalHook, postJournalForAggregatorSettlement } = await import(
      "@/features/accounting/hooks"
    );
    let bankAccountCode: string | null = null;
    if (row.bankAccountId) {
      const [bankAcc] = await db
        .select({ code: chartOfAccounts.code })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.id, row.bankAccountId))
        .limit(1);
      bankAccountCode = bankAcc?.code ?? null;
    }
    const entryDate = row.bankCreditedAt
      ? new Date(row.bankCreditedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    fireJournalHook(
      () =>
        postJournalForAggregatorSettlement({
          outletId: session.user.outletId,
          settlementId: row.id,
          channel: row.channel as
            | "edc_bca"
            | "gofood"
            | "grabfood"
            | "shopeefood"
            | "qris",
          grossAmount: Number(row.grossAmount),
          feeAmount: Number(row.feeAmount),
          netAmount: Number(row.netAmount),
          bankAccountCode,
          periodFrom: String(row.periodFrom),
          periodTo: String(row.periodTo),
          entryDate,
          referenceNo: row.referenceNo,
          actorId: session.user.id,
        }),
      "aggregator_settlement",
    );
  }

  return ok(row);
}

export async function updateAggregatorSettlement(
  input: UpdateAggregatorSettlementInput,
): Promise<ApiResult<AggregatorSettlement>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "aggregator_settlement.create")) {
    return fail("FORBIDDEN", "Tidak punya hak edit settlement");
  }
  const parsed = updateAggregatorSettlementSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid");
  }
  const v = parsed.data;
  const [current] = await db
    .select()
    .from(aggregatorSettlements)
    .where(eq(aggregatorSettlements.id, v.id))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Settlement tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Settlement dari outlet lain");
  }
  const next = {
    channel: v.channel ?? current.channel,
    periodFrom: v.periodFrom ?? current.periodFrom,
    periodTo: v.periodTo ?? current.periodTo,
    grossAmount: v.grossAmount ?? current.grossAmount,
    feeAmount: v.feeAmount ?? current.feeAmount,
    bankCreditedAt:
      v.bankCreditedAt !== undefined
        ? v.bankCreditedAt
          ? new Date(v.bankCreditedAt as Date | string)
          : null
        : current.bankCreditedAt,
    referenceNo: v.referenceNo ?? current.referenceNo,
    notes: v.notes ?? current.notes,
  };
  if (next.periodTo < next.periodFrom) {
    return fail("VALIDATION", "Periode akhir harus >= awal");
  }
  if (next.feeAmount > next.grossAmount) {
    return fail("VALIDATION", "Fee tidak boleh > gross");
  }
  const netAmount = next.grossAmount - next.feeAmount;

  const [row] = await db
    .update(aggregatorSettlements)
    .set({
      ...next,
      netAmount,
      updatedAt: new Date(),
    })
    .where(eq(aggregatorSettlements.id, v.id))
    .returning();

  logAudit({
    eventType: "aggregator_settlement.update",
    userId: session.user.id,
    entityType: "aggregator_settlement",
    entityId: row.id,
    payload: {
      summary: `Update settlement ${row.channel}`,
      before: current,
      after: row,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit aggregator_settlement.update]", e));

  return ok(row);
}

// Re-export for symmetry with other features that also expose getOutletThreshold.
export { getOutletThreshold };

/* ============================================================================
 * Sesi AE-56 — Reconciliation drill-down + status workflow
 * ========================================================================== */

const RECONCILIATION_CHANNELS: AggregatorChannel[] = [
  "cash",
  "edc_bca",
  "qris",
  "gofood",
  "grabfood",
  "shopeefood",
];
const RECONCILIATION_STATUSES = [
  "open",
  "investigating",
  "resolved",
  "disputed",
] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchReconciliationDrillDownAction(
  channel: AggregatorChannel,
  fromDate: string,
  toDate: string,
): Promise<ApiResult<ReconciliationDrillDown>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "aggregator_settlement.view")) {
    return fail("FORBIDDEN", "Tidak punya akses drill-down rekonsiliasi");
  }
  if (!RECONCILIATION_CHANNELS.includes(channel)) {
    return fail("VALIDATION", "Channel tidak valid");
  }
  if (!ISO_DATE_RE.test(fromDate) || !ISO_DATE_RE.test(toDate)) {
    return fail("VALIDATION", "Tanggal harus YYYY-MM-DD");
  }
  if (fromDate > toDate) {
    return fail("VALIDATION", "Tanggal mulai > tanggal selesai");
  }
  const data = await fetchReconciliationDrillDown(
    session.user.outletId,
    channel,
    fromDate,
    toDate,
  );
  return ok(data);
}

export async function setReconciliationStatus(
  input: SetReconciliationStatusInput,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "reconciliation.update")) {
    return fail("FORBIDDEN", "Tidak punya akses set status rekonsiliasi");
  }
  if (!RECONCILIATION_CHANNELS.includes(input.channel)) {
    return fail("VALIDATION", "Channel tidak valid");
  }
  if (!RECONCILIATION_STATUSES.includes(input.status)) {
    return fail("VALIDATION", "Status tidak valid");
  }
  if (!ISO_DATE_RE.test(input.periodDate)) {
    return fail("VALIDATION", "Tanggal harus YYYY-MM-DD");
  }
  const trimmedNote = input.note ? input.note.trim().slice(0, 2000) : null;

  // Upsert: existing row by (outletId, channel, periodDate) → update; else insert
  const [existing] = await db
    .select()
    .from(reconciliationNotes)
    .where(
      and(
        eq(reconciliationNotes.outletId, session.user.outletId),
        eq(reconciliationNotes.channel, input.channel),
        eq(reconciliationNotes.periodDate, input.periodDate),
      ),
    )
    .limit(1);

  const isResolved = input.status === "resolved";
  const now = new Date();

  let rowId: string;
  if (existing) {
    const [updated] = await db
      .update(reconciliationNotes)
      .set({
        status: input.status,
        note: trimmedNote,
        resolvedBy: isResolved ? session.user.id : existing.resolvedBy,
        resolvedAt: isResolved ? now : existing.resolvedAt,
        updatedAt: now,
      })
      .where(eq(reconciliationNotes.id, existing.id))
      .returning({ id: reconciliationNotes.id });
    rowId = updated.id;

    logAudit({
      eventType: "reconciliation.update",
      userId: session.user.id,
      entityType: "reconciliation_note",
      entityId: rowId,
      payload: {
        summary: `Set status ${input.channel} ${input.periodDate} → ${input.status}`,
        before: {
          status: existing.status,
          note: existing.note,
        },
        after: {
          status: input.status,
          note: trimmedNote,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit reconciliation.update]", e));
  } else {
    const [created] = await db
      .insert(reconciliationNotes)
      .values({
        outletId: session.user.outletId,
        channel: input.channel,
        periodDate: input.periodDate,
        status: input.status,
        note: trimmedNote,
        resolvedBy: isResolved ? session.user.id : null,
        resolvedAt: isResolved ? now : null,
        createdBy: session.user.id,
      })
      .returning({ id: reconciliationNotes.id });
    rowId = created.id;

    logAudit({
      eventType: "reconciliation.update",
      userId: session.user.id,
      entityType: "reconciliation_note",
      entityId: rowId,
      payload: {
        summary: `Buat status ${input.channel} ${input.periodDate}: ${input.status}`,
        after: {
          status: input.status,
          note: trimmedNote,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit reconciliation.update]", e));
  }

  return ok({ id: rowId });
}
