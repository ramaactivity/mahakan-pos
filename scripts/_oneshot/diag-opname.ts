/**
 * Quick diagnostic for opname start failure (sesi AE-62e).
 * Read-only. Run: npx tsx scripts/_oneshot/diag-opname.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  // 1. Active sessions
  const sActive = await c.query(
    `SELECT id, outlet_id, period_label, status, started_at FROM stock_opname_sessions WHERE status IN ('in_progress','pending_review')`,
  );
  console.log("Active sessions:", sActive.rows);

  // 2. Active ingredient count
  const ings = await c.query(
    `SELECT COUNT(*)::int AS n FROM ingredients WHERE is_active=true AND deleted_at IS NULL`,
  );
  console.log("Active ingredients (count):", ings.rows[0]);

  // 3. Weird stock/cost
  const weird = await c.query(
    `SELECT id, name, unit, section, current_stock, current_stock_decimal, cost_per_unit
     FROM ingredients
     WHERE is_active=true AND deleted_at IS NULL
       AND (current_stock < 0 OR cost_per_unit < 0 OR unit IS NULL OR unit='' OR name IS NULL OR name='')
     LIMIT 20`,
  );
  console.log("Weird stock/cost/unit rows:", weird.rows);

  // 4. Check NULL in is_active or weird outlet
  const outlets = await c.query(
    `SELECT outlet_id, COUNT(*)::int AS n FROM ingredients WHERE is_active=true AND deleted_at IS NULL GROUP BY outlet_id`,
  );
  console.log("Active ingredients per outlet:", outlets.rows);

  // 5. Check stock_opname_lines schema
  const cols = await c.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_name='stock_opname_lines' ORDER BY ordinal_position`,
  );
  console.log("stock_opname_lines columns:");
  for (const r of cols.rows)
    console.log(
      `  ${r.column_name} ${r.data_type} nullable=${r.is_nullable} default=${r.column_default || "-"}`,
    );

  // 6. Constraints
  const checks = await c.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid IN ('stock_opname_lines'::regclass, 'stock_opname_sessions'::regclass) ORDER BY conname`,
  );
  console.log("Constraints:");
  for (const r of checks.rows) console.log(`  ${r.conname}: ${r.def}`);

  // 7. Cancelled / completed sessions count
  const allSess = await c.query(
    `SELECT status, COUNT(*)::int AS n FROM stock_opname_sessions GROUP BY status`,
  );
  console.log("Session counts by status:", allSess.rows);

  // 8. Sample first ingredient (data we'd snapshot)
  const sample = await c.query(
    `SELECT id, outlet_id, name, unit, section, current_stock, current_stock_decimal, cost_per_unit, is_active
     FROM ingredients
     WHERE is_active=true AND deleted_at IS NULL
     ORDER BY name LIMIT 3`,
  );
  console.log("Sample first ingredients:", sample.rows);

  // 9. Audit logs for opname.start / system reset recently
  const audit = await c.query(
    `SELECT event_type, created_at, payload->>'summary' AS summary
     FROM audit_logs
     WHERE event_type IN ('inventory.opname.start','system.reset_mockup_data')
     ORDER BY created_at DESC LIMIT 10`,
  );
  console.log("Recent audit:", audit.rows);
} finally {
  c.release();
  await pool.end();
}
}
main().catch((e) => { console.error(e); process.exit(1); });
