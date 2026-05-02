"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aggregatorSettlements,
  cashDeposits,
  chartOfAccounts,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  createAggregatorSettlementSchema,
  createCashDepositSchema,
  rejectCashDepositSchema,
  updateAggregatorSettlementSchema,
  updateCashDepositSchema,
  verifyCashDepositSchema,
} from "./schemas";
import {
  getCashFlowLedger,
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
  type CashDepositStatus,
  type CashFlowLedgerReport,
  type CashOnHandSnapshot,
  type CreateAggregatorSettlementInput,
  type CreateCashDepositInput,
  type DailySettlementReport,
  type RejectCashDepositInput,
  type SettlementReconciliationReport,
  type UpdateAggregatorSettlementInput,
  type UpdateCashDepositInput,
  type VerifyCashDepositInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
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
      referenceNo: v.referenceNo ?? null,
      notes: v.notes ?? null,
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
