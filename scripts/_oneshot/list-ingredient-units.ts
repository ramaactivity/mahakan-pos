/**
 * One-shot: list distinct units used in ingredients to verify
 * unit-aware seed mapping covers all cases.
 *
 * Run: npx tsx scripts/_oneshot/list-ingredient-units.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db.execute(sql`
    SELECT unit, COUNT(*) AS n
    FROM ingredients
    WHERE deleted_at IS NULL AND is_active = true
    GROUP BY unit
    ORDER BY n DESC
  `);
  for (const r of rows.rows) {
    console.log(`  ${String(r.unit).padEnd(10)} — ${r.n}`);
  }

  await pool.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
