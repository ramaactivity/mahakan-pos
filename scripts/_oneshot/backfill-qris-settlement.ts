/**
 * Backfill qris_settlement untuk closed shifts pre-AE56 (sesi AE-62f).
 *
 * Pre AE-56 (2026-05-14 23:46 WIB), shift close action TIDAK populate
 * qris_settlement column. Akibatnya legacy closed shifts punya
 * qris_settlement=NULL even though real QRIS sales exist (sum di
 * transactions table).
 *
 * UI Shift History menampilkan "—" untuk kolom QRIS karena baca dari
 * qris_settlement, padahal seharusnya tampil real value. Owner finance
 * confused karena shift detail (compute live) menampilkan QRIS yang
 * tidak muncul di history table.
 *
 * Fix: backfill qris_settlement = SUM(transactions WHERE payment_method='qris'
 * AND status='paid') untuk closed shifts dengan qris_settlement IS NULL.
 *
 * USAGE:
 *   npx tsx scripts/_oneshot/backfill-qris-settlement.ts            → dry-run
 *   npx tsx scripts/_oneshot/backfill-qris-settlement.ts --confirm  → execute
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

const confirmed = process.argv.includes("--confirm");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    // 1. Preview shifts yang affected
    const preview = await c.query(`
      SELECT s.id, s.closed_at, s.user_id,
             COALESCE(SUM(CASE WHEN t.payment_method='qris' AND t.status='paid' THEN t.total ELSE 0 END), 0)::bigint AS qris_derived
      FROM shifts s
      LEFT JOIN transactions t ON t.shift_id = s.id
      WHERE s.status='closed' AND s.qris_settlement IS NULL
      GROUP BY s.id
      ORDER BY s.closed_at DESC
    `);

    console.log(`Found ${preview.rows.length} closed shifts dengan qris_settlement NULL`);
    let toBackfill = 0;
    let totalQris = 0;
    for (const r of preview.rows) {
      const qris = Number(r.qris_derived);
      if (qris > 0) {
        toBackfill++;
        totalQris += qris;
        console.log(
          `  → ${r.id.slice(0, 8)} closed=${r.closed_at?.toISOString().slice(0, 16)} qris=${r.qris_derived}`,
        );
      }
    }
    console.log(`\n${toBackfill} shifts akan di-backfill, total QRIS = ${totalQris}`);
    const zeroShifts = preview.rows.length - toBackfill;
    if (zeroShifts > 0) {
      console.log(`(${zeroShifts} shifts dengan QRIS=0 juga akan di-set ke 0 supaya kolom display "Rp 0" instead of "—")`);
    }

    if (!confirmed) {
      console.log("\n⚠️  DRY-RUN. Tambahkan --confirm untuk execute.\n");
      return;
    }

    // 2. Backfill — set qris_settlement untuk semua closed shifts yang NULL
    // (termasuk yang 0, supaya UI display "Rp 0" instead of "—")
    const upd = await c.query(`
      UPDATE shifts s
      SET qris_settlement = (
        SELECT COALESCE(SUM(CASE WHEN t.payment_method='qris' AND t.status='paid' THEN t.total ELSE 0 END), 0)
        FROM transactions t WHERE t.shift_id = s.id
      ),
      updated_at = NOW()
      WHERE s.status='closed' AND s.qris_settlement IS NULL
    `);
    console.log(`\n✅ Backfilled ${upd.rowCount} rows`);

    // 3. Verify
    const after = await c.query(`
      SELECT COUNT(*)::int AS n FROM shifts WHERE status='closed' AND qris_settlement IS NULL
    `);
    console.log(`After: ${after.rows[0].n} shifts still NULL (should be 0)`);

    // 4. Audit log
    const ownerRes = await c.query(
      `SELECT id, outlet_id FROM users WHERE role='owner' AND status='active' LIMIT 1`,
    );
    const owner = ownerRes.rows[0];
    if (owner) {
      await c.query(
        `INSERT INTO audit_logs (event_type, user_id, entity_type, entity_id, payload, metadata, created_at)
         VALUES ($1, $2, NULL, NULL, $3, $4, NOW())`,
        [
          "system.backfill_qris_settlement",
          owner.id,
          JSON.stringify({
            summary: `Backfill qris_settlement legacy shifts (sesi AE-62f) — ${upd.rowCount} rows updated`,
            context: { totalQrisRupiah: totalQris },
          }),
          JSON.stringify({
            outletId: owner.outlet_id,
            actorRole: "owner",
            triggeredBy: "scripts/backfill-qris-settlement.ts",
          }),
        ],
      );
      console.log("✓ Audit log inserted");
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
