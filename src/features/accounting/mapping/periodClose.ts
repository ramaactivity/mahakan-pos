/**
 * mapPeriodClose — closing entry generator per design doc §4.18.
 *
 * Pre-condition: caller computes account balances within period (from
 * journal_lines aggregation). Pure function takes balances → produces
 * balanced journal lines.
 *
 * Logic:
 *   For each revenue (4xxx) account dengan credit balance B:
 *     Dr {revenue}, Cr 3302 Laba Rugi Berjalan      B
 *   For each contra-revenue + cogs (5xxx) + expense (6xxx) account dengan
 *   debit balance B:
 *     Dr 3302, Cr {account}                          B
 *   Then transfer 3302 net ke 3301 Saldo Laba:
 *     Net profit (3302 net credit): Dr 3302, Cr 3301
 *     Net loss (3302 net debit): Dr 3301, Cr 3302
 *
 * Result: revenue + expense + cogs accounts all zeroed; 3302 also zeroed;
 * 3301 Saldo Laba bumped/dropped by net P&L.
 *
 * Idempotency: caller checks period.closingEntryId — kalau sudah set, skip.
 */

import type { JournalLineInput } from "../posting";

export type AccountBalance = {
  /** chart_of_accounts.code */
  code: string;
  /** chart_of_accounts.type */
  type: "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";
  /** Net balance dalam period: positive = (debit - credit) for debit-normal,
   * (credit - debit) for credit-normal. Caller normalizes. */
  balance: number;
  /** Pre-resolved chart_of_accounts.id untuk avoid second roundtrip. */
  accountId: string;
};

export type PeriodCloseInput = {
  outletId: string;
  /** Last day of period (YYYY-MM-DD). E.g. "2026-06-30". */
  entryDate: string;
  /** "Juni 2026" — for description. */
  periodLabel: string;
  /** Account balances dalam period. Caller harus pre-compute via journal_lines
   * aggregation per account, status='posted', period_id=this period. */
  balances: AccountBalance[];
};

/**
 * Sesi AE-211 — kontra-revenue dikenali dari KODE akun, bukan flag `isContra`,
 * supaya pratinjau Tutup Buku dan jurnal penutup yang sebenarnya tidak pernah
 * beda. Dipakai bersama oleh `mapPeriodClose` dan `summarizeClosingNominals`.
 */
export function isContraRevenueCode(code: string): boolean {
  return code === "4110" || code === "4111";
}

export function mapPeriodClose(input: PeriodCloseInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [];

  let totalRevenueClosed = 0; // sum of revenue Cr balances getting Dr'd to close
  let totalExpenseClosed = 0; // sum of expense+cogs Dr balances getting Cr'd to close
  let totalContraRevenue = 0; // 4110/4111 contra-revenue Dr balances → Cr to 3302 (sum)

  for (const acc of input.balances) {
    if (acc.balance === 0) continue;

    if (acc.type === "revenue") {
      // Revenue accounts: 4101/4102/4103/4104/4201/4301 (credit-normal, balance positive = credit)
      // Contra-revenue: 4110/4111 (debit-normal, isContra=true, balance positive = debit)
      if (isContraRevenueCode(acc.code)) {
        // Contra-revenue: debit-normal balance. Counter = credit it back to zero,
        // counter-counter = debit 3302 untuk match.
        if (acc.balance > 0) {
          lines.push({
            accountCode: acc.code,
            credit: acc.balance,
            description: `Tutup kontra-revenue ${input.periodLabel}`,
          });
          totalContraRevenue += acc.balance;
        }
      } else {
        // Normal revenue: credit-normal balance.
        if (acc.balance > 0) {
          lines.push({
            accountCode: acc.code,
            debit: acc.balance,
            description: `Tutup revenue ${input.periodLabel}`,
          });
          totalRevenueClosed += acc.balance;
        }
      }
    } else if (acc.type === "expense" || acc.type === "cogs") {
      // Debit-normal balance (positive = debit balance to clear).
      if (acc.balance > 0) {
        lines.push({
          accountCode: acc.code,
          credit: acc.balance,
          description: `Tutup ${acc.type === "cogs" ? "HPP" : "beban"} ${input.periodLabel}`,
        });
        totalExpenseClosed += acc.balance;
      }
    }
    // asset/liability/equity accounts: skip (carry forward, not closed at period end)
  }

  // Compute net P&L:
  //   Revenue (Cr nature) closed = Cr 3302 amount conceptually
  //   Contra-revenue (Dr nature) closed = Dr 3302 amount
  //   Expense+COGS (Dr nature) closed = Dr 3302 amount
  //
  // Net to 3302:
  //   Cr (gain) = totalRevenueClosed - (totalContraRevenue + totalExpenseClosed)
  //   Dr (loss) = (totalContraRevenue + totalExpenseClosed) - totalRevenueClosed
  //
  // 3302 line = balancing entry (sums Dr/Cr to net):
  //   Cr 3302 = totalRevenueClosed (offsetting all Dr revenue lines)
  //   Dr 3302 = totalContraRevenue + totalExpenseClosed (offsetting all Cr contra+expense lines)
  // Then transfer net to 3301:
  //   Kalau Cr > Dr (profit): Dr 3302 net, Cr 3301 net
  //   Kalau Dr > Cr (loss): Dr 3301 net, Cr 3302 net

  // Flatten: instead of separate 3302 lines, combine into single net 3302 line
  // plus 3301 transfer. This keeps total line count low and clear.

  if (totalRevenueClosed > 0) {
    lines.push({
      accountCode: "3302",
      credit: totalRevenueClosed,
      description: `Net revenue ke Laba Rugi Berjalan`,
    });
  }
  const totalDebitedTo3302 = totalContraRevenue + totalExpenseClosed;
  if (totalDebitedTo3302 > 0) {
    lines.push({
      accountCode: "3302",
      debit: totalDebitedTo3302,
      description: `Net beban + kontra ke Laba Rugi Berjalan`,
    });
  }

  // Final transfer 3302 → 3301
  const netProfit = totalRevenueClosed - totalDebitedTo3302;
  if (netProfit > 0) {
    // Profit: clear Cr balance di 3302 ke 3301.
    lines.push({
      accountCode: "3302",
      debit: netProfit,
      description: `Transfer laba bersih ${input.periodLabel}`,
    });
    lines.push({
      accountCode: "3301",
      credit: netProfit,
      description: `Saldo laba dari ${input.periodLabel}`,
    });
  } else if (netProfit < 0) {
    // Loss: clear Dr balance di 3302 ke 3301.
    const loss = -netProfit;
    lines.push({
      accountCode: "3301",
      debit: loss,
      description: `Saldo laba dikurangi rugi ${input.periodLabel}`,
    });
    lines.push({
      accountCode: "3302",
      credit: loss,
      description: `Transfer rugi bersih ${input.periodLabel}`,
    });
  }
  // netProfit === 0: 3302 already balanced sendiri, no transfer needed.

  return lines;
}
