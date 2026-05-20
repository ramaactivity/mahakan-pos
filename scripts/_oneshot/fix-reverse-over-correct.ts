/**
 * Sesi AE-63 phase8 — Hard-delete BOTH original payroll JE + counter-entry
 * supaya ledger benar-benar reset ke pre-Bayu state.
 *
 * Reason: existing `reverseJournalEntry` logic mark original status='reversed'
 * + create counter status='posted'. Ledger query `getAccountBalances`
 * filter `status='posted'` → original excluded, counter included →
 * net -4.71M (OVER-REVERSE BUG di existing logic).
 *
 * Untuk test data scrub: hard-delete both entries. Audit log tetap ada
 * (separate table). FK on delete cascade ke journal_lines.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* Find the original + reverse pair from test cleanup */
    const r = await c.query(
      `SELECT id, entry_number, status, description
       FROM journal_entries
       WHERE entry_number IN ('JE-202605-0047', 'JE-202605-0049')`,
    );
    console.log(`Entries to hard-delete (${r.rows.length}):`);
    for (const row of r.rows) {
      console.log(`  ${row.entry_number} | ${row.status} | ${row.description}`);
    }
    if (r.rows.length === 0) {
      console.log("Nothing to delete.");
      return;
    }

    if (!apply) {
      console.log("\nDRY-RUN. Re-run with --apply.");
      return;
    }

    console.log("\nApplying hard-delete…");
    await c.query("BEGIN");
    try {
      const ids = r.rows.map((r) => r.id);
      /* Step 1: clear cross-references supaya FK self-ref tidak block */
      await c.query(
        `UPDATE journal_entries SET reversed_by_entry_id = NULL, reverses_entry_id = NULL
         WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      /* Step 2: hard-delete (cascade to journal_lines via FK) */
      const del = await c.query(
        `DELETE FROM journal_entries WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      console.log(`✓ Deleted ${del.rowCount} entries (cascade lines)`);
      await c.query("COMMIT");
      console.log("✅ Commit done");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
