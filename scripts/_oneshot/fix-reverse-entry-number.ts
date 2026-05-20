/**
 * Hotfix untuk reverse entry yang punya entry_number malformed
 * "JE-Wed Ma-0049" karena Date object di-string'ed wrong.
 * Re-generate proper number "JE-202605-NNNN".
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* Find malformed entry */
    const r = await c.query(
      `SELECT je.id, je.entry_number, je.entry_date, je.period_id, je.description
       FROM journal_entries je
       WHERE je.entry_number LIKE 'JE-Wed%' OR je.entry_number !~ '^JE-[0-9]{6}-[0-9]{4}$'`,
    );
    console.log(`Found ${r.rows.length} malformed entry_number:`);
    for (const row of r.rows) {
      console.log(`  ${row.id} | "${row.entry_number}" | ${row.entry_date} | ${row.description}`);
    }
    if (r.rows.length === 0) return;

    if (!apply) {
      console.log("\nDRY-RUN. Add --apply to fix.");
      return;
    }

    console.log("\nApplying fixes…");
    await c.query("BEGIN");
    try {
      for (const row of r.rows) {
        const d = new Date(row.entry_date);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const yyyymm = `${yyyy}${mm}`;
        /* Get max suffix in same period to avoid collision */
        const [{ maxn }] = (
          await c.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '\\d{4}$') AS int)), 0)::int AS maxn
             FROM journal_entries
             WHERE period_id = $1 AND entry_number ~ '^JE-[0-9]{6}-[0-9]{4}$'`,
            [row.period_id],
          )
        ).rows;
        const seq = maxn + 1;
        const newNumber = `JE-${yyyymm}-${String(seq).padStart(4, "0")}`;
        await c.query(
          `UPDATE journal_entries SET entry_number = $1, updated_at = NOW() WHERE id = $2`,
          [newNumber, row.id],
        );
        console.log(`  ✓ ${row.id} | "${row.entry_number}" → "${newNumber}"`);
      }
      await c.query("COMMIT");
      console.log("✅ Done");
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
