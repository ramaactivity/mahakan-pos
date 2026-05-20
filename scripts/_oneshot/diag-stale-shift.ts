import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const galihShiftId = "6d90d446-3e20-4858-bdec-50cf35715479";
    const t = await c.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::bigint AS total,
              MIN(created_at) AS first_at, MAX(created_at) AS last_at
       FROM transactions WHERE shift_id = $1`,
      [galihShiftId],
    );
    console.log("Galih's stale shift transactions:");
    for (const r of t.rows) {
      console.log(`  count=${r.n} total=Rp ${r.total} | range ${r.first_at?.toISOString().slice(0,16)} → ${r.last_at?.toISOString().slice(0,16)}`);
    }
    const paymethod = await c.query(
      `SELECT payment_method, COUNT(*)::int AS n, COALESCE(SUM(total), 0)::bigint AS total
       FROM transactions WHERE shift_id = $1 AND status = 'paid'
       GROUP BY payment_method`,
      [galihShiftId],
    );
    for (const r of paymethod.rows) {
      console.log(`  paymethod=${r.payment_method} count=${r.n} total=Rp ${r.total}`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
