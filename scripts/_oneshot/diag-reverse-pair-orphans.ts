/**
 * Sesi AE-64 — Diag reverse-pair orphans.
 *
 * Setelah fix Opsi C (mark both pair status='reversed'), kita perlu cek
 * apakah ada legacy reverse-pair di prod yang masih asymmetric:
 *   - Original status='reversed' + reversedByEntryId set
 *   - Counter status='posted' (belum ikut di-mark)
 * → counter floating posted bikin ledger net = -original (the original bug).
 *
 * Script ini READ-ONLY (default). Dengan --apply, mark counter status='reversed'
 * + set reversesEntryId pointer supaya konsisten dengan fix baru.
 *
 * Single transaction, ROLLBACK on error.
 *
 * Usage:
 *   npx tsx scripts/_oneshot/diag-reverse-pair-orphans.ts            # DRY
 *   npx tsx scripts/_oneshot/diag-reverse-pair-orphans.ts --apply    # FIX
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* Pair-orphan: original reversed dengan reversedByEntryId set,
     * tapi counter (pointed-to entry) MASIH status='posted'. */
    const r = await c.query(
      `SELECT
         orig.id          AS orig_id,
         orig.entry_number AS orig_number,
         orig.entry_date  AS orig_date,
         orig.description AS orig_desc,
         cnt.id           AS cnt_id,
         cnt.entry_number AS cnt_number,
         cnt.status       AS cnt_status,
         cnt.description  AS cnt_desc
       FROM journal_entries orig
       JOIN journal_entries cnt ON cnt.id = orig.reversed_by_entry_id
       WHERE orig.status = 'reversed'
         AND cnt.status  = 'posted'
       ORDER BY orig.entry_date DESC, orig.entry_number DESC`,
    );

    console.log(`Found ${r.rows.length} pair-orphan(s):\n`);
    for (const row of r.rows) {
      console.log(`  ORIG ${row.orig_number} (reversed) → CNT ${row.cnt_number} (still posted)`);
      console.log(`       ${row.orig_date} | ${row.orig_desc}`);
      console.log(`       counter: ${row.cnt_desc}`);
      console.log("");
    }

    if (r.rows.length === 0) {
      console.log("✅ No orphan pairs — all reverse pairs already symmetric.");
      return;
    }

    if (!apply) {
      console.log("DRY-RUN. Re-run dengan --apply untuk mark counter status='reversed'.");
      return;
    }

    console.log("Applying pair-void fix (mark counter status='reversed')…\n");
    await c.query("BEGIN");
    try {
      for (const row of r.rows) {
        await c.query(
          `UPDATE journal_entries
             SET status = 'reversed',
                 reverses_entry_id = $1,
                 updated_at = now()
           WHERE id = $2 AND status = 'posted'`,
          [row.orig_id, row.cnt_id],
        );
        console.log(`  ✓ ${row.cnt_number} → reversed (now pair-void with ${row.orig_number})`);
      }
      await c.query("COMMIT");
      console.log(`\n✅ Applied ${r.rows.length} pair-void fix(es). Ledger sekarang seharusnya benar.`);
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
