import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  chartOfAccounts,
  expenseCategories,
  expenses,
  transactionItems,
  transactions,
  splitPayments,
} from "@/db/schema";
import { isAutoJournalEnabled } from "./flag";
import { recordJournal } from "./posting";
import {
  mapAggregatorSettlement,
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
    splitsInput = splits
      .filter((s) =>
        (VALID_SETTLE_METHODS as readonly string[]).includes(
          s.paymentMethod ?? "",
        ),
      )
      .map((s) => ({
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
      const allocs = splits
        .filter((s) =>
          (VALID_REFUND_METHODS as readonly string[]).includes(
            s.paymentMethod ?? "",
          ),
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
