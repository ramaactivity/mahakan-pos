/**
 * Sesi AE-63 phase10 — force-close Galih's stale shift (open since 12 Mei,
 * 0 transactions) sebelum apply migration 0059 (ux_shifts_outlet_active
 * unique constraint).
 *
 * Tanpa cleanup ini, migration akan FAIL karena ada 2 open shifts paralel
 * (Parhan today + Galih stale) di outlet sama.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const galihShiftId = "6d90d446-3e20-4858-bdec-50cf35715479";
    /* Verify state */
    const [shift] = (
      await c.query(`SELECT * FROM shifts WHERE id = $1`, [galihShiftId])
    ).rows;
    if (!shift) {
      console.log("Shift not found.");
      return;
    }
    if (shift.status !== "open") {
      console.log(`Shift status=${shift.status}, no action needed.`);
      return;
    }
    /* Confirm 0 transactions */
    const [{ n }] = (
      await c.query(
        `SELECT COUNT(*)::int AS n FROM transactions WHERE shift_id = $1`,
        [galihShiftId],
      )
    ).rows;
    if (n !== 0) {
      console.log(`⚠ Shift has ${n} transactions. ABORT — manual review needed.`);
      return;
    }
    console.log(
      `Galih's stale shift: opened ${shift.opened_at?.toISOString().slice(0, 10)}, opening_cash=Rp ${shift.opening_cash}, transactions=0`,
    );
    console.log(`Action: set status='closed', actualCash=openingCash (no variance), closedAt=NOW, notes appended`);

    if (!apply) {
      console.log("\nDRY-RUN. Re-run with --apply.");
      return;
    }

    await c.query("BEGIN");
    try {
      await c.query(
        `UPDATE shifts SET
           status = 'closed',
           actual_cash = opening_cash,
           variance = 0,
           closed_at = NOW(),
           notes = COALESCE(notes || E'\\n', '') || 'Auto-closed by cleanup (sesi AE-63 phase10) — stale shift, 0 transactions',
           updated_at = NOW()
         WHERE id = $1`,
        [galihShiftId],
      );
      console.log("✓ Closed stale shift");
      await c.query("COMMIT");
      console.log("✅ Commit done");
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
