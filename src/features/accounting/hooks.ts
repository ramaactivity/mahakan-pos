import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactionItems, transactions, splitPayments } from "@/db/schema";
import { isAutoJournalEnabled } from "./flag";
import { recordJournal } from "./posting";
import {
  mapAggregatorSettlement,
  mapCashDepositVerified,
  mapPayrollPaid,
  mapPosCompliment,
  mapPosRefund,
  mapPosSale,
  mapShiftVariance,
  resolveBankCodeFromDestination,
  type AggregatedItem,
  type AggregatorChannel,
} from "./mapping";

/**
 * Sesi T — high-level hook wrappers used by source actions (createTransaction,
 * refundTransaction, markPayrollPaid, verifyCashDeposit, createAggregator-
 * Settlement, closeShift).
 *
 * Pattern:
 *   1. Check feature flag → no-op if OFF
 *   2. Fetch source row + dependents (items / splits / etc)
 *   3. Build mapping input
 *   4. Map → journal lines
 *   5. recordJournal (idempotent per sourceType+sourceId)
 *
 * All wrappers are FIRE-AND-FORGET: source action commits first, then journal
 * runs async. Errors logged but don't fail the source action. This protects
 * POS continuity at cost of potential ledger drift (Owner-monitored, future
 * catch-up job possible).
 *
 * Idempotency built into recordJournal — safe to re-run, returns existing
 * entry without dup.
 */

function jakartaDateOf(d: Date): string {
  // WIB UTC+7 no DST
  const j = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}

// ============================================================
// POS Sale (incl. Compliment branch)
// ============================================================

export async function postJournalForPosSale(args: {
  outletId: string;
  transactionId: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const [trx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, args.transactionId))
    .limit(1);
  if (!trx) return;
  if (trx.status !== "paid") return;

  const items = await db
    .select()
    .from(transactionItems)
    .where(eq(transactionItems.transactionId, args.transactionId));

  const aggItems: AggregatedItem[] = items.map((it) => ({
    itemCategoryName: it.itemCategoryName,
    amount: Number(it.subtotal),
    cogs: Number(it.cogs ?? 0),
  }));

  const isCompliment = (trx.discountReason ?? "").startsWith("Compliment:");
  const entryDate = jakartaDateOf(new Date(trx.createdAt));

  if (isCompliment) {
    const lines = mapPosCompliment({
      transactionId: trx.id,
      transactionNumber: trx.transactionNumber,
      outletId: trx.outletId,
      entryDate,
      items: aggItems,
    });
    if (lines.length === 0) {
      console.warn(
        `[journal:compliment] TRX ${trx.transactionNumber} skipped — no COGS attribution. Review recipe data.`,
      );
      return;
    }
    await recordJournal({
      outletId: trx.outletId,
      entryDate,
      description: `Compliment TRX ${trx.transactionNumber}`,
      sourceType: "pos_compliment",
      sourceId: trx.id,
      lines,
      actorId: args.actorId,
    });
    return;
  }

  // Regular POS sale
  let splitsInput: { paymentMethod: "cash" | "qris" | "card_bca"; amount: number }[] | undefined;
  if (trx.paymentMethod === "split") {
    const splits = await db
      .select()
      .from(splitPayments)
      .where(eq(splitPayments.transactionId, args.transactionId));
    splitsInput = splits
      .filter((s) =>
        ["cash", "qris", "card_bca"].includes(s.paymentMethod ?? ""),
      )
      .map((s) => ({
        paymentMethod: s.paymentMethod as "cash" | "qris" | "card_bca",
        amount: Number(s.amount),
      }));
  }

  const lines = mapPosSale({
    transactionId: trx.id,
    transactionNumber: trx.transactionNumber,
    outletId: trx.outletId,
    entryDate,
    paymentMethod: trx.paymentMethod as "cash" | "qris" | "card_bca" | "split",
    total: Number(trx.total),
    subtotal: Number(trx.subtotal),
    discountAmount: Number(trx.discountAmount ?? 0),
    items: aggItems,
    splits: splitsInput,
  });

  await recordJournal({
    outletId: trx.outletId,
    entryDate,
    description: `Penjualan TRX ${trx.transactionNumber} (${trx.paymentMethod})`,
    sourceType: "pos_sale",
    sourceId: trx.id,
    lines,
    actorId: args.actorId,
    metadata: {
      paymentMethod: trx.paymentMethod,
      total: trx.total,
      itemCount: items.length,
    },
  });
}

// ============================================================
// POS Refund
// ============================================================

export async function postJournalForPosRefund(args: {
  outletId: string;
  transactionId: string;
  /** Per refund event id — supports partial refunds (each event = own journal). */
  refundEventId: string;
  refundedAmount: number;
  /** Items refunded per event with cogs (untuk optional reverse). */
  items?: AggregatedItem[];
  reverseCogs?: boolean;
  actorId: string;
  entryDate?: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const [trx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, args.transactionId))
    .limit(1);
  if (!trx) return;

  let splitsInput;
  if (trx.paymentMethod === "split") {
    const splits = await db
      .select()
      .from(splitPayments)
      .where(eq(splitPayments.transactionId, args.transactionId));
    // Refund mengikuti proporsi original split. Untuk simple-flow Phase R,
    // pakai ratio dari original split → derive amount per method.
    const splitTotal = splits.reduce((s, sp) => s + Number(sp.amount), 0);
    if (splitTotal > 0) {
      let allocated = 0;
      const allocs = splits
        .filter((s) =>
          ["cash", "qris", "card_bca"].includes(s.paymentMethod ?? ""),
        )
        .map((s, idx, arr) => {
          const isLast = idx === arr.length - 1;
          const amt = isLast
            ? args.refundedAmount - allocated
            : Math.round(
                (Number(s.amount) / splitTotal) * args.refundedAmount,
              );
          allocated += amt;
          return {
            paymentMethod: s.paymentMethod as "cash" | "qris" | "card_bca",
            amount: amt,
          };
        });
      splitsInput = allocs;
    }
  }

  const lines = mapPosRefund({
    transactionId: trx.id,
    transactionNumber: trx.transactionNumber,
    outletId: trx.outletId,
    entryDate: args.entryDate ?? jakartaDateOf(new Date()),
    originalPaymentMethod: trx.paymentMethod as
      | "cash"
      | "qris"
      | "card_bca"
      | "split",
    refundedAmount: args.refundedAmount,
    splits: splitsInput,
    items: args.items,
    reverseCogs: args.reverseCogs ?? false,
  });

  await recordJournal({
    outletId: trx.outletId,
    entryDate: args.entryDate ?? jakartaDateOf(new Date()),
    description: `Refund TRX ${trx.transactionNumber}`,
    sourceType: "pos_refund",
    sourceId: args.refundEventId,
    lines,
    actorId: args.actorId,
    metadata: {
      transactionId: trx.id,
      refundedAmount: args.refundedAmount,
    },
  });
}

// ============================================================
// Payroll Paid
// ============================================================

export async function postJournalForPayrollPaid(args: {
  outletId: string;
  payrollPeriodId: string;
  periodLabel: string;
  totalNetPay: number;
  paymentMethod: "cash" | "transfer";
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;
  if (args.totalNetPay <= 0) return;

  const lines = mapPayrollPaid({
    payrollPeriodId: args.payrollPeriodId,
    periodLabel: args.periodLabel,
    outletId: args.outletId,
    entryDate: args.entryDate,
    totalNetPay: args.totalNetPay,
    paymentMethod: args.paymentMethod,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Payroll ${args.periodLabel}`,
    sourceType: "payroll_paid",
    sourceId: args.payrollPeriodId,
    lines,
    actorId: args.actorId,
  });
}

// ============================================================
// Cash Deposit Verified
// ============================================================

export async function postJournalForCashDepositVerified(args: {
  outletId: string;
  cashDepositId: string;
  amount: number;
  bankAccountCode: string | null;
  bankDestination: string;
  entryDate: string;
  referenceNo?: string | null;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const code = args.bankAccountCode ?? resolveBankCodeFromDestination(args.bankDestination);

  const lines = mapCashDepositVerified({
    cashDepositId: args.cashDepositId,
    outletId: args.outletId,
    entryDate: args.entryDate,
    amount: args.amount,
    bankAccountCode: code,
    bankDestinationLabel: args.bankDestination,
    referenceNo: args.referenceNo,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Setoran tunai ke ${args.bankDestination}`,
    sourceType: "cash_deposit_verified",
    sourceId: args.cashDepositId,
    lines,
    actorId: args.actorId,
  });
}

// ============================================================
// Aggregator Settlement
// ============================================================

export async function postJournalForAggregatorSettlement(args: {
  outletId: string;
  settlementId: string;
  channel: AggregatorChannel;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  bankAccountCode: string | null;
  periodFrom: string;
  periodTo: string;
  entryDate: string;
  referenceNo?: string | null;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const code = args.bankAccountCode ?? "1110"; // default Bank BCA per design
  const periodLabel = `${args.periodFrom} → ${args.periodTo}`;

  const lines = mapAggregatorSettlement({
    settlementId: args.settlementId,
    outletId: args.outletId,
    entryDate: args.entryDate,
    channel: args.channel,
    grossAmount: args.grossAmount,
    feeAmount: args.feeAmount,
    netAmount: args.netAmount,
    bankAccountCode: code,
    periodLabel,
    referenceNo: args.referenceNo,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Settlement ${args.channel} ${periodLabel}`,
    sourceType: "aggregator_settlement",
    sourceId: args.settlementId,
    lines,
    actorId: args.actorId,
  });
}

// ============================================================
// Shift Variance
// ============================================================

export async function postJournalForShiftVariance(args: {
  outletId: string;
  shiftId: string;
  shiftLabel: string;
  variance: number;
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;
  if (args.variance === 0) return;

  const lines = mapShiftVariance({
    shiftId: args.shiftId,
    shiftLabel: args.shiftLabel,
    outletId: args.outletId,
    entryDate: args.entryDate,
    variance: args.variance,
  });
  if (lines.length === 0) return;

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Selisih kas ${args.shiftLabel} (${args.variance > 0 ? "+" : ""}${args.variance})`,
    sourceType: "shift_variance",
    sourceId: args.shiftId,
    lines,
    actorId: args.actorId,
  });
}

/**
 * Generic safe-fire wrapper. All hooks are best-effort; errors logged but
 * don't propagate. Caller should NOT await with await — wrap in this and
 * detach from main flow.
 */
export function fireJournalHook(
  fn: () => Promise<void>,
  label: string,
): void {
  fn().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[journal:${label}] ${msg}`);
  });
}
