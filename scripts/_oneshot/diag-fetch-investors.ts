/**
 * Sesi AE-68 — Diag mirror fetchInvestors logic langsung via raw SQL
 * untuk isolate apakah bug di SQL atau di Drizzle interpolation.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";

const OUTLET_ID = "7c51a6dd-5aaf-47e4-8cf8-ab5426ed0ff4";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const conditionsCount = await c.query(
      `SELECT COUNT(*) AS n FROM investors
       WHERE outlet_id = $1 AND deleted_at IS NULL AND status = $2`,
      [OUTLET_ID, "active"],
    );
    console.log("count:", conditionsCount.rows[0].n);

    const baseRows = await c.query(
      `SELECT id, full_name, modal_disetor, status
       FROM investors
       WHERE outlet_id = $1 AND deleted_at IS NULL AND status = $2
       ORDER BY modal_disetor DESC, full_name
       LIMIT $3 OFFSET $4`,
      [OUTLET_ID, "active", 200, 0],
    );
    console.log("baseRows:", baseRows.rows.length);

    const ids = baseRows.rows.map((r) => r.id);
    const yearStart = new Date(
      `${new Date().getUTCFullYear()}-01-01T00:00:00+07:00`,
    );
    const aggRows = await c.query(
      `SELECT
         holder_id,
         COUNT(*) AS movement_count
       FROM capital_movements
       WHERE holder_type = 'investor'
         AND outlet_id = $1
         AND holder_id = ANY($2::uuid[])
       GROUP BY holder_id`,
      [OUTLET_ID, ids],
    );
    console.log("aggRows:", aggRows.rows.length);
    console.log("✅ All queries succeeded.");
  } catch (e) {
    console.error("❌ ERROR:", (e as Error).message);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(console.error);
