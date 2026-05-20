/**
 * Sesi AE-63 phase8 — Identify all testing data created/modified by HR
 * Bayu during end-to-end payroll simulation. READ-ONLY diagnostic.
 *
 * Owner Rama report: HR test pollute prod data, manager/staff bingung.
 * Need to identify scope before cleanup.
 *
 * Run: npx tsx scripts/_oneshot/diag-bayu-test-data.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* 1. Identify Bayu user. Per audit log "Bayu owner". */
    const users = await c.query(
      `SELECT id, name, email, role, created_at
       FROM users WHERE LOWER(name) LIKE '%bayu%' OR LOWER(email) LIKE '%bayu%'
       ORDER BY created_at`,
    );
    console.log("\n=== USER 'BAYU' CANDIDATES ===");
    for (const u of users.rows) {
      console.log(
        `  ${u.id} | ${u.name} (${u.email}) | role=${u.role} | created=${u.created_at?.toISOString().slice(0, 10)}`,
      );
    }
    if (users.rows.length === 0) {
      console.log("  ⚠ No user named Bayu found");
      return;
    }
    const bayuIds = users.rows.map((r) => r.id as string);

    /* 2. Audit log oleh Bayu (any time). Group by event type for overview. */
    console.log("\n=== BAYU AUDIT LOG SUMMARY (BY EVENT TYPE) ===");
    const auditSummary = await c.query(
      `SELECT event_type, COUNT(*)::int AS n,
              MIN(created_at) AS first_at, MAX(created_at) AS last_at
       FROM audit_logs WHERE user_id = ANY($1::uuid[])
       GROUP BY event_type ORDER BY MAX(created_at) DESC`,
      [bayuIds],
    );
    for (const r of auditSummary.rows) {
      console.log(
        `  ${r.event_type.padEnd(40)} n=${String(r.n).padStart(3)} | ${r.first_at.toISOString().slice(0, 16)} → ${r.last_at.toISOString().slice(0, 16)}`,
      );
    }

    /* 3. Detailed audit log untuk last 7 days (testing window). */
    console.log("\n=== BAYU AUDIT LOG DETAIL (LAST 7 DAYS) ===");
    const auditDetail = await c.query(
      `SELECT event_type, entity_type, entity_id, created_at,
              payload->>'summary' AS summary
       FROM audit_logs
       WHERE user_id = ANY($1::uuid[])
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 50`,
      [bayuIds],
    );
    for (const r of auditDetail.rows) {
      console.log(
        `  [${r.created_at.toISOString().slice(0, 16)}] ${r.event_type.padEnd(35)} ${r.summary?.slice(0, 80) || "-"}`,
      );
    }

    /* 4. Payroll periods created/modified by Bayu */
    console.log("\n=== PAYROLL PERIODS BY BAYU ===");
    const payrolls = await c.query(
      `SELECT id, period_label, status, period_from, period_to,
              total_net, paid_at, created_by, created_at
       FROM payroll_periods
       WHERE created_by = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [bayuIds],
    );
    for (const p of payrolls.rows) {
      console.log(
        `  ${p.id} | ${p.period_label} (${p.period_from} → ${p.period_to}) | status=${p.status} | net=${p.total_net ?? 0} | paid_at=${p.paid_at?.toISOString().slice(0, 10) || "-"}`,
      );
    }

    /* 5. Cash transactions / manual expenses from payroll */
    console.log("\n=== EXPENSE TRANSACTIONS FROM PAYROLL ===");
    const expenses = await c.query(
      `SELECT id, kind, description, amount, payment_method,
              occurred_at, created_at, created_by
       FROM expenses
       WHERE (description ILIKE '%payroll%' OR description ILIKE '%gaji%')
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 20`,
    );
    for (const e of expenses.rows) {
      console.log(
        `  ${e.id} | ${e.description} | Rp ${e.amount} | ${e.payment_method} | ${e.occurred_at?.toISOString().slice(0, 10)}`,
      );
    }

    /* 6. Attendance records modified during testing */
    console.log("\n=== ATTENDANCE RECORDS (LAST 7 DAYS) ===");
    const attendance = await c.query(
      `SELECT a.id, a.shift_date, e.full_name AS employee_name,
              a.clock_in_at, a.clock_out_at, a.is_late, a.late_minutes,
              a.overtime_minutes, a.created_at
       FROM attendance_records a
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.created_at > NOW() - INTERVAL '7 days'
       ORDER BY a.shift_date DESC, a.created_at DESC
       LIMIT 30`,
    );
    for (const r of attendance.rows) {
      console.log(
        `  ${r.shift_date} | ${r.employee_name?.padEnd(35) || "(no name)"} | late=${r.late_minutes ?? 0}m OT=${r.overtime_minutes ?? 0}m | in=${r.clock_in_at?.toISOString().slice(11, 16) || "-"} out=${r.clock_out_at?.toISOString().slice(11, 16) || "-"}`,
      );
    }

    /* 7. Schedules created in last 7 days */
    console.log("\n=== SCHEDULES CREATED LAST 7 DAYS ===");
    const schedules = await c.query(
      `SELECT s.id, s.shift_date, e.full_name AS employee_name,
              s.start_time, s.end_time, s.day_off, s.created_at, s.created_by
       FROM employee_schedules s
       LEFT JOIN employees e ON e.id = s.employee_id
       WHERE s.created_at > NOW() - INTERVAL '7 days'
       ORDER BY s.shift_date DESC LIMIT 30`,
    );
    console.log(`  (${schedules.rows.length} schedule rows last 7 days)`);
    for (const r of schedules.rows.slice(0, 10)) {
      console.log(
        `  ${r.shift_date} | ${r.employee_name?.padEnd(30) || "?"} | ${r.start_time}-${r.end_time} | dayOff=${r.day_off}`,
      );
    }

    /* 8. POS transactions in test window */
    console.log("\n=== POS TRANSACTIONS LAST 7 DAYS ===");
    const trx = await c.query(
      `SELECT COUNT(*)::int AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at,
              SUM(total)::bigint AS total_amount,
              COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count
       FROM transactions WHERE created_at > NOW() - INTERVAL '7 days'`,
    );
    console.log(
      `  POS transactions: ${trx.rows[0].n} total (${trx.rows[0].paid_count} paid, Rp ${trx.rows[0].total_amount ?? 0})`,
    );

    /* 9. Employees modified */
    console.log("\n=== EMPLOYEES TOUCHED LAST 7 DAYS ===");
    const emps = await c.query(
      `SELECT id, full_name, role, employment_type, base_salary,
              updated_at, updated_by
       FROM employees
       WHERE updated_at > NOW() - INTERVAL '7 days'
       ORDER BY updated_at DESC`,
    );
    for (const e of emps.rows) {
      console.log(
        `  ${e.full_name?.padEnd(35)} (${e.role}, ${e.employment_type}) | base=${e.base_salary} | updated=${e.updated_at?.toISOString().slice(0, 16)}`,
      );
    }

    /* 10. Cash deposits, shifts, etc */
    console.log("\n=== SHIFTS LAST 7 DAYS ===");
    const shifts = await c.query(
      `SELECT id, opened_at, closed_at, opening_cash, actual_cash, opened_by_user_id
       FROM shifts WHERE opened_at > NOW() - INTERVAL '7 days'
       ORDER BY opened_at DESC LIMIT 10`,
    );
    for (const s of shifts.rows) {
      console.log(
        `  ${s.opened_at?.toISOString().slice(0, 16)} | open=Rp${s.opening_cash} actual=Rp${s.actual_cash ?? "-"} | closed=${s.closed_at ? "yes" : "OPEN"}`,
      );
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
