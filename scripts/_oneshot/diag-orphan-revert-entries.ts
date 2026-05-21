/**
 * Sesi AE-69 — Diag orphan REVERT entries (cash_deposit_unverified) yang
 * TIDAK punya pasangan cash_deposit_verified yang status='posted'.
 *
 * Konteks: bug sebelum AE-69 fix, postJournalForCashDepositUnverified
 * always post REVERT JE tanpa pre-check apakah original ada. Kalau
 * lifecycle deposit aneh (unverify saat original sudah reversed lain,
 * dll), REVERT JE jadi orphan floating posted → muncul di Buku Besar
 * sebagai phantom credit.
 *
 * Detection: REVERT entry status='posted' WHERE source_type=
 * 'cash_deposit_unverified' AND tidak ada matching cash_deposit_verified
 * entry yang status='posted' untuk source_id yang sama.
 *
 * --apply: mark orphan REVERT sebagai status='reversed' untuk exclude
 * dari ledger sum.
 *
 * Usage:
 *   npx tsx scripts/_oneshot/diag-orphan-revert-entries.ts          # DRY
 *   npx tsx scripts/_oneshot/diag-orphan-revert-entries.ts --apply  # FIX
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const r = await c.query(
      `SELECT
         rev.id, rev.entry_number, rev.source_id, rev.description, rev.entry_date,
         orig.entry_number AS orig_number, orig.status AS orig_status
       FROM journal_entries rev
       LEFT JOIN journal_entries orig
         ON orig.source_type = 'cash_deposit_verified'
        AND orig.source_id = rev.source_id
        AND orig.outlet_id = rev.outlet_id
        AND orig.status = 'posted'
       WHERE rev.source_type = 'cash_deposit_unverified'
         AND rev.status = 'posted'
       ORDER BY rev.entry_date, rev.entry_number`,
    );
    console.log(`Orphan REVERT entries: ${r.rows.length}`);
    for (const row of r.rows) {
      const status = row.orig_number ? `pair_with=${row.orig_number}(${row.orig_status})` : "NO_PAIR";
      console.log(`  ${row.entry_number} | ${row.entry_date} | ${status} | ${row.description?.slice(0, 60)}`);
    }
    const orphans = r.rows.filter((x) => !x.orig_number);
    console.log(`\n${orphans.length} TRUE orphans (no matching cash_deposit_verified posted).`);

    if (orphans.length === 0) {
      console.log("✅ No orphans found.");
      return;
    }

    if (!apply) {
      console.log("\nDRY-RUN. Re-run dengan --apply untuk mark orphan as reversed.");
      return;
    }

    console.log("\nApplying fix (mark orphan REVERT as reversed)...\n");
    await c.query("BEGIN");
    try {
      for (const row of orphans) {
        await c.query(
          `UPDATE journal_entries
             SET status = 'reversed',
                 updated_at = now()
           WHERE id = $1 AND status = 'posted'`,
          [row.id],
        );
        console.log(`  ✓ ${row.entry_number} → reversed (orphan voided)`);
      }
      await c.query("COMMIT");
      console.log(`\n✅ ${orphans.length} orphan(s) marked reversed. Ledger sekarang seharusnya benar.`);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
