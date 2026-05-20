/**
 * Sesi AE-63 phase8 — show DETAIL of Bayu's employee edits + career_history
 * deletes yang akan di-revert oleh cleanup script. Owner Rama review dulu
 * sebelum --apply.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

const BAYU_ID = "2fbdb180-a127-4554-889c-bb9afa11baeb";
const WINDOW_START = "2026-05-19 00:00:00+07";
const WINDOW_END = "2026-05-20 23:59:59+07";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* 1. Employee edits — show before/after per employee */
    console.log("=== EMPLOYEE EDITS DETAIL ===\n");
    const empIds = (
      await c.query(
        `SELECT DISTINCT entity_id FROM audit_logs
         WHERE event_type = 'employee.update' AND user_id = $1
           AND created_at BETWEEN $2 AND $3`,
        [BAYU_ID, WINDOW_START, WINDOW_END],
      )
    ).rows.map((r) => r.entity_id);

    for (const empId of empIds) {
      const emp = (
        await c.query(
          `SELECT full_name, position, employment_type, salary_amount, daily_rate, payment_type, email, phone
           FROM employees WHERE id = $1`,
          [empId],
        )
      ).rows[0];
      console.log(
        `\n👤 ${emp?.full_name ?? "?"} (${empId})`,
      );
      console.log(`   Current: position=${emp?.position}, type=${emp?.employment_type}, payment=${emp?.payment_type}, salary=${emp?.salary_amount ?? "-"}, daily=${emp?.daily_rate ?? "-"}, email=${emp?.email}`);

      /* All edits by Bayu, ordered chronologically */
      const edits = (
        await c.query(
          `SELECT created_at, payload->>'summary' AS summary,
                  payload->'before' AS before_state,
                  payload->'after' AS after_state
           FROM audit_logs
           WHERE entity_id = $1 AND event_type = 'employee.update'
             AND user_id = $2
           ORDER BY created_at ASC`,
          [empId, BAYU_ID],
        )
      ).rows;
      console.log(`   Edits by Bayu: ${edits.length}`);
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i];
        console.log(
          `     [${i + 1}] ${e.created_at.toISOString().slice(0, 16)}`,
        );
        if (e.before_state) {
          const before = e.before_state as Record<string, unknown>;
          const after = e.after_state as Record<string, unknown>;
          const changes: string[] = [];
          for (const k of Object.keys({ ...before, ...after })) {
            const b = JSON.stringify(before[k]);
            const a = JSON.stringify(after?.[k]);
            if (b !== a) changes.push(`${k}: ${b} → ${a}`);
          }
          if (changes.length === 0) {
            console.log(`         (no field changes in payload)`);
          } else {
            for (const ch of changes) console.log(`         ${ch}`);
          }
        }
      }
      /* Revert target: first edit's "before" */
      const firstBefore = edits[0]?.before_state;
      if (firstBefore) {
        console.log(`   → Akan di-revert ke (state SEBELUM Bayu touching):`);
        console.log(`     ${JSON.stringify(firstBefore, null, 6).slice(0, 300)}`);
      }
    }

    /* 2. Career history details */
    console.log("\n\n=== CAREER HISTORY DELETES DETAIL ===\n");
    const careerLogs = (
      await c.query(
        `SELECT entity_id, created_at, payload->>'summary' AS summary,
                payload->'before' AS before_state
         FROM audit_logs
         WHERE event_type = 'career_history.delete' AND user_id = $1
           AND created_at BETWEEN $2 AND $3
         ORDER BY created_at`,
        [BAYU_ID, WINDOW_START, WINDOW_END],
      )
    ).rows;
    for (const c2 of careerLogs) {
      /* Look up current state */
      const row = (
        await c.query(
          `SELECT ech.id, ech.position, ech.effective_date, ech.deleted_at,
                  e.full_name
           FROM employee_career_history ech
           LEFT JOIN employees e ON e.id = ech.employee_id
           WHERE ech.id = $1`,
          [c2.entity_id],
        )
      ).rows[0];
      console.log(
        `  ${row?.full_name ?? "?"} | ${row?.position ?? "?"} | effective=${String(row?.effective_date).slice(0,10)} | deleted=${row?.deleted_at ? "YES" : "NO"}`,
      );
      console.log(`     audit summary: ${c2.summary}`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
