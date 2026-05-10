"use server";

import { db } from "@/db";
import {
  aggregatorSettlements,
  approvalCodes,
  attendanceRecords,
  auditLogs,
  cashDeposits,
  expenses,
  incomes,
  ingredients,
  inventoryMovements,
  journalEntries,
  journalLines,
  payrollLines,
  purchaseItems,
  purchaseRequestItems,
  purchaseRequests,
  purchases,
  refundEventItems,
  refundEvents,
  settlementLogs,
  shifts,
  splitPaymentItems,
  splitPayments,
  stockOpnameLines,
  stockOpnameSessions,
  transactionItemModifiers,
  transactionItems,
  transactions,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import type { ApiResult, ResetMockupResult } from "./types";

/**
 * Sesi AE-32 + AE-33 — nuclear wipe data operasional untuk transition
 * mockup → trial. Owner-only.
 *
 * AE-33 fix: corrected delete order untuk respect FK constraints.
 * Sebelumnya AE-32 gagal dengan "Reset gagal" karena urutan child →
 * parent salah:
 *   - approval_codes.transaction_id → transactions (must delete codes first)
 *   - expenses.refunded_transaction_id → transactions (delete expenses first)
 *   - purchases.expense_id → expenses (delete purchases first)
 *   - stock_opname_lines.movement_id → inventory_movements (delete lines first)
 *   - purchase_items.movement_id → inventory_movements (delete items first)
 *
 * Topological order (children before parents):
 *   L1: refund_event_items, transaction_item_modifiers, split_payment_items,
 *       attendance, payroll_lines, aggregator_settlements, settlement_logs,
 *       incomes, approval_codes, journal_lines, stock_opname_lines,
 *       purchase_request_items, purchase_items
 *   L2: refund_events, split_payments, transaction_items, purchase_requests,
 *       purchases, stock_opname_sessions, journal_entries, cash_deposits
 *   L3: expenses (must precede transactions due to refundedTransactionId FK)
 *   L4: inventory_movements (after opname_lines + purchase_items),
 *       transactions
 *   L5: shifts
 *   L6: audit_logs (last; one log inserted post-wipe untuk track reset)
 *
 *   PLUS: UPDATE ingredients SET currentStock = 0 (preserve master).
 */
export async function resetMockupData(): Promise<ApiResult<ResetMockupResult>> {
  const session = await auth();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesi expired" },
    };
  }
  if (!hasPermission(session.user.role, "system.reset_mockup_data")) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Hanya Owner yang boleh reset data",
      },
    };
  }

  const counts: Record<string, number> = {};
  let totalDeleted = 0;

  function record(label: string, n: number) {
    counts[label] = n;
    totalDeleted += n;
  }

  try {
    await db.transaction(async (tx) => {
      // ============== LAYER 1 — leaves (no inbound FK from wiped) ==============
      const refIt = await tx.delete(refundEventItems).returning({ id: refundEventItems.id });
      record("refund_event_items", refIt.length);

      const trxItMod = await tx
        .delete(transactionItemModifiers)
        .returning({ id: transactionItemModifiers.id });
      record("transaction_item_modifiers", trxItMod.length);

      const splIt = await tx.delete(splitPaymentItems).returning({ id: splitPaymentItems.id });
      record("split_payment_items", splIt.length);

      const att = await tx.delete(attendanceRecords).returning({ id: attendanceRecords.id });
      record("attendance_records", att.length);

      const pll = await tx.delete(payrollLines).returning({ id: payrollLines.id });
      record("payroll_lines", pll.length);

      const ag = await tx
        .delete(aggregatorSettlements)
        .returning({ id: aggregatorSettlements.id });
      record("aggregator_settlements", ag.length);

      const sl = await tx.delete(settlementLogs).returning({ id: settlementLogs.id });
      record("settlement_logs", sl.length);

      const inc = await tx.delete(incomes).returning({ id: incomes.id });
      record("incomes", inc.length);

      // approval_codes.transaction_id → transactions (HARUS sebelum transactions)
      const ac = await tx.delete(approvalCodes).returning({ id: approvalCodes.id });
      record("approval_codes", ac.length);

      const jl = await tx.delete(journalLines).returning({ id: journalLines.id });
      record("journal_lines", jl.length);

      // stock_opname_lines.movement_id → inventory_movements (HARUS sebelum)
      const opnLn = await tx.delete(stockOpnameLines).returning({ id: stockOpnameLines.id });
      record("stock_opname_lines", opnLn.length);

      const prIt = await tx
        .delete(purchaseRequestItems)
        .returning({ id: purchaseRequestItems.id });
      record("purchase_request_items", prIt.length);

      // purchase_items.movement_id → inventory_movements (HARUS sebelum)
      const purIt = await tx.delete(purchaseItems).returning({ id: purchaseItems.id });
      record("purchase_items", purIt.length);

      // ============== LAYER 2 ==============
      const ref = await tx.delete(refundEvents).returning({ id: refundEvents.id });
      record("refund_events", ref.length);

      const spl = await tx.delete(splitPayments).returning({ id: splitPayments.id });
      record("split_payments", spl.length);

      const trxIt = await tx.delete(transactionItems).returning({ id: transactionItems.id });
      record("transaction_items", trxIt.length);

      const pr = await tx.delete(purchaseRequests).returning({ id: purchaseRequests.id });
      record("purchase_requests", pr.length);

      // purchases.expense_id → expenses (HARUS sebelum expenses)
      const pur = await tx.delete(purchases).returning({ id: purchases.id });
      record("purchases", pur.length);

      const opn = await tx.delete(stockOpnameSessions).returning({ id: stockOpnameSessions.id });
      record("stock_opname_sessions", opn.length);

      const je = await tx.delete(journalEntries).returning({ id: journalEntries.id });
      record("journal_entries", je.length);

      const cd = await tx.delete(cashDeposits).returning({ id: cashDeposits.id });
      record("cash_deposits", cd.length);

      // ============== LAYER 3 ==============
      // expenses.refunded_transaction_id → transactions (HARUS sebelum transactions)
      const exp = await tx.delete(expenses).returning({ id: expenses.id });
      record("expenses", exp.length);

      // ============== LAYER 4 ==============
      const invMov = await tx
        .delete(inventoryMovements)
        .returning({ id: inventoryMovements.id });
      record("inventory_movements", invMov.length);

      const trx = await tx.delete(transactions).returning({ id: transactions.id });
      record("transactions", trx.length);

      // ============== LAYER 5 ==============
      const shf = await tx.delete(shifts).returning({ id: shifts.id });
      record("shifts", shf.length);

      // ============== Reset ingredients stock (preserve cost dari Market List) ==============
      const ingReset = await tx
        .update(ingredients)
        .set({
          currentStock: 0,
          currentStockDecimal: "0.0000",
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .returning({ id: ingredients.id });
      record("ingredients_stock_reset", ingReset.length);

      // ============== LAYER 6 — audit_logs LAST ==============
      const al = await tx.delete(auditLogs).returning({ id: auditLogs.id });
      record("audit_logs", al.length);

      await tx.insert(auditLogs).values({
        eventType: "system.reset_mockup_data",
        userId: session.user.id,
        entityType: null,
        payload: {
          summary: `RESET MOCKUP DATA — ${totalDeleted} records dihapus + ${ingReset.length} ingredients stock reset`,
          counts,
          totalDeleted,
        },
        metadata: {
          actorRole: session.user.role,
          outletId: session.user.outletId,
        },
      });
    });

    return { success: true, data: { counts, totalDeleted } };
  } catch (e) {
    // AE-33 — surface raw DB error supaya owner tau persis tabel mana
    // yang fail. Reset adalah owner-only one-time op, bukan public path,
    // jadi info DB OK di-expose di sini.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[system.reset]", e);
    return {
      success: false,
      error: {
        code: "DB_ERROR",
        message: `Reset gagal: ${msg}`,
      },
    };
  }
}
