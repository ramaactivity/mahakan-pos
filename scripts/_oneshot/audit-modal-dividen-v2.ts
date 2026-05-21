/**
 * Sesi AE-80/84 — Audit invariant Modal & Dividen v2 di prod.
 *
 * Read-only. Verify semua invariant kunci:
 *   1. Σ active investor share_pct per outlet = 100% (epsilon 0.0001)
 *   2. dividend_balance per investor = Σ(dividend_credit) − Σ(withdrawal − reversed)
 *   3. principalOutstanding per creditor = principalOriginal − Σ(posted_repayment_principal)
 *   4. Journal entry links per distribution / withdrawal / repayment
 *   5. Usage count per new source_type (visibility audit)
 *
 *   Sesi AE-84 — CROSS-LEDGER CHECKS (paling penting buat balance sheet):
 *   6. Σ active investor modal_disetor ≈ |neto journal balance 3101 Modal Owner|
 *   7. Σ active investor dividend_balance ≈ |neto journal balance 3202 Hutang Dividen|
 *   8. Σ active creditor outstanding ≈ |neto journal balance 2150 Hutang Kreditur|
 *
 * Cross-ledger check pakai approximate equality (>=)
 * karena historical journal entries pre-v2 mungkin tidak punya source tracking
 * sempurna. Drift kecil OK, drift besar (>5%) = red flag.
 *
 * Output ke stdout. Exit 0 kalau semua pass, 1 kalau ada drift.
 *
 *   npx tsx scripts/_oneshot/audit-modal-dividen-v2.ts
 *
 * Flags:
 *   --verbose    : surface every drift line, not just first 10
 *   --strict     : exit 1 walau cross-ledger drift kecil (default: tolerate <5%)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  capitalMovements,
  chartOfAccounts,
  creditorRepayments,
  creditors,
  investors,
  journalEntries,
  journalLines,
  withdrawalRequests,
  profitDistributions,
} from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const VERBOSE = process.argv.includes("--verbose");
const STRICT = process.argv.includes("--strict");
const DRIFT_TOLERANCE_PCT = 5; // soft warning kalau <5%, fail kalau >5% (kecuali --strict)

let totalErrors = 0;
let totalWarnings = 0;

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg: string) {
  totalWarnings++;
  console.log(`  ⚠ ${msg}`);
}
function fail(msg: string) {
  totalErrors++;
  console.log(`  ✗ ${msg}`);
}

function fmtIDR(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

// ============================================================================
// 1. Share % invariant per outlet
// ============================================================================

async function checkShareSum() {
  console.log("\n=== 1. Share % invariant per outlet ===");
  const rows = await db
    .select({
      outletId: investors.outletId,
      sumShare: sql<string>`COALESCE(SUM(${investors.sharePct}::numeric), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(investors)
    .where(and(eq(investors.status, "active"), isNull(investors.deletedAt)))
    .groupBy(investors.outletId);

  for (const r of rows) {
    const sum = Number(r.sumShare);
    const diff = Math.abs(sum - 100);
    if (diff <= 0.0001) {
      ok(
        `Outlet ${r.outletId.slice(0, 8)}: ${r.count} investor aktif, Σ share = ${sum.toFixed(4)}% ✓`,
      );
    } else if (sum < 100) {
      ok(
        `Outlet ${r.outletId.slice(0, 8)}: ${r.count} investor aktif, Σ share = ${sum.toFixed(4)}% (treasury ${(100 - sum).toFixed(4)}%)`,
      );
    } else {
      fail(
        `Outlet ${r.outletId.slice(0, 8)}: Σ share ${sum.toFixed(4)}% > 100% — INVARIANT VIOLATION`,
      );
    }
  }
}

// ============================================================================
// 2. dividend_balance per investor (capital_movements truth source)
// ============================================================================

async function checkDividendBalanceConsistency() {
  console.log(
    "\n=== 2. dividend_balance per investor (vs capital_movements) ===",
  );

  const balanceRows = await db
    .select({
      id: investors.id,
      fullName: investors.fullName,
      dividendBalance: investors.dividendBalance,
    })
    .from(investors)
    .where(isNull(investors.deletedAt));

  if (balanceRows.length === 0) {
    ok("No investors → trivially consistent");
    return;
  }

  const moves = await db
    .select({
      holderId: capitalMovements.holderId,
      kind: capitalMovements.kind,
      sumAmount: sql<number>`SUM(${capitalMovements.amount})::bigint`,
    })
    .from(capitalMovements)
    .where(
      and(
        eq(capitalMovements.holderType, "investor"),
        sql`${capitalMovements.kind} IN ('dividend_credit', 'dividend_withdrawal', 'adjustment')`,
        sql`${capitalMovements.reversedAt} IS NULL`,
      ),
    )
    .groupBy(capitalMovements.holderId, capitalMovements.kind);

  const expectedByInvestor = new Map<string, number>();
  for (const inv of balanceRows) expectedByInvestor.set(inv.id, 0);
  for (const m of moves) {
    const cur = expectedByInvestor.get(m.holderId) ?? 0;
    const amt = Number(m.sumAmount);
    if (m.kind === "dividend_credit") {
      expectedByInvestor.set(m.holderId, cur + amt);
    } else if (m.kind === "dividend_withdrawal") {
      expectedByInvestor.set(m.holderId, cur - amt);
    } else if (m.kind === "adjustment") {
      /* Adjustments signed (CSV import seed bisa positif atau negatif) */
      expectedByInvestor.set(m.holderId, cur + amt);
    }
  }

  let drift = 0;
  for (const inv of balanceRows) {
    const expected = Math.max(0, expectedByInvestor.get(inv.id) ?? 0);
    if (inv.dividendBalance !== expected) {
      const delta = inv.dividendBalance - expected;
      if (Math.abs(delta) > 0) {
        drift++;
        if (drift <= 10 || VERBOSE) {
          fail(
            `Investor ${inv.fullName.slice(0, 30).padEnd(30)} balance=${fmtIDR(inv.dividendBalance).padStart(18)} expected=${fmtIDR(expected).padStart(18)} drift=${delta > 0 ? "+" : ""}${fmtIDR(delta)}`,
          );
        }
      }
    }
  }
  if (drift === 0)
    ok(
      `All ${balanceRows.length} investor dividend_balance match capital_movements`,
    );
  else if (!VERBOSE && drift > 10)
    console.log(`  …${drift - 10} more drift entries (pakai --verbose)`);
}

// ============================================================================
// 3. Creditor outstanding consistency
// ============================================================================

async function checkCreditorOutstanding() {
  console.log("\n=== 3. Creditor.principalOutstanding vs repayment history ===");
  const creditorsRows = await db
    .select({
      id: creditors.id,
      fullName: creditors.fullName,
      principalOriginal: creditors.principalOriginal,
      principalOutstanding: creditors.principalOutstanding,
    })
    .from(creditors)
    .where(isNull(creditors.deletedAt));

  if (creditorsRows.length === 0) {
    ok("No creditors → trivially consistent");
    return;
  }

  const repays = await db
    .select({
      creditorId: creditorRepayments.creditorId,
      sumPrincipal: sql<number>`SUM(${creditorRepayments.principalAmount})::bigint`,
    })
    .from(creditorRepayments)
    .where(eq(creditorRepayments.status, "posted"))
    .groupBy(creditorRepayments.creditorId);

  const paidByCreditor = new Map<string, number>();
  for (const r of repays) paidByCreditor.set(r.creditorId, Number(r.sumPrincipal));

  let drift = 0;
  for (const c of creditorsRows) {
    const paid = paidByCreditor.get(c.id) ?? 0;
    const expected = c.principalOriginal - paid;
    if (c.principalOutstanding !== expected) {
      drift++;
      fail(
        `Creditor ${c.fullName}: outstanding=${fmtIDR(c.principalOutstanding)} expected=${fmtIDR(expected)} (original=${fmtIDR(c.principalOriginal)} paid=${fmtIDR(paid)})`,
      );
    }
  }
  if (drift === 0)
    ok(`All ${creditorsRows.length} creditor outstanding match repayment history`);
}

// ============================================================================
// 4. Journal entry links per distribution / withdrawal / repayment
// ============================================================================

async function checkJournalLinks() {
  console.log("\n=== 4. Journal entry links ===");

  const v2Dists = await db
    .select({
      id: profitDistributions.id,
      journalEntryId: profitDistributions.journalEntryId,
      status: profitDistributions.status,
    })
    .from(profitDistributions)
    .where(
      and(
        eq(profitDistributions.calculationModel, "v2"),
        sql`${profitDistributions.status} IN ('posted', 'reversed')`,
      ),
    );
  let distMissing = 0;
  for (const d of v2Dists) {
    if (!d.journalEntryId) {
      distMissing++;
      fail(
        `Distribution ${d.id.slice(0, 8)} status=${d.status} tidak punya journalEntryId`,
      );
    }
  }
  if (v2Dists.length > 0 && distMissing === 0)
    ok(`All ${v2Dists.length} v2 distribution posted punya journal link`);
  if (v2Dists.length === 0) ok("No v2 distribution yet — skip check");

  const ws = await db
    .select({
      id: withdrawalRequests.id,
      journalEntryId: withdrawalRequests.journalEntryId,
      capitalMovementId: withdrawalRequests.capitalMovementId,
    })
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.status, "posted"));
  let wMissing = 0;
  for (const w of ws) {
    if (!w.journalEntryId || !w.capitalMovementId) {
      wMissing++;
      fail(
        `Withdrawal ${w.id.slice(0, 8)} missing journal=${!!w.journalEntryId} movement=${!!w.capitalMovementId}`,
      );
    }
  }
  if (ws.length > 0 && wMissing === 0)
    ok(`All ${ws.length} posted withdrawal punya journal + movement link`);
  if (ws.length === 0) ok("No withdrawals yet");

  const rs = await db
    .select({
      id: creditorRepayments.id,
      journalEntryId: creditorRepayments.journalEntryId,
    })
    .from(creditorRepayments)
    .where(eq(creditorRepayments.status, "posted"));
  let rMissing = 0;
  for (const r of rs) {
    if (!r.journalEntryId) {
      rMissing++;
      fail(`Repayment ${r.id.slice(0, 8)} missing journal link`);
    }
  }
  if (rs.length > 0 && rMissing === 0)
    ok(`All ${rs.length} posted repayment punya journal link`);
  if (rs.length === 0) ok("No repayments yet");
}

// ============================================================================
// 5. Usage count per new source_type (visibility audit)
// ============================================================================

async function checkJournalSources() {
  console.log("\n=== 5. Usage count per source_type ===");
  const newSources = [
    "dividend_distribution",
    "dividend_distribution_reversal",
    "dividend_withdrawal",
    "dividend_withdrawal_reversal",
    "creditor_repayment",
    "creditor_repayment_reversal",
    "share_buyback",
    "share_buyback_reversal",
    "investor_to_creditor_conversion",
  ];
  for (const st of newSources) {
    const [r] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(journalEntries)
      .where(sql`${journalEntries.sourceType} = ${st}`);
    if (r && r.count > 0) ok(`sourceType '${st}': ${r.count} entries`);
  }
}

// ============================================================================
// 6-8. Cross-ledger checks (modal_disetor / dividend_balance / outstanding
// vs journal balance per account)
// ============================================================================

async function getAccountBalance(code: string): Promise<{
  accountId: string | null;
  normalBalance: "debit" | "credit" | null;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}> {
  /* Lookup account id + normalBalance. */
  const [acct] = await db
    .select({
      id: chartOfAccounts.id,
      normalBalance: chartOfAccounts.normalBalance,
    })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.code, code))
    .limit(1);
  if (!acct) {
    return {
      accountId: null,
      normalBalance: null,
      totalDebit: 0,
      totalCredit: 0,
      balance: 0,
    };
  }

  /* Aggregate Σ debit / Σ credit dari journal_lines (status='posted'). */
  const [agg] = await db
    .select({
      totalDebit: sql<number>`COALESCE(SUM(${journalLines.debit}), 0)::bigint`,
      totalCredit: sql<number>`COALESCE(SUM(${journalLines.credit}), 0)::bigint`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(
      and(
        eq(journalLines.accountId, acct.id),
        eq(journalEntries.status, "posted"),
      ),
    );

  const totalDebit = Number(agg?.totalDebit ?? 0);
  const totalCredit = Number(agg?.totalCredit ?? 0);
  /* Normal balance debit → balance = Dr − Cr (positive = ada saldo).
   * Normal balance credit → balance = Cr − Dr. */
  const balance =
    acct.normalBalance === "debit"
      ? totalDebit - totalCredit
      : totalCredit - totalDebit;

  return {
    accountId: acct.id,
    normalBalance: acct.normalBalance as "debit" | "credit",
    totalDebit,
    totalCredit,
    balance,
  };
}

function compareWithTolerance(
  label: string,
  sourceValue: number,
  ledgerValue: number,
): void {
  const delta = sourceValue - ledgerValue;
  const absDelta = Math.abs(delta);
  if (absDelta === 0) {
    ok(`${label}: source=${fmtIDR(sourceValue)} = ledger=${fmtIDR(ledgerValue)} ✓ exact`);
    return;
  }
  /* Pakai max biar tidak divide by zero kalau salah satu sisi 0. */
  const denominator = Math.max(Math.abs(sourceValue), Math.abs(ledgerValue), 1);
  const driftPct = (absDelta / denominator) * 100;
  if (driftPct <= DRIFT_TOLERANCE_PCT && !STRICT) {
    warn(
      `${label}: source=${fmtIDR(sourceValue)} ledger=${fmtIDR(ledgerValue)} drift=${delta > 0 ? "+" : ""}${fmtIDR(delta)} (${driftPct.toFixed(2)}%) — soft warning (historical pre-v2 entries mungkin)`,
    );
  } else {
    fail(
      `${label}: source=${fmtIDR(sourceValue)} ledger=${fmtIDR(ledgerValue)} drift=${delta > 0 ? "+" : ""}${fmtIDR(delta)} (${driftPct.toFixed(2)}%) — RED FLAG`,
    );
  }
}

async function checkCrossLedgerModal() {
  console.log(
    "\n=== 6. Σ modal_disetor (active investors) vs 3101 Modal Owner balance ===",
  );
  const [modalAgg] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${investors.modalDisetor}), 0)::bigint`,
    })
    .from(investors)
    .where(and(eq(investors.status, "active"), isNull(investors.deletedAt)));
  const sourceTotal = Number(modalAgg?.total ?? 0);

  const ledger = await getAccountBalance("3101");
  if (!ledger.accountId) {
    warn("Account 3101 (Modal Owner) tidak ada di chart_of_accounts — skip");
    return;
  }
  compareWithTolerance(
    "3101 Modal Owner",
    sourceTotal,
    ledger.balance,
  );
}

async function checkCrossLedgerDividendBalance() {
  console.log(
    "\n=== 7. Σ dividend_balance (investors) vs 3202 Hutang Dividen balance ===",
  );
  const [divAgg] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${investors.dividendBalance}), 0)::bigint`,
    })
    .from(investors)
    .where(isNull(investors.deletedAt));
  const sourceTotal = Number(divAgg?.total ?? 0);

  const ledger = await getAccountBalance("3202");
  if (!ledger.accountId) {
    if (sourceTotal === 0) {
      ok(
        "3202 Hutang Dividen tidak ada di COA + tidak ada saldo dividen = trivially consistent",
      );
    } else {
      fail(
        `Account 3202 tidak ada di COA tapi Σ dividend_balance = ${fmtIDR(sourceTotal)} — seed account dulu via Cutover Wizard`,
      );
    }
    return;
  }
  compareWithTolerance(
    "3202 Hutang Dividen",
    sourceTotal,
    ledger.balance,
  );
}

async function checkCrossLedgerCreditorOutstanding() {
  console.log(
    "\n=== 8. Σ creditor.outstanding vs 2150 Hutang Kreditur balance ===",
  );
  const [credAgg] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${creditors.principalOutstanding}), 0)::bigint`,
    })
    .from(creditors)
    .where(
      and(
        eq(creditors.status, "active"),
        isNull(creditors.deletedAt),
      ),
    );
  const sourceTotal = Number(credAgg?.total ?? 0);

  const ledger = await getAccountBalance("2150");
  if (!ledger.accountId) {
    if (sourceTotal === 0) {
      ok(
        "2150 Hutang Kreditur tidak ada di COA + tidak ada outstanding = trivially consistent",
      );
    } else {
      fail(
        `Account 2150 tidak ada di COA tapi Σ outstanding = ${fmtIDR(sourceTotal)} — seed account dulu`,
      );
    }
    return;
  }
  compareWithTolerance(
    "2150 Hutang Kreditur",
    sourceTotal,
    ledger.balance,
  );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("== Modal & Dividen v2 — Audit Invariant (sesi AE-84) ==");
  console.log(
    `   Mode: ${STRICT ? "STRICT" : `tolerate <${DRIFT_TOLERANCE_PCT}% cross-ledger drift`}${VERBOSE ? " (verbose)" : ""}`,
  );

  await checkShareSum();
  await checkDividendBalanceConsistency();
  await checkCreditorOutstanding();
  await checkJournalLinks();
  await checkJournalSources();
  await checkCrossLedgerModal();
  await checkCrossLedgerDividendBalance();
  await checkCrossLedgerCreditorOutstanding();

  console.log("\n" + "=".repeat(60));
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log("✓ ALL INVARIANTS OK");
    process.exit(0);
  } else if (totalErrors === 0) {
    console.log(
      `✓ Hard invariants OK (${totalWarnings} soft warning${totalWarnings === 1 ? "" : "s"})`,
    );
    process.exit(0);
  } else {
    console.log(
      `✗ ${totalErrors} HARD INVARIANT(S) VIOLATED${totalWarnings > 0 ? ` + ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}` : ""}`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
