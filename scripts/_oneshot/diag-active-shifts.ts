import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const r = await c.query(`
      SELECT s.id, s.outlet_id, s.user_id, s.status, s.opening_cash,
             s.opened_at, s.closed_at, u.name AS user_name, u.role
      FROM shifts s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.status = 'open'
      ORDER BY s.opened_at DESC
    `);
    console.log(`Active shifts (${r.rows.length}):`);
    for (const row of r.rows) {
      console.log(
        `  ${row.id} | outlet=${row.outlet_id} | ${row.user_name} (${row.role}) | opened=${row.opened_at?.toISOString()} | opening=Rp ${row.opening_cash}`,
      );
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
