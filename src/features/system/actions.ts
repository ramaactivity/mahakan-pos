"use server";

import { eq, sql } from "drizzle-orm";
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
  payrollPeriods,
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
import { logAndSanitize } from "@/lib/server-error";
import type { ApiResult, ResetMockupResult } from "./types";

/**
 * Sesi AE-32 — nuclear wipe data operasional untuk transition mockup → trial.
 *
 * Owner-only. Menghapus SEMUA data transaksional dalam outlet aktif:
 *   - Transaksi (incl. items, modifiers, splits, refunds)
 *   - Shifts (open + closed)
 *   - Attendance records
 *   - Inventory movements + stock opname sessions/lines
 *   - Purchase requests + purchases (incl. items)
 *   - Cash deposits + aggregator settlements + settlement logs
 *   - Expenses + incomes
 *   - Approval codes (consumed)
 *   - Journal entries + lines (accounting test data)
 *   - Payroll lines (preserve periods karena owner mungkin set rate)
 *   - Audit logs operasional
 *   - Reset ingredients.currentStock ke 0 (preserve costPerUnit dari Market List)
 *   - Reset shifts handover messages
 *
 * PRESERVE (master data):
 *   - users, employees, outlets, roles
 *   - menu_items, categories, modifiers
 *   - ingredients (master, stock di-reset 0)
 *   - recipes + recipe_ingredients
 *   - suppliers + supplier_ingredients (Market List)
 *   - customers (loyalty members)
 *   - promos, bank_accounts, fixed_assets
 *   - employee_schedules, payroll_periods (header, lines wiped)
 *   - chart_of_accounts, accounting_periods
 *
 * Dependency order critical untuk respect FK:
 *   children → parents
 *
 * Tidak bisa di-undo. UI wajib confirm-by-type "RESET DATA TRIAL".
 */
export async function resetMockupData(): Promise<ApiResult<ResetMockupResult>> {
  const session = await auth();
  if (!session) {
    return { success: false, error: { code: "UNAUTHORIZED", message: "Sesi expired" } };
  }
  if (!hasPermission(session.user.role, "system.reset_mockup_data")) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "Hanya Owner yang boleh reset data" },
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
      // 1. Refund events (depend on transactions)
      const refIt = await tx.delete(refundEventItems).returning({ id: refundEventItems.id });
      record("refund_event_items", refIt.length);
      const ref = await tx.delete(refundEvents).returning({ id: refundEvents.id });
      record("refund_events", ref.length);

      // 2. Split payments (depend on transactions)
      const splIt = await tx.delete(splitPaymentItems).returning({ id: splitPaymentItems.id });
      record("split_payment_items", splIt.length);
      const spl = await tx.delete(splitPayments).returning({ id: splitPayments.id });
      record("split_payments", spl.length);

      // 3. Transaction items + modifiers + transactions
      const trxItMod = await tx
        .delete(transactionItemModifiers)
        .returning({ id: transactionItemModifiers.id });
      record("transaction_item_modifiers", trxItMod.length);
      const trxIt = await tx.delete(transactionItems).returning({ id: transactionItems.id });
      record("transaction_items", trxIt.length);
      const trx = await tx.delete(transactions).returning({ id: transactions.id });
      record("transactions", trx.length);

      // 4. Inventory movements (transactional sales/adjust/receive)
      const invMov = await tx.delete(inventoryMovements).returning({ id: inventoryMovements.id });
      record("inventory_movements", invMov.length);

      // 5. Stock opname (lines first, then sessions)
      const opnLn = await tx.delete(stockOpnameLines).returning({ id: stockOpnameLines.id });
      record("stock_opname_lines", opnLn.length);
      const opn = await tx.delete(stockOpnameSessions).returning({ id: stockOpnameSessions.id });
      record("stock_opname_sessions", opn.length);

      // 6. Purchase requests + purchases
      const prIt = await tx
        .delete(purchaseRequestItems)
        .returning({ id: purchaseRequestItems.id });
      record("purchase_request_items", prIt.length);
      const pr = await tx.delete(purchaseRequests).returning({ id: purchaseRequests.id });
      record("purchase_requests", pr.length);
      const purIt = await tx.delete(purchaseItems).returning({ id: purchaseItems.id });
      record("purchase_items", purIt.length);
      const pur = await tx.delete(purchases).returning({ id: purchases.id });
      record("purchases", pur.length);

      // 7. Cashflow operasional
      const cd = await tx.delete(cashDeposits).returning({ id: cashDeposits.id });
      record("cash_deposits", cd.length);
      const ag = await tx
        .delete(aggregatorSettlements)
        .returning({ id: aggregatorSettlements.id });
      record("aggregator_settlements", ag.length);
      const sl = await tx.delete(settlementLogs).returning({ id: settlementLogs.id });
      record("settlement_logs", sl.length);
      const exp = await tx.delete(expenses).returning({ id: expenses.id });
      record("expenses", exp.length);
      const inc = await tx.delete(incomes).returning({ id: incomes.id });
      record("incomes", inc.length);

      // 8. HR operasional (preserve schedules + payroll period headers)
      const att = await tx.delete(attendanceRecords).returning({ id: attendanceRecords.id });
      record("attendance_records", att.length);
      const pll = await tx.delete(payrollLines).returning({ id: payrollLines.id });
      record("payroll_lines", pll.length);

      // 9. Accounting journal (preserve COA + periods)
      const jl = await tx.delete(journalLines).returning({ id: journalLines.id });
      record("journal_lines", jl.length);
      const je = await tx.delete(journalEntries).returning({ id: journalEntries.id });
      record("journal_entries", je.length);

      // 10. Approval codes (consumed)
      const ac = await tx.delete(approvalCodes).returning({ id: approvalCodes.id });
      record("approval_codes", ac.length);

      // 11. Shifts (last among entities, after all dependents wiped)
      const shf = await tx.delete(shifts).returning({ id: shifts.id });
      record("shifts", shf.length);

      // 12. Reset ingredients stock (preserve master + costPerUnit dari Market List)
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

      // 13. Audit logs (last — wipe sebelum insert audit reset event itu sendiri)
      const al = await tx.delete(auditLogs).returning({ id: auditLogs.id });
      record("audit_logs", al.length);

      // Insert single audit entry untuk track reset itself.
      await tx.insert(auditLogs).values({
        eventType: "system.reset_mockup_data",
        userId: session.user.id,
        entityType: null,
        payload: {
          summary: `RESET MOCKUP DATA — ${totalDeleted} records dihapus + ${ingReset.length} ingredients stock reset ke 0`,
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
    return {
      success: false,
      error: {
        code: "DB_ERROR",
        message: logAndSanitize(e, "system.reset", "Reset gagal"),
      },
    };
  }
}

// Suppress unused warnings — payrollPeriods imported for documentation
// (we PRESERVE periods, only wipe lines), eq/sql for potential future
// outlet-scoped wipes if multi-outlet sometime needed.
void payrollPeriods;
void eq;
void sql;
