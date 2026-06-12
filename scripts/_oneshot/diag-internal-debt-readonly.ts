/** Sesi AE-180 — diagnosa READ-ONLY tabel internal_debt_* (approved owner). */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import {
  internalDebtParties,
  internalDebtEntries,
  internalDebtRepayments,
} from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const t = await pool.query(
    `select table_name from information_schema.tables where table_name like 'internal_debt%' order by 1`,
  );
  console.log("tables:", t.rows.map((r: { table_name: string }) => r.table_name));

  for (const [name, tbl] of [
    ["parties", internalDebtParties],
    ["entries", internalDebtEntries],
    ["repayments", internalDebtRepayments],
  ] as const) {
    try {
      const rows = await db.select().from(tbl).limit(1);
      console.log(`drizzle select ${name}: OK (${rows.length} rows)`);
    } catch (e) {
      console.error(
        `drizzle select ${name}: ERROR ->`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  const c = await pool
    .query(
      `select conname from pg_constraint where conrelid = 'internal_debt_parties'::regclass`,
    )
    .catch((e) => ({ rows: [{ conname: "ERR " + String(e).slice(0, 80) }] }));
  console.log(
    "constraints parties:",
    c.rows.map((r: { conname: string }) => r.conname),
  );

  const m = await pool.query(
    `select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 2`,
  );
  console.log("latest applied migrations:", m.rows);

  await pool.end();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
