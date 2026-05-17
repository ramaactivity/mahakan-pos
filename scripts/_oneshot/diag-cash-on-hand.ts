/**
 * Diagnose Setoran Tunai discrepancy + legacy QRIS shifts (sesi AE-62f).
 * Read-only. Run: npx tsx scripts/_oneshot/diag-cash-on-hand.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  // 1. All closed shifts last 30 days
  const shiftsRes = await c.query(`
    SELECT id, user_id, opening_cash, actual_cash, variance, qris_settlement,
           edc_settlement, opened_at, closed_at, status
    FROM shifts
    WHERE closed_at >= NOW() - interval '30 days'
    ORDER BY closed_at DESC NULLS LAST
  `);
  console.log("Shifts (last 30d):");
  for (const r of shiftsRes.rows) {
    console.log(
      `  ${r.id.slice(0,8)} | ${r.status.padEnd(7)} | opening=${r.opening_cash} actual=${r.actual_cash ?? '-'} variance=${r.variance ?? '-'} qris=${r.qris_settlement ?? 'NULL'} edc=${r.edc_settlement ?? 'NULL'} closed=${r.closed_at ? new Date(r.closed_at).toISOString() : '-'}`,
    );
  }

  // 2. For each closed shift with NULL qris_settlement, compute derived qris sales
  const legacyQris = await c.query(`
    SELECT s.id, s.closed_at,
           COALESCE(SUM(CASE WHEN t.payment_method='qris' AND t.status='paid' THEN t.total ELSE 0 END), 0) AS qris_actual,
           COALESCE(SUM(CASE WHEN t.payment_method IN ('card_bca','card') AND t.status='paid' THEN t.total ELSE 0 END), 0) AS card_actual
    FROM shifts s
    LEFT JOIN transactions t ON t.shift_id = s.id
    WHERE s.qris_settlement IS NULL AND s.status='closed'
    GROUP BY s.id, s.closed_at
    HAVING COALESCE(SUM(CASE WHEN t.payment_method='qris' AND t.status='paid' THEN t.total ELSE 0 END), 0) > 0
       OR COALESCE(SUM(CASE WHEN t.payment_method IN ('card_bca','card') AND t.status='paid' THEN t.total ELSE 0 END), 0) > 0
    ORDER BY s.closed_at DESC
    LIMIT 20
  `);
  console.log("\nLegacy shifts dengan QRIS/Card sales tapi qris_settlement NULL:");
  for (const r of legacyQris.rows) {
    console.log(`  ${r.id.slice(0,8)} closed=${r.closed_at?.toISOString().slice(0,16)} qris_actual=${r.qris_actual} card_actual=${r.card_actual}`);
  }

  // 3. Last 5 cash_deposits
  const deposits = await c.query(`
    SELECT id, deposit_date, amount, bank_destination, status, covers_from_date, covers_to_date, verified_at
    FROM cash_deposits ORDER BY created_at DESC LIMIT 5
  `);
  console.log("\nRecent deposits:");
  for (const r of deposits.rows) {
    console.log(`  ${r.id.slice(0,8)} ${r.deposit_date} amt=${r.amount} status=${r.status} covers=${r.covers_from_date}..${r.covers_to_date} verified=${r.verified_at?.toISOString().slice(0,16) ?? '-'}`);
  }

  // 4. Cumulative cash sales vs deposits (CashOnHand math VERIFICATION)
  const sumRes = await c.query(`
    WITH cash_in AS (
      SELECT COALESCE(SUM(opening_cash), 0)::bigint AS opening_sum FROM shifts WHERE status='closed'
    ),
    cash_sales AS (
      SELECT COALESCE(SUM(t.total), 0)::bigint AS total FROM transactions t
      JOIN shifts s ON s.id = t.shift_id
      WHERE s.status='closed' AND t.payment_method='cash' AND t.status='paid'
    ),
    cash_refunded AS (
      SELECT COALESCE(SUM(t.total), 0)::bigint AS total FROM transactions t
      JOIN shifts s ON s.id = t.shift_id
      WHERE s.status='closed' AND t.payment_method='cash' AND t.status='refunded'
    ),
    cash_exp AS (
      SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM expenses
      WHERE payment_method='cash' AND deleted_at IS NULL
    ),
    deps_verified AS (
      SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM cash_deposits WHERE status='verified'
    )
    SELECT
      (SELECT opening_sum FROM cash_in) AS opening_sum,
      (SELECT total FROM cash_sales) AS sales,
      (SELECT total FROM cash_refunded) AS refunded,
      (SELECT total FROM cash_exp) AS expenses,
      (SELECT total FROM deps_verified) AS deposits
  `);
  const s = sumRes.rows[0];
  console.log("\nLifetime totals (all closed shifts):");
  console.log(`  opening_sum:  ${s.opening_sum}`);
  console.log(`  cash_sales:   ${s.sales}`);
  console.log(`  cash_refunded:${s.refunded}`);
  console.log(`  cash_expenses:${s.expenses}`);
  console.log(`  deposits_verified:${s.deposits}`);
  const cashOnHand_currentBug =
    Number(s.opening_sum) + Number(s.sales) - Number(s.refunded) - Number(s.expenses) - Number(s.deposits);
  const cashOnHand_fixed =
    Number(s.sales) - Number(s.refunded) - Number(s.expenses) - Number(s.deposits);
  console.log(`  cashOnHand BUG (opening + sales - refund - exp - dep): ${cashOnHand_currentBug}`);
  console.log(`  cashOnHand FIX (sales - refund - exp - dep):            ${cashOnHand_fixed}`);
} finally {
  c.release();
  await pool.end();
}
}
main().catch((e) => { console.error(e); process.exit(1); });
