/**
 * `npx tsx scripts/close-all-shifts.ts` — force-close ALL active shifts.
 *
 * USE CASE: smoke-test cleanup. Multiple kasir mungkin punya shift open
 * yang stuck karena open-bill blocker. Script ini close semua shift aktif
 * dengan variance=0 supaya kasir bisa start fresh.
 *
 * USAGE:
 *   npx tsx scripts/close-all-shifts.ts            → dry-run, list shift aktif
 *   npx tsx scripts/close-all-shifts.ts --confirm  → actually close
 *
 * SAFETY: requires --confirm flag. Variance set to 0 (asumsi smoke-test
 * data sudah di-wipe via npm run wipe:test-data dulu, jadi opening_cash
 * == actual_cash).
 *
 * NOT FOR PRODUCTION. Once real ops dimulai, kasir tutup shift via UI
 * dengan input actual_cash beneran (untuk variance reconciliation).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set in .env.local");
  process.exit(1);
}

const confirmed = process.argv.includes("--confirm");

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log("─".repeat(60));
  console.log(`Mode: ${confirmed ? "🔥 EXECUTE" : "🔍 DRY-RUN (use --confirm to actually close)"}`);
  console.log("─".repeat(60));

  const r = await pool.query(`
    SELECT s.id, s.opened_at, u.name AS cashier_name
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'open'
    ORDER BY s.opened_at ASC
  `);

  if (r.rows.length === 0) {
    console.log("✅ No active shifts. Nothing to close.");
    await pool.end();
    return;
  }

  console.log(`Found ${r.rows.length} active shifts:`);
  for (const row of r.rows) {
    console.log(`  - ${row.id} (${row.cashier_name}, opened ${row.opened_at})`);
  }
  console.log("─".repeat(60));

  if (!confirmed) {
    console.log("");
    console.log("ℹ️  DRY-RUN — no shifts closed.");
    console.log("   Run with --confirm flag to actually close them all.");
    console.log("");
    await pool.end();
    return;
  }

  const closed = await pool.query(`
    UPDATE shifts
    SET status = 'closed',
        closed_at = NOW(),
        actual_cash = opening_cash,
        variance = 0
    WHERE status = 'open'
    RETURNING id
  `);

  console.log(`✅ Closed ${closed.rowCount} shifts.`);
  console.log("");
  console.log("Next: kasir bisa buka shift baru via UI POS.");

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
