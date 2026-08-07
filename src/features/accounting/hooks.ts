import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { extractDbError, isTransientDbError } from "@/lib/db-error";
import { runAfterResponse } from "@/lib/after-response";
import {
  bankAccounts,
  chartOfAccounts,
  expenseCategories,
  expenses,
  incomes,
  journalEntries,
  journalLines,
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
  defaultBankCodeForChannel,
  mapCashDepositUnverified,
  mapCashDepositVerified,
  mapExpenseCreate,
  mapIncomeCreate,
  mapOpnameAdjustment,
  mapPayrollPaid,
  mapPosCompliment,
  mapPosRefund,
  mapPosSale,
  mapPosSaleCorrection,
  mapPosSaleReversal,
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

  /* Audit AE-187 — proyeksi eksplisit (jalan di SETIAP penjualan + sapuan):
   * cuma ~10 field yang dipakai, jangan tarik full row ~40 kolom. */
  const [trx] = await db
    .select({
      id: transactions.id,
      outletId: transactions.outletId,
      transactionNumber: transactions.transactionNumber,
      status: transactions.status,
      discountReason: transactions.discountReason,
      createdAt: transactions.createdAt,
      paymentMethod: transactions.paymentMethod,
      total: transactions.total,
      subtotal: transactions.subtotal,
      discountAmount: transactions.discountAmount,
    })
    .from(transactions)
    .where(eq(transactions.id, args.transactionId))
    .limit(1);
  if (!trx) return;
  /* Audit AE-186 — 'partially_refunded' juga diterima. Sapuan per jam
   * memindai status ('paid','partially_refunded'); kalau jurnal sale hilang
   * lalu transaksinya keburu di-refund sebagian, guard lama ('paid' saja)
   * membuat hook no-op diam-diam → sapuan mengira berhasil, menghitung +1
   * "dipulihkan" tiap jam selamanya, padahal gap-nya tidak pernah tertutup
   * (jurnal refund ada, jurnal sale tidak → revenue net minus). Jurnal sale
   * tetap full amount — refund punya jurnal terpisah (pos_refund). */
  if (trx.status !== "paid" && trx.status !== "partially_refunded") return;

  const items = await db
    .select({
      itemCategoryName: transactionItems.itemCategoryName,
      subtotal: transactionItems.subtotal,
      cogs: transactionItems.cogs,
    })
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
      /* Audit AE-186 — alokasi non-terakhir di-cap ke sisa yang belum
       * teralokasi. Tanpa cap, pembulatan ke atas bisa membuat jatah baris
       * terakhir NEGATIF → JOURNAL_NEGATIVE_AMOUNT dilempar di setiap retry
       * (args di-snapshot) → jurnal refund gagal permanen. */
      const allocs = splits.map((s, idx, arr) => {
        const isLast = idx === arr.length - 1;
        const remaining = args.refundedAmount - allocated;
        const amt = isLast
          ? remaining
          : Math.min(
              remaining,
              Math.round(
                (Number(s.amount) / splitTotal) * args.refundedAmount,
              ),
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

  /* Sesi AE-69 P0 FATAL FIX — pre-check original BEFORE posting REVERT.
   *
   * Bug yang ditemukan via prod (Anisa test cycle create→verify→unverify→
   * edit→reject): kalau ORIGINAL cash_deposit_verified JE sudah tidak
   * ada/sudah reversed (mis. lifecycle aneh: create→verify→unverify→edit→
   * unverify lagi), hook ini akan POST orphan REVERT JE yang TIDAK pernah
   * di-pair-void → muncul di Buku Besar sebagai phantom credit.
   *
   * Strategi: cek dulu apakah ada original posted untuk depositId ini.
   * Kalau TIDAK ADA → skip post REVERT (idempotent, no phantom entry).
   * Kalau ADA → post REVERT + pair-void keduanya (AE-64 invariant).
   *
   * Real-world prod case: JE-202605-0005 stuck posted Rp 3M ke Bank BCA,
   * jadi saldo akhir Buku Besar Bank BCA tampil −3.700.000 (kontra). */
  const [existingOriginal] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, args.outletId),
        eq(journalEntries.sourceType, "cash_deposit_verified"),
        eq(journalEntries.sourceId, args.cashDepositId),
        sql`${journalEntries.status} = 'posted'`,
      ),
    )
    .limit(1);

  if (!existingOriginal) {
    /* No active original — skip phantom REVERT. unverify still valid
     * sebagai status-flag operation, tapi tidak butuh journal post. */
    console.warn(
      `[cash_deposit_unverified] No active original verified JE for deposit ${args.cashDepositId} — skip REVERT post (sesi AE-69 P0 fix)`,
    );
    return;
  }

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
  // (3) pair-void: counter ikut di-mark reversed di bawah supaya net 0
  //     di ledger sum (lihat reverseJournalEntry comment)
  await db
    .update(journalEntries)
    .set({
      status: "reversed",
      reversedByEntryId: result.entryId,
      updatedAt: new Date(),
    })
    .where(eq(journalEntries.id, existingOriginal.id));

  /* Sesi AE-64 pair-void: counter (REVERT) juga marked reversed.
   * Sekarang aman dilakukan UNCONDITIONAL karena kita sudah pre-check
   * original ada. */
  await db
    .update(journalEntries)
    .set({
      status: "reversed",
      reversesEntryId: existingOriginal.id,
      updatedAt: new Date(),
    })
    .where(eq(journalEntries.id, result.entryId));
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

  /* Sesi AE-182 — default rekening mengikuti channel (EDC BNI → 1113,
   * EDC BRI → 1111, sisanya BCA 1110), bukan lagi selalu BCA. */
  const code = args.bankAccountCode ?? defaultBankCodeForChannel(args.channel);
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

      // Mark original entry as reversed + pair-void counter (lihat
      // reverseJournalEntry comment — kedua sisi excluded → net 0).
      const updated = await db
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
        )
        .returning({ id: journalEntries.id });

      if (updated.length > 0) {
        await db
          .update(journalEntries)
          .set({
            status: "reversed",
            reversesEntryId: updated[0].id,
            updatedAt: new Date(),
          })
          .where(eq(journalEntries.id, result.entryId));
      }
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

/**
 * Sesi AE-167 — koreksi KAS AWAL pada shift yang sudah ditutup mengubah
 * expectedCash → variance. Helper ini reverse entry selisih kas yang CURRENT
 * (posted, sourceType='shift_variance', sourceId=shiftId) lalu post entry baru
 * (sourceId=shiftId juga). Beda dari rebalance (yang pakai rebalanceId sebagai
 * sourceId baru): di sini sourceId tetap shiftId supaya koreksi BERULANG aman
 * — tiap koreksi selalu reverse posted-terbaru by shiftId. No-op kalau
 * auto-journal OFF. Fire-and-forget di caller.
 */
export async function postJournalForOpeningCashCorrection(args: {
  outletId: string;
  shiftId: string;
  shiftLabel: string;
  originalVariance: number;
  correctedVariance: number;
  reason: string;
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  // Step 1: reverse current posted shift_variance entry (by shiftId).
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
        description: `REVERSE selisih kas (koreksi kas awal) ${args.shiftLabel}: ${args.reason}`,
        sourceType: "shift_variance_reversal",
        sourceId: args.shiftId,
        lines: reverseLines,
        actorId: args.actorId,
      });
      const updated = await db
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
        )
        .returning({ id: journalEntries.id });
      if (updated.length > 0) {
        await db
          .update(journalEntries)
          .set({
            status: "reversed",
            reversesEntryId: updated[0].id,
            updatedAt: new Date(),
          })
          .where(eq(journalEntries.id, result.entryId));
      }
    }
  }

  // Step 2: post new variance entry (sourceId=shiftId) kalau != 0.
  if (args.correctedVariance !== 0) {
    const newLines = mapShiftVariance({
      shiftId: args.shiftId,
      shiftLabel: `${args.shiftLabel} (KOREKSI KAS AWAL)`,
      outletId: args.outletId,
      entryDate: args.entryDate,
      variance: args.correctedVariance,
    });
    if (newLines.length > 0) {
      await recordJournal({
        outletId: args.outletId,
        entryDate: args.entryDate,
        description: `Selisih kas (koreksi kas awal) ${args.shiftLabel} (${args.correctedVariance > 0 ? "+" : ""}${args.correctedVariance}): ${args.reason}`,
        sourceType: "shift_variance",
        sourceId: args.shiftId,
        lines: newLines,
        actorId: args.actorId,
      });
    }
  }
}

// ============================================================
// POS Transaction Correction (Sesi AE-62r)
// ============================================================

type CorrectionPaymentMethod =
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other"
  | "split";

type CorrectionSplitRow = {
  paymentMethod: Exclude<CorrectionPaymentMethod, "split">;
  amount: number;
};

/**
 * Sesi AE-62r — postJournalForTransactionCorrection: handle reverse + corrected
 * entry pair saat owner approve koreksi transaksi paid (paymentMethod/total swap).
 *
 * Workflow:
 *   1. Build mapPosSaleReversal dari original snapshot (paymentMethod, total,
 *      subtotal, discountAmount, splits) → Dr↔Cr swap revenue side, COGS lines
 *      stripped (items unchanged). sourceType='pos_sale_reversal', sourceId=correctionId.
 *   2. Mark original pos_sale entry status='reversed' + link reversedByEntryId.
 *   3. Build mapPosSaleCorrection dari corrected values (paymentMethod, total,
 *      discountAmount, splits) → revenue-only repost, COGS stripped.
 *      sourceType='pos_sale_correction', sourceId=correctionId.
 *   4. Update transaction_corrections row dengan trio journal entry IDs.
 *
 * Trap T7: COGS lines stripped supaya inventory tidak di-double-reverse.
 * Trap T8: sourceId = correctionId (BUKAN trx.id) supaya tidak collide dengan
 * original pos_sale source key (idempotency check di recordJournal would
 * return existing pos_sale entry).
 *
 * Subtotal items snapshot: items DARI transaction_items table (real-time fetch).
 * Karena items tidak berubah saat correction, snapshot fresh = snapshot original.
 *
 * Returns trio entry IDs supaya caller bisa link ke transaction_corrections row.
 */
export async function postJournalForTransactionCorrection(args: {
  outletId: string;
  transactionId: string;
  transactionNumber: string;
  correctionId: string;
  /** Snapshot original values (dari transaction_corrections.original*). */
  original: {
    paymentMethod: CorrectionPaymentMethod;
    total: number;
    subtotal: number;
    discountAmount: number;
    splits: CorrectionSplitRow[] | null;
  };
  /** Corrected values (dari transaction_corrections.corrected*). */
  corrected: {
    paymentMethod: CorrectionPaymentMethod;
    total: number;
    subtotal: number;
    discountAmount: number;
    splits: CorrectionSplitRow[] | null;
  };
  reason: string;
  /** Date untuk journal entry. Pakai trx.createdAt date (WIB) supaya entry
   * masuk ke period yang sama dengan original. */
  entryDate: string;
  actorId: string;
}): Promise<{
  reverseEntryId: string | null;
  correctedEntryId: string | null;
  originalEntryId: string | null;
}> {
  if (!(await isAutoJournalEnabled(args.outletId))) {
    return {
      reverseEntryId: null,
      correctedEntryId: null,
      originalEntryId: null,
    };
  }

  // 1. Fetch items snapshot — pakai untuk bucket aggregation (revenue per
  //    kategori). Items TIDAK berubah saat correction; sama untuk reversal
  //    & repost.
  const items = await db
    .select()
    .from(transactionItems)
    .where(eq(transactionItems.transactionId, args.transactionId));
  const aggItems: AggregatedItem[] = items.map((it) => ({
    itemCategoryName: it.itemCategoryName,
    amount: Number(it.subtotal),
    cogs: Number(it.cogs ?? 0),
  }));

  // 2. Find the entry that should be reversed.
  //
  // Sesi AE-83 — multi-koreksi support: round-1 reverses original pos_sale.
  // Round-2+ reverses the PREVIOUS pos_sale_correction entry (which is
  // the currently-active revenue entry for this trx).
  //
  // Algorithm:
  //  (a) Look for prior approved corrections for this transaction (exclude
  //      current). Latest one's correctedJournalEntryId = "active entry".
  //  (b) Fall back to original pos_sale entry kalau ini round 1.
  //
  // Original pos_sale entry juga di-fetch supaya kita selalu bisa attribute
  // `originalEntryId` ke transaction_corrections row (audit trail untuk
  // step 6) — pointing ke entry pertama dari trx history.
  const { transactionCorrections } = await import("@/db/schema");
  const priorCorrections = await db
    .select({
      id: transactionCorrections.id,
      correctedJournalEntryId: transactionCorrections.correctedJournalEntryId,
      approvedAt: transactionCorrections.approvedAt,
    })
    .from(transactionCorrections)
    .where(
      and(
        eq(transactionCorrections.transactionId, args.transactionId),
        eq(transactionCorrections.outletId, args.outletId),
        eq(transactionCorrections.status, "approved"),
      ),
    );
  const priorActive = priorCorrections
    .filter(
      (c) =>
        c.id !== args.correctionId &&
        c.correctedJournalEntryId !== null &&
        c.approvedAt !== null,
    )
    .sort((a, b) => {
      const at = a.approvedAt!.getTime();
      const bt = b.approvedAt!.getTime();
      return bt - at;
    })[0];

  const [originalPosSaleEntry] = await db
    .select({ id: journalEntries.id, status: journalEntries.status })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, args.outletId),
        eq(journalEntries.sourceType, "pos_sale"),
        eq(journalEntries.sourceId, args.transactionId),
      ),
    )
    .limit(1);
  const originalEntryId = originalPosSaleEntry?.id ?? null;

  /* Round 2+: target = previous correction's correctedJournalEntryId.
   * Round 1: target = original pos_sale entry. */
  let entryToReverseId: string | null = null;
  let entryToReverseStatus: string | null = null;
  if (priorActive?.correctedJournalEntryId) {
    const [priorEntry] = await db
      .select({ id: journalEntries.id, status: journalEntries.status })
      .from(journalEntries)
      .where(eq(journalEntries.id, priorActive.correctedJournalEntryId))
      .limit(1);
    if (priorEntry) {
      entryToReverseId = priorEntry.id;
      entryToReverseStatus = priorEntry.status;
    }
  } else {
    entryToReverseId = originalPosSaleEntry?.id ?? null;
    entryToReverseStatus = originalPosSaleEntry?.status ?? null;
  }

  // 3. Post reversal — Dr↔Cr swap revenue side, COGS stripped.
  const reverseLines = mapPosSaleReversal({
    transactionId: args.transactionId,
    transactionNumber: args.transactionNumber,
    outletId: args.outletId,
    entryDate: args.entryDate,
    paymentMethod: args.original.paymentMethod,
    total: args.original.total,
    subtotal: args.original.subtotal,
    discountAmount: args.original.discountAmount,
    items: aggItems,
    splits: args.original.splits ?? undefined,
    reason: args.reason,
  });
  const reverseResult = await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `REVERSE penjualan TRX ${args.transactionNumber} (koreksi): ${args.reason}`,
    sourceType: "pos_sale_reversal",
    sourceId: args.correctionId,
    lines: reverseLines,
    actorId: args.actorId,
    metadata: {
      transactionId: args.transactionId,
      originalPaymentMethod: args.original.paymentMethod,
      originalTotal: args.original.total,
    },
  });

  // 4. Mark target entry as reversed + link reversedByEntryId.
  //    Pair-void: counter ikut di-mark reversed supaya net 0 di ledger
  //    sum (lihat reverseJournalEntry comment).
  //
  // Sesi AE-83 — target entry = previous correction (round 2+) ATAU
  // original pos_sale (round 1). Sebelumnya hardcoded ke original pos_sale,
  // jadi round-2+ correction punya floating posted reverse (no counter
  // linkage, double-count di ledger).
  if (entryToReverseId && entryToReverseStatus !== "reversed") {
    await db
      .update(journalEntries)
      .set({
        status: "reversed",
        reversedByEntryId: reverseResult.entryId,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, entryToReverseId));

    await db
      .update(journalEntries)
      .set({
        status: "reversed",
        reversesEntryId: entryToReverseId,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, reverseResult.entryId));
  }

  // 5. Post corrected entry — revenue-only with corrected paymentMethod/total.
  const correctedLines = mapPosSaleCorrection({
    transactionId: args.transactionId,
    transactionNumber: args.transactionNumber,
    outletId: args.outletId,
    entryDate: args.entryDate,
    paymentMethod: args.corrected.paymentMethod,
    total: args.corrected.total,
    subtotal: args.corrected.subtotal,
    discountAmount: args.corrected.discountAmount,
    items: aggItems,
    splits: args.corrected.splits ?? undefined,
    reason: args.reason,
  });
  const correctedResult = await recordJournal({
    outletId: args.outletId,
    entryDate: args.entryDate,
    description: `KOREKSI penjualan TRX ${args.transactionNumber} (${args.corrected.paymentMethod}): ${args.reason}`,
    sourceType: "pos_sale_correction",
    sourceId: args.correctionId,
    lines: correctedLines,
    actorId: args.actorId,
    metadata: {
      transactionId: args.transactionId,
      correctedPaymentMethod: args.corrected.paymentMethod,
      correctedTotal: args.corrected.total,
    },
  });

  // 6. Update transaction_corrections row dengan trio journal entry IDs.
  //    (transactionCorrections sudah di-import di step 2 untuk multi-koreksi
  //    chain lookup; reuse referensi yang sama.)
  await db
    .update(transactionCorrections)
    .set({
      originalJournalEntryId: originalEntryId,
      reverseJournalEntryId: reverseResult.entryId,
      correctedJournalEntryId: correctedResult.entryId,
      updatedAt: new Date(),
    })
    .where(eq(transactionCorrections.id, args.correctionId));

  return {
    reverseEntryId: reverseResult.entryId,
    correctedEntryId: correctedResult.entryId,
    originalEntryId,
  };
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
  /* Sesi AE-177h — override sourceId default (= purchaseId). Untuk partial
   * GR via receiveGoods, caller pass goodsReceiptId supaya TIAP GR jurnalnya
   * unik. Tanpa override, partial ke-2/3 hit idempotency (outlet, sourceType,
   * sourceId)+(purchase_create, purchaseId) → silent skip → GL kurang catat. */
  sourceId?: string;
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
    sourceId: args.sourceId ?? args.purchaseId,
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

/**
 * Audit AE-181 — reversal jurnal PEMBAYARAN saat purchase yang sudah paid
 * di-cancel. Tanpa ini cancel hanya membalik jurnal create → 2101
 * ketinggalan debit pelunasan + bank tidak balik (drift -800rb terdeteksi
 * di GL produksi, legacy Mei). Self-skip kalau jurnal purchase_pay tidak
 * pernah ada (mis. auto-journal OFF saat pembayaran). Idempotent via
 * (sourceType='purchase_pay_reversal', sourceId=purchaseId).
 */
export async function postJournalForPurchasePayReversal(args: {
  outletId: string;
  purchaseId: string;
  purchaseLabel: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  const [payEntry] = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, args.outletId),
        eq(journalEntries.sourceType, "purchase_pay"),
        eq(journalEntries.sourceId, args.purchaseId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (!payEntry) return; // pembayaran tidak pernah ter-jurnal

  const lines = await db
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, payEntry.id));
  if (lines.length === 0) return;

  await recordJournal({
    outletId: args.outletId,
    entryDate: new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    description: `Reverse pembayaran (cancel) ${args.purchaseLabel} — balik ${payEntry.entryNumber}`,
    sourceType: "purchase_pay_reversal",
    sourceId: args.purchaseId,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.credit),
      credit: Number(l.debit),
      description: `Reverse bayar (cancel): ${l.description ?? ""}`,
    })),
    actorId: args.actorId,
    metadata: { reversesEntryId: payEntry.id, purchaseId: args.purchaseId },
  });
}

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

  /* Audit AE-186 — expense yang sudah dihapus (soft-delete) JANGAN dijurnal.
   * Skenario nyata: jurnal awal hilang (era instance beku) → owner hapus
   * expense-nya → sapuan per jam melihat "expense tanpa jurnal" dan memposting
   * beban untuk baris yang sudah tidak ada di UI mana pun. */
  if (exp.deletedAt) return;

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

  /* Sesi AE-69 — resolve bank account specific kalau staff pilih.
   * Override Cr side dari hardcoded mapping (cash→1101, transfer→1110, etc)
   * ke GL code yang sesuai bank account.bankName (BCA→1110, BRI→1111, etc). */
  let cashBankCodeOverride: string | null = null;
  if (exp.bankAccountId) {
    const [ba] = await db
      .select({ bankName: bankAccounts.bankName, isActive: bankAccounts.isActive })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, exp.bankAccountId))
      .limit(1);
    if (ba) {
      cashBankCodeOverride = resolveBankCodeFromDestination(ba.bankName);
    }
  }

  const lines = mapExpenseCreate({
    expenseId: exp.id,
    outletId: args.outletId,
    entryDate: String(exp.expenseDate),
    amount: Number(exp.amount),
    description: exp.description,
    paymentMethod: exp.paymentMethod as ExpensePaymentMethod,
    expenseAccountCode,
    cashBankCodeOverride,
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

  /* Sesi AE-69 — fetch incomes row untuk lookup bankAccountId override
   * (parity dengan postJournalForExpenseCreate pattern).
   * Sesi AE-71 — fetch accountId juga untuk resolve revenue account code. */
  const [inc] = await db
    .select({
      bankAccountId: incomes.bankAccountId,
      accountId: incomes.accountId,
    })
    .from(incomes)
    .where(eq(incomes.id, args.incomeId))
    .limit(1);

  let cashBankCodeOverride: string | null = null;
  if (inc?.bankAccountId) {
    const [ba] = await db
      .select({ bankName: bankAccounts.bankName })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, inc.bankAccountId))
      .limit(1);
    if (ba) {
      cashBankCodeOverride = resolveBankCodeFromDestination(ba.bankName);
    }
  }

  /* Sesi AE-71 — resolve revenue account code. Validate type=revenue
   * supaya tidak miss-route ke expense/asset by accident. */
  let revenueAccountCodeOverride: string | null = null;
  if (inc?.accountId) {
    const [acc] = await db
      .select({ code: chartOfAccounts.code, type: chartOfAccounts.type })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.id, inc.accountId))
      .limit(1);
    if (acc && acc.type === "revenue") {
      revenueAccountCodeOverride = acc.code;
    }
  }

  const lines = mapIncomeCreate({
    incomeId: args.incomeId,
    outletId: args.outletId,
    entryDate: args.entryDate,
    amount: args.amount,
    description: args.description,
    paymentMethod: args.paymentMethod,
    cashBankCodeOverride,
    revenueAccountCodeOverride,
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
// Audit AE-186 — Sinkron jurnal saat expense/income di-EDIT atau di-HAPUS.
//
// Sebelumnya: edit nominal Rp500rb → Rp50rb atau hapus expense TIDAK pernah
// menyentuh jurnalnya → GL menyimpan angka lama selamanya (kelas drift yang
// sama dengan yang direkonsiliasi manual di audit AE-181). Sapuan per jam
// hanya memposting jurnal yang HILANG, tidak mengoreksi nominal.
//
// Pola: pair-void (identik reverseJournalEntry) — entry lawan dibuat dengan
// sourceType *_void + sourceId sumbernya (idempoten via unique active index),
// lalu KEDUA sisi ditandai 'reversed' dalam satu transaksi. Untuk edit,
// setelah void diposting ulang lewat hook create biasa (boleh, karena unique
// index hanya menghitung entry aktif).
// ============================================================

async function pairVoidJournalForSource(args: {
  outletId: string;
  sourceType: "expense_create" | "income_create" | "purchase_create";
  voidSourceType: "expense_void" | "income_void" | "purchase_create_void";
  sourceId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  const [entry] = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, args.outletId),
        eq(journalEntries.sourceType, args.sourceType),
        eq(journalEntries.sourceId, args.sourceId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (!entry) return; // belum pernah dijurnal — tidak ada yang dibalik

  const lines = await db
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
    })
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id))
    .orderBy(asc(journalLines.lineNumber));

  const counter = await recordJournal({
    outletId: args.outletId,
    entryDate: String(entry.entryDate),
    description: `Reverse ${entry.entryNumber} — ${args.reason}`,
    sourceType: args.voidSourceType,
    sourceId: args.sourceId,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.credit),
      credit: Number(l.debit),
      description: `Reverse: ${l.description ?? ""}`,
    })),
    actorId: args.actorId,
    metadata: { reversesEntryId: entry.id, reason: args.reason },
  });

  await db.transaction(async (tx) => {
    await tx
      .update(journalEntries)
      .set({
        status: "reversed",
        reversedByEntryId: counter.entryId,
        reverseReason: args.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(journalEntries.id, entry.id),
          eq(journalEntries.status, "posted"),
        ),
      );
    await tx
      .update(journalEntries)
      .set({
        status: "reversed",
        reversesEntryId: entry.id,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, counter.entryId));
  });
}

export async function postJournalForExpenseDelete(args: {
  outletId: string;
  expenseId: string;
  actorId: string;
  reason?: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;
  await pairVoidJournalForSource({
    outletId: args.outletId,
    sourceType: "expense_create",
    voidSourceType: "expense_void",
    sourceId: args.expenseId,
    actorId: args.actorId,
    reason: args.reason ?? "Pengeluaran dihapus",
  });
}

/** Edit expense → void jurnal lama + posting ulang dari row terkini. */
export async function resyncJournalForExpenseUpdate(args: {
  outletId: string;
  expenseId: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;
  await pairVoidJournalForSource({
    outletId: args.outletId,
    sourceType: "expense_create",
    voidSourceType: "expense_void",
    sourceId: args.expenseId,
    actorId: args.actorId,
    reason: "Pengeluaran diedit — jurnal diposting ulang",
  });
  await postJournalForExpenseCreate(args);
}

export async function postJournalForIncomeDelete(args: {
  outletId: string;
  incomeId: string;
  actorId: string;
  reason?: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;
  await pairVoidJournalForSource({
    outletId: args.outletId,
    sourceType: "income_create",
    voidSourceType: "income_void",
    sourceId: args.incomeId,
    actorId: args.actorId,
    reason: args.reason ?? "Pemasukan dihapus",
  });
}

/** Edit income → void jurnal lama + posting ulang dengan nilai terbaru. */
export async function resyncJournalForIncomeUpdate(args: {
  outletId: string;
  incomeId: string;
  amount: number;
  description: string;
  paymentMethod: IncomePaymentMethod;
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;
  await pairVoidJournalForSource({
    outletId: args.outletId,
    sourceType: "income_create",
    voidSourceType: "income_void",
    sourceId: args.incomeId,
    actorId: args.actorId,
    reason: "Pemasukan diedit — jurnal diposting ulang",
  });
  await postJournalForIncomeCreate(args);
}

/**
 * Sesi AE-188 — PO diedit setelah barang diterima → jurnal GR-nya diposting
 * ulang dengan nilai baru.
 *
 * Kenapa perlu: alur "harga Rp 0 dulu supaya PIC Operasional bisa GR" bikin
 * GR pertama bernilai 0 → `receiveGoods` melewati posting jurnal sama sekali
 * (guard `total > 0`). Begitu harga asli diisi lewat Edit PO, persediaan &
 * kas/hutang harus tercatat. Sebaliknya kalau harga dikoreksi turun, jurnal
 * lama wajib dibalik dulu — kalau tidak, GL menyimpan angka lama selamanya
 * (kelas drift yang sama dengan audit AE-181).
 *
 * Pola sama dengan resync expense/income: pair-void (idempoten via unique
 * index entry aktif) lalu posting ulang. `sourceId` = goodsReceiptId, sama
 * dengan yang dipakai `receiveGoods` sejak AE-177h, supaya per-GR tetap unik.
 *
 * Total 0 → cukup dibalik, tidak ada entry baru (mapper menolak total ≤ 0).
 */
export async function resyncJournalForGoodsReceipt(args: {
  outletId: string;
  purchaseId: string;
  goodsReceiptId: string;
  purchaseLabel: string;
  paymentMethod: PurchasePaymentMethod;
  total: number;
  lines: { section: IngredientSection; amount: number }[];
  entryDate: string;
  actorId: string;
}): Promise<void> {
  if (!(await isAutoJournalEnabled(args.outletId))) return;

  await pairVoidJournalForSource({
    outletId: args.outletId,
    sourceType: "purchase_create",
    voidSourceType: "purchase_create_void",
    sourceId: args.goodsReceiptId,
    actorId: args.actorId,
    reason: "PO diedit — jurnal penerimaan diposting ulang",
  });

  if (args.total <= 0) return;

  await postJournalForPurchaseCreate({
    outletId: args.outletId,
    purchaseId: args.purchaseId,
    purchaseLabel: args.purchaseLabel,
    paymentMethod: args.paymentMethod,
    total: args.total,
    lines: args.lines,
    entryDate: args.entryDate,
    actorId: args.actorId,
    sourceId: args.goodsReceiptId,
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
 * tanpa harus check Vercel runtime logs.
 *
 * Sesi AE-62w — store-and-forward retry queue. Caller bisa pass
 * `retrySpec: { label, args }` supaya saat hook throw, args di-snapshot
 * ke `journal_retry_queue` untuk owner re-trigger via Admin → Antrian
 * Jurnal Gagal. Tanpa retrySpec, behavior backward-compat (audit-only,
 * sama AE-46).
 *
 * @param fn         — async function yang panggil postJournalForXxx
 * @param label      — sourceType (mis. "purchase_create", "pos_sale")
 * @param context    — optional metadata buat traceability (sourceId, outletId)
 * @param retrySpec  — optional snapshot args untuk enqueue retry kalau gagal.
 *                     Hanya label yang ada di RETRY_QUEUE_HOOK_LABELS yang
 *                     bisa di-dispatch retry — label lain still log audit
 *                     tapi tidak masuk queue.
 */
export function fireJournalHook(
  fn: () => Promise<void>,
  label: string,
  context?: {
    sourceId?: string;
    outletId?: string;
    actorId?: string;
  },
  retrySpec?: {
    /** Hook label untuk dispatcher (cocok dengan RETRY_QUEUE_HOOK_LABELS). */
    label: string;
    /** JSON-serializable args snapshot. */
    args: Record<string, unknown>;
  },
): void {
  /* Sesi AE-182 — dulu di sini `fn().catch(...)` telanjang. Response server
   * action dikirim duluan, instance Vercel dibekukan, promise jurnal mati di
   * tengah query ("Connection terminated unexpectedly") DAN blok .catch di
   * bawah ikut mati → tidak ada audit log, tidak ada baris retry-queue.
   * Hasilnya 855 transaksi lunas tanpa jurnal sama sekali (audit 2026-08-04).
   *
   * Sekarang dibungkus runAfterResponse → `after()` menahan instance sampai
   * jurnal selesai, tanpa memperlambat response ke kasir. Plus retry
   * in-process untuk error koneksi sesaat (hook idempotent lewat
   * recordJournal, jadi aman diulang). */
  runAfterResponse(
    () => runJournalHookWithRetry(fn, label, context, retrySpec),
    `journal:${label}`,
  );
}

/** Berapa kali hook diulang sendiri sebelum masuk antrian retry. */
const HOOK_MAX_ATTEMPTS = 3;
/** Jeda antar percobaan (ms). Index = percobaan ke-n yang baru saja gagal. */
const HOOK_RETRY_DELAYS_MS = [400, 1_500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJournalHookWithRetry(
  fn: () => Promise<void>,
  label: string,
  context?: {
    sourceId?: string;
    outletId?: string;
    actorId?: string;
  },
  retrySpec?: {
    label: string;
    args: Record<string, unknown>;
  },
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HOOK_MAX_ATTEMPTS; attempt++) {
    try {
      await fn();
      if (attempt > 1) {
        console.warn(
          `[journal:${label}] sukses setelah percobaan ke-${attempt}`,
        );
      }
      return;
    } catch (e) {
      lastError = e;
      /* Hanya error koneksi/timeout yang layak diulang. Error data
       * (imbalance, constraint, period locked) diulang pun tetap gagal —
       * langsung ke antrian supaya owner lihat. */
      if (!isTransientDbError(e) || attempt === HOOK_MAX_ATTEMPTS) break;
      await sleep(HOOK_RETRY_DELAYS_MS[attempt - 1] ?? 1_500);
    }
  }
  await handleJournalHookFailure(lastError, label, context, retrySpec);
}

async function handleJournalHookFailure(
  e: unknown,
  label: string,
  context?: {
    sourceId?: string;
    outletId?: string;
    actorId?: string;
  },
  retrySpec?: {
    label: string;
    args: Record<string, unknown>;
  },
): Promise<void> {
  await (async () => {
    /* Sesi AE-76 — Drizzle wrap PG errors sebagai DrizzleQueryError dengan
     * message = "Failed query: <SQL>" dan cause = original PG error. Kalau
     * cuma capture e.message, owner lihat SQL tanpa reason aktual (unique
     * violation? FK? check?). extractDbError walk cause chain → ambil
     * SQLSTATE + constraint name + detail. */
    const dbErr = extractDbError(e);
    const stack = e instanceof Error ? e.stack : undefined;
    const fallbackMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `[journal:${label}] ${dbErr.formatted}\n${fallbackMsg}`,
    );

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
          summary: `🚨 Journal post gagal: ${label} — ${dbErr.formatted}`,
          context: {
            sourceType: label,
            sourceId: context?.sourceId,
            /* reason aktual dari PG (mis. unique violation message). */
            reason: dbErr.reason,
            sqlstate: dbErr.sqlstate,
            constraint: dbErr.constraint,
            detail: dbErr.detail,
            /* rawError full untuk debug; sebelumnya cuma SQL. */
            rawError: fallbackMsg,
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

    /* Sesi AE-62w — enqueue ke retry queue kalau retrySpec + outletId ada
     * dan label retryable. Best-effort: enqueue failure tidak break source
     * action (sudah committed). */
    if (retrySpec && context?.outletId) {
      try {
        const { enqueueFailedJournal } = await import("./retry-queue");
        const { isRetryableHookLabel } = await import("./retry-queue-types");
        if (isRetryableHookLabel(retrySpec.label)) {
          await enqueueFailedJournal({
            outletId: context.outletId,
            hookLabel: retrySpec.label,
            hookArgs: retrySpec.args,
            sourceType: label,
            sourceId: context.sourceId,
            error: e,
          });
        }
      } catch (queueErr) {
        console.error(`[journal:${label}] retry-queue enqueue failure`, queueErr);
      }
    }

    /* Sesi AE-124 — push notif ke kategori system (urgent → bypass quiet
     * hours, Rama dev) + finance_close (Inab non-urgent). Honor preferences
     * lain. Fire-and-forget, tidak block source action. */
    if (context?.outletId) {
      try {
        const { sendCategorizedPush } = await import(
          "@/features/push-notifications/server"
        );
        const errMsg = e instanceof Error ? e.message : String(e);
        const shortMsg = errMsg.slice(0, 100);
        const payload = {
          title: `Journal hook gagal: ${label}`,
          body: `Source ${context.sourceId?.slice(0, 8) ?? "?"}: ${shortMsg}${retrySpec ? " (auto-retry enabled)" : ""}`,
          url: "/dashboard#journal_retry",
          tag: `journal-error-${label}`,
        };
        /* System urgent (bypass quiet hours) — kirim ke Rama dev. */
        await sendCategorizedPush("system", context.outletId, payload);
        /* finance_close non-urgent — kirim ke Inab + Sekal kalau jam kerja. */
        await sendCategorizedPush(
          "finance_close",
          context.outletId,
          payload,
        );
      } catch (pushErr) {
        console.error(`[journal:${label}] push notif fail`, pushErr);
      }
    }
  })();
}
