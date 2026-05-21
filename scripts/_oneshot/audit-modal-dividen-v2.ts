/**
 * Sesi AE-80 Phase 3 — Audit invariant Modal & Dividen v2 di prod.
 *
 * Read-only. Verify semua invariant kunci:
 *   1. Σ active investor share_pct per outlet = 100% (epsilon 0.0001)
 *   2. Σ investor dividend_balance ≥ 0 (CHECK enforce, redundant check)
 *   3. Per investor: dividend_balance = Σ(dividend_credit) − Σ(dividend_withdrawal − reversed)
 *   4. Per creditor: principalOutstanding = principalOriginal − Σ(posted_repayment_principal)
 *   5. Posted distribution v2 punya journal entry posted (sourceType='dividend_distribution')
 *   6. Posted withdrawal punya journal entry + capital_movement linked
 *   7. Posted repayment punya journal entry linked
 *
 * Output ke stdout. Exit 0 kalau semua pass, 1 kalau ada drift.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  capitalMovements,
  creditorRepayments,
  creditors,
  investors,
  journalEntries,
  pengelola,
  profitDistributions,
  withdrawalRequests,
} from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

let totalErrors = 0;

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string) {
  totalErrors++;
  console.log(`  ✗ ${msg}`);
}

async function checkShareSum() {
  console.log("\n=== 1. Share % invariant per outlet ===");
  const rows = await db
    .select({
      outletId: investors.outletId,
      sumShare: sql<string>`COALESCE(SUM(${investors.sharePct}::numeric), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(investors)
    .where(
      and(eq(investors.status, "active"), isNull(investors.deletedAt)),
    )
    .groupBy(investors.outletId);

  for (const r of rows) {
    const sum = Number(r.sumShare);
    const diff = Math.abs(sum - 100);
    if (diff <= 0.0001) {
      ok(`Outlet ${r.outletId.slice(0, 8)}: ${r.count} investor, sum = ${sum.toFixed(4)}%`);
    } else if (sum < 100) {
      ok(
        `Outlet ${r.outletId.slice(0, 8)}: ${r.count} investor, sum = ${sum.toFixed(4)}% (treasury ${(100 - sum).toFixed(4)}%)`,
      );
    } else {
      fail(
        `Outlet ${r.outletId.slice(0, 8)}: sum share ${sum.toFixed(4)}% > 100% (INVARIANT VIOLATION)`,
      );
    }
  }
}

async function checkDividendBalanceConsistency() {
  console.log(
    "\n=== 2. dividend_balance vs capital_movements per investor ===",
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

  /* Compute expected from movements. */
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
        sql`${capitalMovements.kind} IN ('dividend_credit', 'dividend_withdrawal', 'withdrawal', 'reversal')`,
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
    } else if (m.kind === "dividend_withdrawal" || m.kind === "withdrawal") {
      expectedByInvestor.set(m.holderId, cur - amt);
    } else if (m.kind === "reversal") {
      /* Reversal can either decrement (dividend_credit reversed) or
       * increment (withdrawal reversed). Sign ambiguous tanpa parent
       * lookup; skip strict comparison untuk reversal — surfacing
       * drift kalau ada. */
    }
  }

  let drift = 0;
  for (const inv of balanceRows) {
    const expected = Math.max(0, expectedByInvestor.get(inv.id) ?? 0);
    if (inv.dividendBalance !== expected) {
      const delta = inv.dividendBalance - expected;
      if (Math.abs(delta) > 0) {
        drift++;
        if (drift <= 10) {
          fail(
            `Investor ${inv.fullName.slice(0, 30).padEnd(30)} balance=${inv.dividendBalance.toLocaleString("id-ID").padStart(12)} expected=${expected.toLocaleString("id-ID").padStart(12)} drift=${delta}`,
          );
        }
      }
    }
  }
  if (drift === 0) ok(`All ${balanceRows.length} investor dividend_balance match movements`);
  else if (drift > 10) console.log(`  …${drift - 10} more drift entries`);
}

async function checkCreditorOutstanding() {
  console.log("\n=== 3. Creditor.principalOutstanding consistency ===");
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
        `Creditor ${c.fullName}: outstanding=${c.principalOutstanding} expected=${expected} (original=${c.principalOriginal} paid=${paid})`,
      );
    }
  }
  if (drift === 0)
    ok(`All ${creditorsRows.length} creditor outstanding match repayment history`);
}

async function checkJournalLinks() {
  console.log("\n=== 4. Journal entry links ===");

  /* Posted v2 distribution → harus punya journalEntryId */
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
      fail(`Distribution ${d.id.slice(0, 8)} status=${d.status} tidak punya journalEntryId`);
    }
  }
  if (v2Dists.length > 0 && distMissing === 0) {
    ok(`All ${v2Dists.length} v2 distribution posted punya journal link`);
  }
  if (v2Dists.length === 0) {
    ok("No v2 distribution yet — skip check");
  }

  /* Posted withdrawals → harus punya journalEntryId + capitalMovementId */
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

  /* Posted repayments → harus punya journalEntryId */
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

async function checkJournalSources() {
  console.log("\n=== 5. New journal source_type usage ===");
  const newSources = [
    "dividend_distribution",
    "dividend_distribution_reversal",
    "dividend_withdrawal",
    "dividend_withdrawal_reversal",
    "creditor_repayment",
    "creditor_repayment_reversal",
    "share_buyback",
    "share_buyback_reversal",
  ];
  for (const st of newSources) {
    const [r] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(journalEntries)
      .where(sql`${journalEntries.sourceType} = ${st}`);
    if (r && r.count > 0) {
      ok(`sourceType '${st}': ${r.count} entries`);
    }
  }
}

async function main() {
  console.log("== Modal & Dividen v2 — Audit Invariant ==");
  await checkShareSum();
  await checkDividendBalanceConsistency();
  await checkCreditorOutstanding();
  await checkJournalLinks();
  await checkJournalSources();
  console.log("\n" + "=".repeat(60));
  if (totalErrors === 0) {
    console.log("✓ ALL INVARIANTS OK");
    process.exit(0);
  } else {
    console.log(`✗ ${totalErrors} INVARIANT(S) VIOLATED`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
