/** Sesi AE-180 — lihat isi internal_debt_parties (READ-ONLY, approved owner). */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(
    `select id, name, party_type, phone, bank_name, total_outstanding, created_at, deleted_at
     from internal_debt_parties order by created_at desc`,
  );
  console.table(r.rows);
  await pool.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
