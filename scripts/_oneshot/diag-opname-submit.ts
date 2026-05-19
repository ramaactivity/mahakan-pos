/**
 * Sesi AE-63 phase7 — diagnose "Back office bermasalah" pas submit opname.
 * Read-only. Run: npx tsx scripts/_oneshot/diag-opname-submit.ts
 *
 * Hunts for:
 *  1. Pending-review sessions with weird aggregate values (NaN, negative,
 *     non-integer in bigint columns)
 *  2. Lines with decimal qty that have actual_qty non-null but might cause
 *     accumulation issues
 *  3. Recent audit logs untuk inventory.opname.* events
 *  4. Check constraint potential violations
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* 1. All sessions saat ini */
    console.log("\n=== ALL OPNAME SESSIONS ===");
    const sessions = await c.query(
      `SELECT id, period_label, status, started_at, submitted_at, finalized_at,
              total_lines, counted_lines, total_diff_qty, total_diff_cost
       FROM stock_opname_sessions
       ORDER BY started_at DESC LIMIT 10`,
    );
    for (const r of sessions.rows) {
      console.log(
        `  [${r.status}] ${r.period_label} | lines=${r.counted_lines}/${r.total_lines}` +
          ` | diff_qty=${r.total_diff_qty} diff_cost=${r.total_diff_cost}`,
      );
    }

    /* 2. Active sessions detail */
    console.log("\n=== ACTIVE/PENDING SESSIONS DEEP DIVE ===");
    const active = await c.query(
      `SELECT * FROM stock_opname_sessions WHERE status IN ('in_progress','pending_review')`,
    );
    for (const s of active.rows) {
      console.log(`\nSession ${s.id} (${s.status})`);
      console.log(`  Period: ${s.period_label}`);
      console.log(`  Counted: ${s.counted_lines}/${s.total_lines}`);
      console.log(
        `  total_diff_qty (bigint): ${s.total_diff_qty} — is integer? ${Number.isInteger(Number(s.total_diff_qty))}`,
      );
      console.log(
        `  total_diff_cost (bigint): ${s.total_diff_cost} — is integer? ${Number.isInteger(Number(s.total_diff_cost))}`,
      );

      /* Lines untuk session ini */
      const lines = await c.query(
        `SELECT id, ingredient_name_snapshot, expected_qty, expected_qty_decimal,
                actual_qty, actual_qty_decimal, unit_cost_at_snapshot
         FROM stock_opname_lines WHERE session_id = $1`,
        [s.id],
      );
      let counted = 0;
      let withDecimal = 0;
      let withDiff = 0;
      let possibleProblematic = 0;
      for (const l of lines.rows) {
        if (l.actual_qty !== null) counted++;
        if (l.actual_qty_decimal !== null) withDecimal++;
        if (l.actual_qty_decimal !== null && l.expected_qty_decimal !== null) {
          const exp = parseFloat(l.expected_qty_decimal);
          const act = parseFloat(l.actual_qty_decimal);
          if (act - exp !== 0) withDiff++;
          /* Cek apakah unit_cost akan bikin float overflow */
          const diff = Math.abs(act - exp);
          const cost = Number(l.unit_cost_at_snapshot);
          if (!Number.isFinite(diff * cost)) {
            possibleProblematic++;
            console.log(
              `    ⚠ ${l.ingredient_name_snapshot}: diff×cost not finite (${diff} × ${cost})`,
            );
          }
        }
      }
      console.log(
        `  Lines: total=${lines.rows.length} counted=${counted} withDecimal=${withDecimal} withDiff=${withDiff}`,
      );
      if (possibleProblematic > 0) {
        console.log(`  ⚠ Problematic lines: ${possibleProblematic}`);
      }

      /* Sample lines with biggest diff cost */
      const big = await c.query(
        `SELECT ingredient_name_snapshot, expected_qty, expected_qty_decimal,
                actual_qty, actual_qty_decimal, unit_cost_at_snapshot,
                (COALESCE(actual_qty_decimal, actual_qty::numeric) - COALESCE(expected_qty_decimal, expected_qty::numeric)) AS diff_decimal
         FROM stock_opname_lines WHERE session_id = $1 AND actual_qty IS NOT NULL
         ORDER BY ABS(COALESCE(actual_qty_decimal, actual_qty::numeric) - COALESCE(expected_qty_decimal, expected_qty::numeric)) * unit_cost_at_snapshot DESC
         LIMIT 5`,
        [s.id],
      );
      console.log("  Top 5 by diff×cost:");
      for (const r of big.rows) {
        const expDec = parseFloat(r.expected_qty_decimal ?? r.expected_qty);
        const actDec = parseFloat(r.actual_qty_decimal ?? r.actual_qty);
        const diff = actDec - expDec;
        const cost = Number(r.unit_cost_at_snapshot);
        console.log(
          `    ${r.ingredient_name_snapshot}: exp=${expDec} act=${actDec} diff=${diff} cost=${cost} → impact=${(Math.abs(diff) * cost).toFixed(2)}`,
        );
      }
    }

    /* 3. Recent audit logs */
    console.log("\n=== RECENT OPNAME AUDIT ===");
    const audit = await c.query(
      `SELECT event_type, created_at, entity_id, payload->>'summary' AS summary
       FROM audit_logs
       WHERE event_type LIKE 'inventory.opname.%'
       ORDER BY created_at DESC LIMIT 15`,
    );
    for (const r of audit.rows) {
      console.log(
        `  [${r.created_at.toISOString().slice(0, 19)}] ${r.event_type}: ${r.summary || "-"}`,
      );
    }

    /* 4. Recent client-error logs */
    console.log("\n=== RECENT CLIENT ERRORS ===");
    try {
      const clientErrs = await c.query(
        `SELECT event_type, created_at, payload->>'message' AS message,
                payload->>'path' AS path
         FROM audit_logs
         WHERE event_type = 'client.error'
         ORDER BY created_at DESC LIMIT 10`,
      );
      for (const r of clientErrs.rows) {
        console.log(
          `  [${r.created_at.toISOString().slice(0, 19)}] ${r.path}: ${r.message?.slice(0, 120)}`,
        );
      }
    } catch (e) {
      console.log("  (no client.error events)");
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
