/**
 * Sesi AE-62t — sanity check sebelum bikin migration UNIQUE constraint.
 *
 * Cek 2 hal:
 *   1. journal_entries — apakah ada duplicate (outlet, source_type, source_id)
 *      di antara entries yang status='posted' atau 'draft'? Reversed entries
 *      di-skip karena legal-duplicate (post → reverse → re-post pattern).
 *   2. transactions — apakah ada duplicate pager_number per shift di antara
 *      open bills? Race condition kalau 2 kasir input sama.
 *
 * Read-only. Run: npx tsx scripts/_oneshot/check-journal-pager-dupes.ts
 *
 * Output:
 *   - "OK: no duplicates" → safe untuk migration
 *   - List of duplicate rows → harus di-resolve manual dulu sebelum migrate
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    // 1. journal_entries duplicate check
    console.log("=== Check 1: journal_entries duplicates ===");
    const jeDupes = await c.query(`
      SELECT outlet_id, source_type, source_id, COUNT(*) AS cnt,
             ARRAY_AGG(id ORDER BY created_at) AS entry_ids,
             ARRAY_AGG(entry_number ORDER BY created_at) AS entry_numbers,
             ARRAY_AGG(status ORDER BY created_at) AS statuses
      FROM journal_entries
      WHERE source_id IS NOT NULL
        AND status IN ('posted', 'draft')
      GROUP BY outlet_id, source_type, source_id
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 50
    `);
    if (jeDupes.rows.length === 0) {
      console.log("  OK: no duplicates di active journal entries");
    } else {
      console.log(`  FOUND ${jeDupes.rows.length} duplicate (outlet,sourceType,sourceId) groups:`);
      for (const r of jeDupes.rows) {
        console.log(
          `    ${String(r.source_type).padEnd(28)} src=${String(r.source_id).slice(0, 8)} cnt=${r.cnt} entries=${(r.entry_numbers as string[]).join(",")} statuses=${(r.statuses as string[]).join(",")}`,
        );
      }
      console.log("  ⚠️  Migration UNIQUE constraint AKAN GAGAL kalau ada dupes.");
      console.log("  Action: review per-row → keep correct entry, soft-delete (status='reversed') sisanya.");
    }

    // 2. pager_number duplicate check (per shift, open bills only)
    console.log("\n=== Check 2: pager_number duplicates (open bills) ===");
    const pagerDupes = await c.query(`
      SELECT shift_id, pager_number, COUNT(*) AS cnt,
             ARRAY_AGG(id ORDER BY created_at) AS trx_ids,
             ARRAY_AGG(transaction_number ORDER BY created_at) AS trx_numbers
      FROM transactions
      WHERE pager_number IS NOT NULL
        AND status = 'open'
      GROUP BY shift_id, pager_number
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 50
    `);
    if (pagerDupes.rows.length === 0) {
      console.log("  OK: no duplicates di open-bill pager numbers");
    } else {
      console.log(`  FOUND ${pagerDupes.rows.length} duplicate (shift, pager) groups:`);
      for (const r of pagerDupes.rows) {
        console.log(
          `    shift=${String(r.shift_id).slice(0, 8)} pager=${r.pager_number} cnt=${r.cnt} trxNumbers=${(r.trx_numbers as string[]).join(",")}`,
        );
      }
      console.log("  ⚠️  Migration partial UNIQUE AKAN GAGAL kalau ada dupes.");
      console.log("  Action: kasir re-assign pager_number salah satu, atau close bill duplikat.");
    }

    // Summary
    console.log("\n=== Summary ===");
    if (jeDupes.rows.length === 0 && pagerDupes.rows.length === 0) {
      console.log("✓ Safe untuk apply migration");
    } else {
      console.log("✗ Resolve dupes dulu sebelum migrate");
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
