/**
 * Sesi AE-80 — Backfill script untuk Phase 1 migration (modal-dividen-v2).
 *
 * Setelah `drizzle-kit migrate` applied (kolom baru added):
 *   1. investors.share_pct: hitung dari modal_disetor / SUM(modal_disetor) × 100 per outlet.
 *      Result rounded to 4 decimal places. Investor terakhir per outlet
 *      menyerap residue supaya SUM = 100.0000 exact.
 *   2. investors.dividend_balance: sum(capital_movements WHERE kind='dividend_credit')
 *      MINUS sum(capital_movements WHERE kind='withdrawal'). GREATEST(0, computed)
 *      untuk handle legacy negative cases.
 *   3. pengelola.dividend_balance: same pattern (untuk pengelola holder_type).
 *   4. profit_distributions.calculation_model: sudah default 'v1' via migration,
 *      no UPDATE needed.
 *
 * Read+write. Dry-run default. Set EXEC=1 untuk apply.
 *
 * Idempotent: safe to re-run; akan compute fresh dari data current.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, sql } from "drizzle-orm";
import { capitalMovements, investors, pengelola } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const dryRun = process.env.EXEC !== "1";

interface InvestorMovementAgg {
  investorId: string;
  outletId: string;
  modalDisetor: number;
  creditedDividend: number;
  withdrawnDividend: number;
}

async function backfillSharePct() {
  console.log("\n=== 1. Backfill investors.share_pct ===");

  /* Read semua active investor per outlet. */
  const rows = await db
    .select({
      id: investors.id,
      outletId: investors.outletId,
      fullName: investors.fullName,
      modalDisetor: investors.modalDisetor,
      sharePct: investors.sharePct,
    })
    .from(investors)
    .where(sql`${investors.deletedAt} IS NULL`)
    .orderBy(investors.outletId, investors.modalDisetor);

  /* Group per outlet, compute share per investor. */
  const byOutlet = new Map<
    string,
    Array<{
      id: string;
      fullName: string;
      modal: number;
      computedShare: number;
    }>
  >();

  for (const r of rows) {
    if (!byOutlet.has(r.outletId)) byOutlet.set(r.outletId, []);
    byOutlet
      .get(r.outletId)!
      .push({
        id: r.id,
        fullName: r.fullName,
        modal: r.modalDisetor,
        computedShare: 0,
      });
  }

  const updates: Array<{ id: string; share: string }> = [];

  for (const [outletId, investorsInOutlet] of byOutlet.entries()) {
    const totalModal = investorsInOutlet.reduce((s, i) => s + i.modal, 0);
    if (totalModal === 0) {
      console.log(
        `  ⚠ Outlet ${outletId.slice(0, 8)}: total modal = 0, skip`,
      );
      continue;
    }

    /* Compute share per investor, round to 4 decimal. Last investor
     * absorb residue supaya sum = 100.0000 exact. */
    let accumShare = 0;
    for (let i = 0; i < investorsInOutlet.length - 1; i++) {
      const inv = investorsInOutlet[i];
      const share = Math.round((inv.modal / totalModal) * 100 * 10000) / 10000;
      inv.computedShare = share;
      accumShare += share;
    }
    const last = investorsInOutlet[investorsInOutlet.length - 1];
    last.computedShare = Math.round((100 - accumShare) * 10000) / 10000;

    console.log(
      `  Outlet ${outletId.slice(0, 8)}: ${investorsInOutlet.length} investor, total modal Rp ${totalModal.toLocaleString("id-ID")}`,
    );
    for (const inv of investorsInOutlet) {
      console.log(
        `    ${inv.fullName.padEnd(30).slice(0, 30)} modal=${inv.modal.toLocaleString("id-ID").padStart(15)} share=${inv.computedShare.toFixed(4)}%`,
      );
      updates.push({ id: inv.id, share: inv.computedShare.toFixed(4) });
    }
  }

  if (!dryRun) {
    for (const u of updates) {
      await db
        .update(investors)
        .set({ sharePct: u.share })
        .where(eq(investors.id, u.id));
    }
    console.log(`  ✓ Updated ${updates.length} investor share_pct`);
  } else {
    console.log(`  [DRY] Would update ${updates.length} investor share_pct`);
  }
}

async function backfillDividendBalance() {
  console.log("\n=== 2. Backfill investors.dividend_balance ===");

  /* Aggregate per investor: SUM dividend_credit − SUM withdrawal. */
  const rows = await db
    .select({
      holderId: capitalMovements.holderId,
      kind: capitalMovements.kind,
      sumAmount: sql<number>`SUM(${capitalMovements.amount})::bigint`,
    })
    .from(capitalMovements)
    .where(
      and(
        eq(capitalMovements.holderType, "investor"),
        sql`${capitalMovements.kind} IN ('dividend_credit', 'withdrawal')`,
        sql`${capitalMovements.reversedAt} IS NULL`,
      ),
    )
    .groupBy(capitalMovements.holderId, capitalMovements.kind);

  const byInvestor = new Map<
    string,
    { credited: number; withdrawn: number }
  >();
  for (const r of rows) {
    if (!byInvestor.has(r.holderId)) {
      byInvestor.set(r.holderId, { credited: 0, withdrawn: 0 });
    }
    const cur = byInvestor.get(r.holderId)!;
    if (r.kind === "dividend_credit") cur.credited = Number(r.sumAmount);
    else if (r.kind === "withdrawal") cur.withdrawn = Number(r.sumAmount);
  }

  console.log(`  Found ${byInvestor.size} investor with movement history`);

  const updates: Array<{ id: string; balance: number; legacy?: boolean }> = [];
  for (const [id, mov] of byInvestor.entries()) {
    const computed = mov.credited - mov.withdrawn;
    const balance = Math.max(0, computed);
    if (computed < 0) {
      console.log(
        `    ⚠ Investor ${id.slice(0, 8)}: computed=${computed} negative (legacy data) → clamp 0`,
      );
      updates.push({ id, balance, legacy: true });
    } else {
      updates.push({ id, balance });
    }
  }

  if (!dryRun) {
    for (const u of updates) {
      await db
        .update(investors)
        .set({ dividendBalance: u.balance })
        .where(eq(investors.id, u.id));
    }
    console.log(`  ✓ Updated ${updates.length} investor dividend_balance`);
  } else {
    console.log(`  [DRY] Would update ${updates.length} investor dividend_balance`);
  }
}

async function backfillPengelolaDividendBalance() {
  console.log("\n=== 3. Backfill pengelola.dividend_balance ===");

  const rows = await db
    .select({
      holderId: capitalMovements.holderId,
      kind: capitalMovements.kind,
      sumAmount: sql<number>`SUM(${capitalMovements.amount})::bigint`,
    })
    .from(capitalMovements)
    .where(
      and(
        eq(capitalMovements.holderType, "pengelola"),
        sql`${capitalMovements.kind} IN ('dividend_credit', 'withdrawal')`,
        sql`${capitalMovements.reversedAt} IS NULL`,
      ),
    )
    .groupBy(capitalMovements.holderId, capitalMovements.kind);

  const byPengelola = new Map<
    string,
    { credited: number; withdrawn: number }
  >();
  for (const r of rows) {
    if (!byPengelola.has(r.holderId)) {
      byPengelola.set(r.holderId, { credited: 0, withdrawn: 0 });
    }
    const cur = byPengelola.get(r.holderId)!;
    if (r.kind === "dividend_credit") cur.credited = Number(r.sumAmount);
    else if (r.kind === "withdrawal") cur.withdrawn = Number(r.sumAmount);
  }

  console.log(`  Found ${byPengelola.size} pengelola with movement history`);

  const updates: Array<{ id: string; balance: number }> = [];
  for (const [id, mov] of byPengelola.entries()) {
    const balance = Math.max(0, mov.credited - mov.withdrawn);
    updates.push({ id, balance });
  }

  if (!dryRun) {
    for (const u of updates) {
      await db
        .update(pengelola)
        .set({ dividendBalance: u.balance })
        .where(eq(pengelola.id, u.id));
    }
    console.log(`  ✓ Updated ${updates.length} pengelola dividend_balance`);
  } else {
    console.log(`  [DRY] Would update ${updates.length} pengelola dividend_balance`);
  }
}

async function verifyInvariants() {
  console.log("\n=== 4. Verify invariants ===");

  /* Σ active investor share_pct per outlet = 100% */
  const shareSums = await db
    .select({
      outletId: investors.outletId,
      sumShare: sql<string>`SUM(${investors.sharePct}::numeric)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(investors)
    .where(sql`${investors.deletedAt} IS NULL`)
    .groupBy(investors.outletId);

  for (const r of shareSums) {
    const sum = Number(r.sumShare);
    const ok = Math.abs(sum - 100) < 0.0001;
    console.log(
      `  Outlet ${r.outletId.slice(0, 8)}: ${r.count} investor, sum share = ${sum.toFixed(4)}% ${ok ? "✓" : "⚠ NOT 100%"}`,
    );
  }
}

async function main() {
  console.log(dryRun ? "[DRY RUN — set EXEC=1 to apply]" : "[APPLY MODE]");
  await backfillSharePct();
  await backfillDividendBalance();
  await backfillPengelolaDividendBalance();
  await verifyInvariants();
  console.log(dryRun ? "\nDry run complete. Re-run with EXEC=1 to apply." : "\n✓ Backfill complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
