import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chartOfAccounts,
  expenseCategories,
  expenses,
  journalEntries,
  transactionItems,
  transactions,
  splitPayments,
} from "@/db/schema";
import { isAutoJournalEnabled } from "./flag";
import { recordJournal } from "./posting";
import {
  findInvalidSplitMethods,
  formatInvalidSplitMethodsError,
} from "./split-validation";
import {
  mapAggregatorSettlement,
  mapCashDepositUnverified,
  mapCashDepositVerified,
  mapExpenseCreate,
  mapIncomeCreate,
  mapOpnameAdjustment,
  mapPayrollPaid,
  mapPosCompliment,
  mapPosRefund,
  mapPosSale,
  mapPurchaseCancel,
  mapPurchaseCreate,
  mapPurchasePay,
  mapShiftVariance,
  mapShiftVarianceReversal,
  resolveBankCodeFromDestination,
  type AggregatedItem,
  type AggregatorChannel,
  type ExpensePaymentMethod,
  type IncomePaymentMethod,
  type IngredientSection,
  type OpnameSectionDiff,
  type PurchasePaymentMethod,
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
  const VALID_SETTLE_METHODS = [
    "cash",
    "qris",
    "card_bca",
    "card_bni",
    "card_mandiri",
    "card_bri",
    "card_other",
  ] as const;
  type SettleMethod = (typeof VALID_SETTLE_METHODS)[number];

  let splitsInput: { paymentMethod: SettleMethod; amount: number }[] | undefined;
  if (trx.paymentMethod === "split") {
    const splits = await db
      .select()
      .from(splitPayments)
      .where(eq(splitPayments.transactionId, args.transactionId));
    /* Sesi AE-47 (audit Tier 2) — dulu pakai filter silent yang drop row
     * dengan paymentMethod tidak dikenali (mis. "split" nested, atau
     * future enum extension yang belum di-update di hooks). Effect:
     * journal kehilangan amount → GL silently undercounted → owner
     * gak tahu. Sekarang explicit validate: throw kalau ada row
     * dengan method invalid → fireJournalHook (AE-46) catch + audit log
     * `journal.posting_failed` → owner visibility di Back Office. */
    const invalidRows = findInvalidSplitMethods(splits, VALID_SETTLE_METHODS);
    if (invalidRows.length > 0) {
      throw new Error(
        formatInvalidSplitMethodsError(
          invalidRows,
          `pos_sale ${args.transactionId.slice(0, 8)}`,
        ),
      );
    }
    splitsInput = splits.map((s) => ({
      paymentMethod: s.paymentMethod as SettleMethod,
      amount: Number(s.amount),
    }));
  }

  const lines = mapPosSale({
    transactionId: trx.id,
    transactionNumber: trx.transactionNumber,
    outletId: trx.outletId,
    entryDate,
    paymentMethod: trx.paymentMethod as SettleMethod | "split",
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
      const VALID_REFUND_METHODS = [
        "cash",
        "qris",
        "card_bca",
        "card_bni",
        "card_mandiri",
        "card_bri",
        "card_other",
      ] as const;
      type RefundMethod = (typeof VALID_REFUND_METHODS)[number];
      /* Sesi AE-47 — same fix as postJournalForPosSale: explicit
       * validation supaya invalid split row tidak silently di-drop
       * dari refund journal (akan bikin refund total != journal total). */
      const invalidRefundRows = findInvalidSplitMethods(
        splits,
        VALID_REFUND_METHODS,
      );
      if (invalidRefundRows.length > 0) {
        throw new Error(
          formatInvalidSplitMethodsError(
            invalidRefundRows,
            `pos_refund ${args.transactionId.slice(0, 8)}`,
          ),
        );
      }
      const allocs = splits.map((s, idx, arr) => {
        const isLast = idx === arr.length - 1;
        const amt = isLast
          ? args.refundedAmount - allocated
          : Math.round(
              (Number(s.amount) / splitTotal) * args.refundedAmount,
            );
        allocated += amt;
        return {
          paymentMethod: s.paymentMethod as RefundMethod,
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
      | "card_bni"
      | "card_mandiri"
      | "card_bri"
      | "card_other"
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

/**
 * Sesi AE-62j — postJournalForPosVoid: reverse journal untuk void
 * transaction. Sebelumnya voidTransaction NEVER post reverse journal →
 * GL drift forever (sale posted Dr Kas/Cr Revenue, void cuma flip
 * transactions.status → Kas account overstated permanently).
 *
 * Reuse mapPosRefund dengan refundedAmount = transaction.total dan
 * reverseCogs = true (void = full reversal termasuk COGS + inventory).
 * sourceType="pos_void" + sourceId=transactionId untuk distinct dari
 * partial refund yang pakai refund_event.id.
 */
export async function postJournalForPosVoid(args: {
  outletId: string;
  transactionId: string;
  /** Items untuk reverse COGS (sama format dengan refund). */
  items?: AggregatedItem[];
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
    const splitTotal = splits.reduce((s, sp) => s + Number(sp.amount), 0);
    if (splitTotal > 0) {
      const VALID_REFUND_METHODS = [
        "cash",
        "qris",
        "card_bca",
        "card_bni",
        "card_mandiri",
        "card_bri",
        "card_other",
      ] as const;
      type RefundMethod = (typeof VALID_REFUND_METHODS)[number];
      const invalidRefundRows = findInvalidSplitMethods(
        splits,
        VALID_REFUND_METHODS,
      );
      if (invalidRefundRows.length > 0) {
        throw new Error(
          formatInvalidSplitMethodsError(
            invalidRefundRows,
            `pos_void ${args.transactionId.slice(0, 8)}`,
          ),
        );
      }
      splitsInput = splits.map((s) => ({
        paymentMethod: s.paymentMethod as RefundMethod,
        amount: Number(s.amount),
      }));
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
      | "card_bni"
      | "card_mandiri"
      | "card_bri"
      | "card_other"
      | "split",
    refundedAmount: trx.total,
    splits: splitsInput,
    items: args.items,
    reverseCogs: true,
  });

  await recordJournal({
    outletId: trx.outletId,
    entryDate: args.entryDate ?? jakartaDateOf(new Date()),
    description: `Void TRX ${trx.transactionNumber}`,
    sourceType: "pos_void",
    sourceId: args.transactionId,
    lines,
    actorId: args.actorId,
    metadata: {
      transactionId: trx.id,
      voidedAmount: trx.total,
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
  totalBaseSalary: number;
  totalOvertimePay: number;
  totalBonus: number;
  totalDeductions: number;
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
    totalBaseSalary: args.totalBaseSalary,
    totalOvertimePay: args.totalOvertimePay,
    totalBonus: args.totalBonus,
    totalDeductions: args.totalDeductions,
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

/**
 * Sesi AE-62h — reverse journal untuk unverify deposit. Posts inverse
 * entry (Dr Kas / Cr Bank) dengan sourceId yang sama (cashDepositId) +
 * sourceType "cash_deposit_unverified" untuk distinct lookup.
 */
export async function postJournalForCashDepositUnverified(args: {
  outletId: string;
  cashDepositId: string;
  amount: number;
  bankAccountCode: string | null;
  bankDestination: string;
  entryDate: string;
  referenceNo?: string | null;
  reason: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const code = args.bankAccountCode ?? resolveBankCodeFromDestination(args.bankDestination);

  const lines = mapCashDepositUnverified({
    cashDepositId: args.cashDepositId,
    outletId: args.outletId,
    entryDate: args.entryDate,
    amount: args.amount,
    bankAccountCode: code,
    bankDestinationLabel: args.bankDestination,
    referenceNo: args.referenceNo,
    reason: args.reason,
  });

  const result = await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `REVERT setoran ke ${args.bankDestination}: ${args.reason}`,
    sourceType: "cash_deposit_unverified",
    sourceId: args.cashDepositId,
    lines,
    actorId: args.actorId,
  });

  // Sesi AE-62j — mark original verified entry sebagai 'reversed' supaya:
  // (1) idempotency check di re-verify nanti skip ke "create new entry"
  //     (kalau status='posted' tetap, re-verify silent return cached entry
  //      yang sudah tidak valid)
  // (2) audit trail link unverify ↔ original via reversedByEntryId
  await db
    .update(journalEntries)
    .set({
      status: "reversed",
      reversedByEntryId: result.entryId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(journalEntries.outletId, args.outletId),
        eq(journalEntries.sourceType, "cash_deposit_verified"),
        eq(journalEntries.sourceId, args.cashDepositId),
        sql`${journalEntries.status} = 'posted'`,
      ),
    );
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
 * Sesi AE-62o — postJournalForShiftRebalance: handle reverse + new entry
 * pair saat owner approve rebalancing.
 *
 * Workflow:
 *   1. Kalau originalVariance != 0 → post reverse entry (sourceType
 *      "shift_variance_reversal", sourceId = shiftRebalances.id)
 *   2. Kalau correctedVariance != 0 → post new shift_variance entry
 *      (sourceType "shift_variance", sourceId = shiftId — TAPI sudah
 *      ada existing entry, jadi pakai shiftRebalanceId sebagai sourceId
 *      untuk distinct)
 *   3. Mark original entry status='reversed' + link reversedByEntryId
 *      (mirror sesi AE-62h cash_deposit_unverified pattern)
 *
 * Returns both entry IDs supaya caller bisa link ke shift_rebalances row
 * untuk audit trail.
 */
export async function postJournalForShiftRebalance(args: {
  outletId: string;
  shiftId: string;
  shiftRebalanceId: string;
  shiftLabel: string;
  originalVariance: number;
  correctedVariance: number;
  reason: string;
  entryDate: string;
  actorId: string;
}): Promise<{ reverseEntryId: string | null; correctedEntryId: string | null }> {
  if (!(await isAutoJournalEnabled(args.outletId))) {
    return { reverseEntryId: null, correctedEntryId: null };
  }

  let reverseEntryId: string | null = null;
  let correctedEntryId: string | null = null;

  // Step 1: reverse original kalau != 0
  if (args.originalVariance !== 0) {
    const reverseLines = mapShiftVarianceReversal({
      shiftId: args.shiftId,
      shiftLabel: args.shiftLabel,
      outletId: args.outletId,
      entryDate: args.entryDate,
      variance: args.originalVariance,
      reason: args.reason,
    });
    if (reverseLines.length > 0) {
      const result = await recordJournal({
        outletId: args.outletId,
        entryDate: args.entryDate,
        description: `REVERSE selisih kas ${args.shiftLabel}: ${args.reason}`,
        sourceType: "shift_variance_reversal",
        sourceId: args.shiftRebalanceId,
        lines: reverseLines,
        actorId: args.actorId,
      });
      reverseEntryId = result.entryId;

      // Mark original entry as reversed.
      await db
        .update(journalEntries)
        .set({
          status: "reversed",
          reversedByEntryId: result.entryId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(journalEntries.outletId, args.outletId),
            eq(journalEntries.sourceType, "shift_variance"),
            eq(journalEntries.sourceId, args.shiftId),
            sql`${journalEntries.status} = 'posted'`,
          ),
        );
    }
  }

  // Step 2: post new entry sesuai correctedVariance kalau != 0.
  // sourceId = shiftRebalanceId (not shiftId) untuk distinct dari original.
  if (args.correctedVariance !== 0) {
    const newLines = mapShiftVariance({
      shiftId: args.shiftId,
      shiftLabel: `${args.shiftLabel} (REBALANCED)`,
      outletId: args.outletId,
      entryDate: args.entryDate,
      variance: args.correctedVariance,
    });
    if (newLines.length > 0) {
      const result = await recordJournal({
        outletId: args.outletId,
        entryDate: args.entryDate,
        description: `Selisih kas REBALANCED ${args.shiftLabel} (${args.correctedVariance > 0 ? "+" : ""}${args.correctedVariance}): ${args.reason}`,
        sourceType: "shift_variance",
        sourceId: args.shiftRebalanceId,
        lines: newLines,
        actorId: args.actorId,
      });
      correctedEntryId = result.entryId;
    }
  }

  return { reverseEntryId, correctedEntryId };
}

// ============================================================
// Purchase (Sesi U)
// ============================================================

export async function postJournalForPurchaseCreate(args: {
  outletId: string;
  purchaseId: string;
  purchaseLabel: string;
  paymentMethod: PurchasePaymentMethod;
  total: number;
  /** Per-line aggregated by section. */
  lines: { section: IngredientSection; amount: number }[];
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const lines = mapPurchaseCreate({
    purchaseId: args.purchaseId,
    purchaseLabel: args.purchaseLabel,
    outletId: args.outletId,
    entryDate: args.entryDate,
    paymentMethod: args.paymentMethod,
    lines: args.lines,
    total: args.total,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Pembelian ${args.purchaseLabel}`,
    sourceType: "purchase_create",
    sourceId: args.purchaseId,
    lines,
    actorId: args.actorId,
  });
}

export async function postJournalForPurchasePay(args: {
  outletId: string;
  purchaseId: string;
  purchaseLabel: string;
  paymentMethod: "cash" | "transfer_bca" | "transfer_bri" | "transfer_other";
  total: number;
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const lines = mapPurchasePay({
    purchaseId: args.purchaseId,
    purchaseLabel: args.purchaseLabel,
    outletId: args.outletId,
    entryDate: args.entryDate,
    paymentMethod: args.paymentMethod,
    total: args.total,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Bayar hutang ${args.purchaseLabel}`,
    sourceType: "purchase_pay",
    sourceId: args.purchaseId,
    lines,
    actorId: args.actorId,
  });
}

export async function postJournalForPurchaseCancel(args: {
  outletId: string;
  purchaseId: string;
  purchaseLabel: string;
  paymentMethod: PurchasePaymentMethod;
  total: number;
  lines: { section: IngredientSection; amount: number }[];
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const lines = mapPurchaseCancel({
    purchaseId: args.purchaseId,
    purchaseLabel: args.purchaseLabel,
    outletId: args.outletId,
    entryDate: args.entryDate,
    paymentMethod: args.paymentMethod,
    lines: args.lines,
    total: args.total,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Cancel pembelian ${args.purchaseLabel}`,
    sourceType: "purchase_cancel",
    sourceId: args.purchaseId,
    lines,
    actorId: args.actorId,
  });
}

// ============================================================
// Expense (Sesi U) — manual sourceType only
// ============================================================

/**
 * Resolve expense account code:
 * 1. Caller passes accountId via expenses.accountId
 * 2. Else fallback ke expense_categories.defaultAccountId
 * 3. Else final fallback ke 6901 Lain-lain
 *
 * Returns the resolved account.code untuk passing ke mapping.
 */
export async function resolveExpenseAccountCode(
  outletId: string,
  expenseAccountId: string | null,
  categoryId: string,
): Promise<string> {
  // Priority 1: per-expense override
  if (expenseAccountId) {
    const [acc] = await db
      .select({ code: chartOfAccounts.code })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.id, expenseAccountId))
      .limit(1);
    if (acc?.code) return acc.code;
  }

  // Priority 2: category default
  const [cat] = await db
    .select({ defaultAccountId: expenseCategories.defaultAccountId })
    .from(expenseCategories)
    .where(eq(expenseCategories.id, categoryId))
    .limit(1);
  if (cat?.defaultAccountId) {
    const [acc] = await db
      .select({ code: chartOfAccounts.code })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.id, cat.defaultAccountId))
      .limit(1);
    if (acc?.code) return acc.code;
  }

  // Priority 3: ultimate fallback
  return "6901";
}

export async function postJournalForExpenseCreate(args: {
  outletId: string;
  expenseId: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const [exp] = await db
    .select()
    .from(expenses)
    .where(eq(expenses.id, args.expenseId))
    .limit(1);
  if (!exp) return;

  // CRITICAL — only fires for sourceType='manual'. Payroll/purchase/refund
  // expenses have their own auto-journal hooks upstream (markPayrollPaid /
  // purchase.confirm / refundTransaction), so skipping here prevents
  // double-counting.
  if (exp.sourceType !== "manual") return;

  const expenseAccountCode = await resolveExpenseAccountCode(
    args.outletId,
    exp.accountId,
    exp.categoryId,
  );

  const lines = mapExpenseCreate({
    expenseId: exp.id,
    outletId: args.outletId,
    entryDate: String(exp.expenseDate),
    amount: Number(exp.amount),
    description: exp.description,
    paymentMethod: exp.paymentMethod as ExpensePaymentMethod,
    expenseAccountCode,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: String(exp.expenseDate),
    description: exp.description,
    sourceType: "expense_create",
    sourceId: exp.id,
    lines,
    actorId: args.actorId,
    metadata: {
      categoryId: exp.categoryId,
      paymentMethod: exp.paymentMethod,
      expenseAccountCode,
    },
  });
}

// ============================================================
// Income (Sesi U)
// ============================================================

export async function postJournalForIncomeCreate(args: {
  outletId: string;
  incomeId: string;
  amount: number;
  description: string;
  paymentMethod: IncomePaymentMethod;
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const lines = mapIncomeCreate({
    incomeId: args.incomeId,
    outletId: args.outletId,
    entryDate: args.entryDate,
    amount: args.amount,
    description: args.description,
    paymentMethod: args.paymentMethod,
  });

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Pemasukan: ${args.description}`,
    sourceType: "income_create",
    sourceId: args.incomeId,
    lines,
    actorId: args.actorId,
  });
}

// ============================================================
// Opname Adjustment (Sesi U)
// ============================================================

export async function postJournalForOpnameAdjustment(args: {
  outletId: string;
  opnameSessionId: string;
  sessionLabel: string;
  /** Caller aggregates per-line diff_value × unit_cost grouped by section. */
  sectionDiffs: OpnameSectionDiff[];
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const lines = mapOpnameAdjustment({
    opnameSessionId: args.opnameSessionId,
    outletId: args.outletId,
    entryDate: args.entryDate,
    sessionLabel: args.sessionLabel,
    sectionDiffs: args.sectionDiffs,
  });

  if (lines.length === 0) return;

  await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `Penyesuaian opname ${args.sessionLabel}`,
    sourceType: "opname_adjustment",
    sourceId: args.opnameSessionId,
    lines,
    actorId: args.actorId,
  });
}

/**
 * Generic safe-fire wrapper. All hooks are best-effort; errors logged but
 * don't propagate. Caller should NOT await with await — wrap in this and
 * detach from main flow.
 *
 * Sesi AE-46 — selain console.error, write ke audit log
 * `journal.posting_failed` supaya owner dapat visibility di Back Office
 * tanpa harus check Vercel runtime logs. Detail tersimpan di payload
 * (label = sourceType, context.sourceId = ID kalau bisa di-extract, raw
 * error message). Audit log juga survive cold start (DB-backed). Future
 * enhancement: Back Office action "Re-trigger failed journal posts".
 *
 * @param fn       — async function yang panggil postJournalForXxx
 * @param label    — sourceType (mis. "purchase_create", "pos_sale")
 * @param context  — optional metadata buat traceability (sourceId, outletId)
 */
export function fireJournalHook(
  fn: () => Promise<void>,
  label: string,
  context?: {
    sourceId?: string;
    outletId?: string;
    actorId?: string;
  },
): void {
  fn().catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error(`[journal:${label}] ${msg}`);

    // Audit log buat owner visibility. Defensive: catch + console kalau
    // audit itu sendiri gagal (rare — DB down). Hindari infinite loop:
    // logAudit failure tidak fire-journal-hook.
    try {
      const { logAudit } = await import("@/lib/audit/logger");
      await logAudit({
        eventType: "journal.posting_failed",
        userId: context?.actorId ?? null,
        entityType: "journal_entry",
        entityId: context?.sourceId ?? null,
        payload: {
          summary: `🚨 Journal post gagal: ${label} — ${msg}`,
          context: {
            sourceType: label,
            sourceId: context?.sourceId,
            rawError: msg,
            stackPreview: stack?.split("\n").slice(0, 5).join("\n"),
          },
        },
        metadata: context?.outletId
          ? { outletId: context.outletId, actorRole: "system" }
          : { actorRole: "system" },
      });
    } catch (auditErr) {
      console.error(`[journal:${label}] audit log failure`, auditErr);
    }
  });
}
