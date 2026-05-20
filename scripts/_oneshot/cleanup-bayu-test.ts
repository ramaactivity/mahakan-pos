/**
 * Sesi AE-63 phase8 — Cleanup test data created by HR Bayu selama
 * end-to-end simulation testing. Run dry-run dulu, baru --apply.
 *
 * Target untuk dihapus / di-revert:
 *  1. Payroll period "Mei 2026" (status=paid) → revert to draft → delete
 *  2. Expense "Gaji Karyawan Mei 2026" (Rp 9.160.000) → soft-delete
 *  3. Schedule upserts by Bayu (test schedules)
 *  4. Attendance records yang ke-created saat test
 *  5. Employee edits → revert ke "before" state dari audit log
 *  6. Career history deletes → restore (set deletedAt = NULL)
 *  7. Settings updates → revert
 *
 * Yang TIDAK bisa di-revert:
 *  - Audit log itself (keep as record of testing)
 *  - Email yang sudah ke-send (slip gaji) — best effort: tidak ada
 *    cara unsend. Owner perlu broadcast "email test, abaikan" manual.
 *
 * Strategy: untuk safety, semua action di transaction. Dry-run prints
 * exact SQL. --apply executes. Pre-fix screenshot owner shows:
 *  - Payroll Mei 2026 Paid, 4 employees, Rp 9.160.000
 *  - Charlotte attendance 12:41-22:36 dengan 2h 41m telat
 *  - 14 employee.update + 5 career_history.delete events
 *
 * Run dry: npx tsx scripts/_oneshot/cleanup-bayu-test.ts
 * Run apply: npx tsx scripts/_oneshot/cleanup-bayu-test.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool, type PoolClient } from "@neondatabase/serverless";

const BAYU_EMAIL = "bayukurnia95@gmail.com";
const TEST_WINDOW_START = "2026-05-11 00:00:00+07"; // WIB
const TEST_WINDOW_END = "2026-05-19 23:59:59+07";

interface Plan {
  category: string;
  description: string;
  sql: string;
  params: unknown[];
}

const plans: Plan[] = [];

function add(p: Plan) {
  plans.push(p);
}

async function buildPlan(c: PoolClient): Promise<{
  bayuId: string;
  outletId: string;
  payrollPeriodId: string | null;
  payrollExpenseId: string | null;
}> {
  /* 1. Resolve Bayu user id. */
  const [u] = (
    await c.query(
      `SELECT id, name FROM users WHERE LOWER(email) = LOWER($1)`,
      [BAYU_EMAIL],
    )
  ).rows;
  if (!u) throw new Error(`Bayu user not found: ${BAYU_EMAIL}`);
  const bayuId = u.id as string;
  console.log(`Bayu user_id: ${bayuId} (${u.name})\n`);

  /* 2. Resolve outlet. */
  const [out] = (
    await c.query(`SELECT id, name FROM outlets WHERE deleted_at IS NULL LIMIT 1`)
  ).rows;
  if (!out) throw new Error("No outlet found");
  const outletId = out.id as string;

  /* 3. Find payroll period "Mei 2026" oleh Bayu */
  const periods = (
    await c.query(
      `SELECT id, label, status, period_start, period_end, paid_at
       FROM payroll_periods WHERE created_by = $1 ORDER BY created_at DESC`,
      [bayuId],
    )
  ).rows;
  const period = periods[0]; // Take latest test period
  const payrollPeriodId = period?.id ?? null;

  if (period) {
    console.log(
      `🎯 Payroll period: ${period.label} (${period.id}) | status=${period.status} | paid_at=${period.paid_at?.toISOString().slice(0, 10) ?? "-"}\n`,
    );

    /* 4. Find linked expense (payroll auto-create) */
    const [exp] = (
      await c.query(
        `SELECT id, description, amount, payment_method, expense_date
         FROM expenses
         WHERE payroll_period_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [period.id],
      )
    ).rows;
    const payrollExpenseId = exp?.id ?? null;

    if (exp) {
      console.log(
        `🎯 Linked expense: ${exp.id} | ${exp.description} | Rp ${exp.amount} | ${exp.expense_date}\n`,
      );

      /* Plan: soft-delete expense */
      add({
        category: "Expense (soft-delete)",
        description: `Soft-delete expense "${exp.description}" Rp ${Number(exp.amount).toLocaleString("id-ID")}`,
        sql: `UPDATE expenses SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW(), updated_by = $1
              WHERE id = $2 AND deleted_at IS NULL`,
        params: [bayuId, exp.id],
      });
    }

    /* Plan: reset payroll period to draft → delete */
    if (period.status === "paid" || period.status === "finalized") {
      add({
        category: "Payroll (revert paid → draft)",
        description: `Revert payroll "${period.label}" dari ${period.status} → draft (clear paid_at, finalized_at)`,
        sql: `UPDATE payroll_periods SET status = 'draft', paid_at = NULL, paid_by = NULL,
                finalized_at = NULL, finalized_by = NULL, updated_at = NOW()
              WHERE id = $1`,
        params: [period.id],
      });
    }
    add({
      category: "Payroll (delete)",
      description: `Hapus payroll period "${period.label}" + cascade delete payroll_lines (FK cascade)`,
      sql: `DELETE FROM payroll_periods WHERE id = $1`,
      params: [period.id],
    });

    /* Also delete payslip emails for this period */
    add({
      category: "Payslip emails (delete log)",
      description: `Hapus log payslip emails untuk period`,
      sql: `DELETE FROM payroll_payslip_emails WHERE payroll_period_id = $1`,
      params: [period.id],
    });
  }

  /* 5. Schedules by Bayu in test window — delete all */
  const schedRows = (
    await c.query(
      `SELECT COUNT(*)::int AS n FROM employee_schedules
       WHERE created_by = $1 AND created_at BETWEEN $2 AND $3`,
      [bayuId, TEST_WINDOW_START, TEST_WINDOW_END],
    )
  ).rows;
  const schedCount = schedRows[0].n;
  if (schedCount > 0) {
    add({
      category: "Schedules (delete)",
      description: `Hapus ${schedCount} schedule yang dibuat Bayu di test window`,
      sql: `DELETE FROM employee_schedules
            WHERE created_by = $1 AND created_at BETWEEN $2 AND $3`,
      params: [bayuId, TEST_WINDOW_START, TEST_WINDOW_END],
    });
  }

  /* 6. Attendance records — yang ke-create di test window
   *    (clock-in/out by Bayu atau related ke deleted schedules) */
  const attRows = (
    await c.query(
      `SELECT a.id, a.shift_date, e.full_name, a.clock_in_at, a.clock_out_at
       FROM attendance_records a
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.created_at BETWEEN $1 AND $2
       ORDER BY a.shift_date DESC`,
      [TEST_WINDOW_START, TEST_WINDOW_END],
    )
  ).rows;
  if (attRows.length > 0) {
    console.log(`📋 Attendance to delete (${attRows.length}):`);
    for (const r of attRows) {
      console.log(
        `   ${r.shift_date} | ${r.full_name ?? "?"} | in=${r.clock_in_at?.toISOString().slice(11, 16) ?? "-"} out=${r.clock_out_at?.toISOString().slice(11, 16) ?? "-"}`,
      );
    }
    console.log();
    add({
      category: "Attendance (delete)",
      description: `Hapus ${attRows.length} attendance record yang dibuat di test window`,
      sql: `DELETE FROM attendance_records
            WHERE created_at BETWEEN $1 AND $2`,
      params: [TEST_WINDOW_START, TEST_WINDOW_END],
    });
  }

  /* 7. Revert employee edits dari audit log "before" payload.
   *    Each employee may have multiple updates — kita ambil yang PALING AWAL
   *    sebelum test window untuk revert kembali ke real production state. */
  const empEdits = (
    await c.query(
      `SELECT entity_id, MIN(created_at) AS first_edit_at
       FROM audit_logs
       WHERE event_type = 'employee.update' AND user_id = $1
         AND created_at BETWEEN $2 AND $3
       GROUP BY entity_id`,
      [bayuId, TEST_WINDOW_START, TEST_WINDOW_END],
    )
  ).rows;
  console.log(
    `📝 Employee edits by Bayu di test window: ${empEdits.length} employees\n`,
  );
  for (const e of empEdits) {
    /* Get "before" payload of FIRST edit (= state sebelum Bayu sentuh) */
    const [firstEdit] = (
      await c.query(
        `SELECT payload->'before' AS before_state, payload->>'summary' AS summary
         FROM audit_logs
         WHERE entity_id = $1 AND event_type = 'employee.update' AND user_id = $2
         ORDER BY created_at ASC LIMIT 1`,
        [e.entity_id, bayuId],
      )
    ).rows;
    if (!firstEdit?.before_state) {
      console.log(
        `   ⚠ ${e.entity_id}: no 'before' state in audit log — manual review needed`,
      );
      continue;
    }
    const before = firstEdit.before_state as Record<string, unknown>;
    /* Build UPDATE statement dari before keys. Only known-safe fields. */
    const safeFields = [
      "fullName",
      "nickname",
      "role",
      "employmentType",
      "baseSalary",
      "email",
      "phone",
      "address",
      "joinDate",
      "status",
      "lateGraceMinutes",
      "notes",
      "ktpUrl",
      "kkUrl",
      "selfieUrl",
    ];
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;
    for (const key of safeFields) {
      if (key in before) {
        /* Convert camelCase → snake_case */
        const col = key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
        updates.push(`${col} = $${paramIdx}`);
        params.push(before[key] ?? null);
        paramIdx++;
      }
    }
    if (updates.length === 0) {
      console.log(`   ⚠ ${e.entity_id}: 'before' payload empty`);
      continue;
    }
    params.push(e.entity_id);
    add({
      category: "Employee (revert edits)",
      description: `Revert employee ${e.entity_id} ke state sebelum test (${updates.length} fields)`,
      sql: `UPDATE employees SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${paramIdx}`,
      params,
    });
  }

  /* 8. Career history yang Bayu hapus → un-delete (set deleted_at = NULL) */
  const careerDeletes = (
    await c.query(
      `SELECT entity_id, payload FROM audit_logs
       WHERE event_type = 'career_history.delete' AND user_id = $1
         AND created_at BETWEEN $2 AND $3`,
      [bayuId, TEST_WINDOW_START, TEST_WINDOW_END],
    )
  ).rows;
  if (careerDeletes.length > 0) {
    const ids = careerDeletes.map((r) => r.entity_id);
    console.log(
      `📚 Career history to restore: ${ids.length} entries\n`,
    );
    add({
      category: "Career history (restore)",
      description: `Restore ${ids.length} career_history rows yang Bayu hapus`,
      sql: `UPDATE employee_career_history SET deleted_at = NULL, updated_at = NOW()
            WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL`,
      params: [ids],
    });
  }

  /* 9. Settings updates — restore from audit log */
  const settingsUpdates = (
    await c.query(
      `SELECT payload->'before' AS before_state, payload->'after' AS after_state,
              created_at
       FROM audit_logs
       WHERE event_type = 'settings.update' AND user_id = $1
         AND created_at BETWEEN $2 AND $3
       ORDER BY created_at ASC LIMIT 1`,
      [bayuId, TEST_WINDOW_START, TEST_WINDOW_END],
    )
  ).rows;
  if (settingsUpdates.length > 0 && settingsUpdates[0].before_state) {
    console.log(
      `⚙ Settings: revert outlets.settings.payroll ke state sebelum Bayu test\n`,
    );
    /* Settings adalah nested JSON. Owner perlu manual review — auto-revert
     * complete settings.payroll bisa override changes yang owner sengaja
     * lakukan separately. SKIP auto, just print info. */
    console.log(
      `   ℹ Skipped auto-revert settings (manual review recommended). Before:`,
      JSON.stringify(settingsUpdates[0].before_state).slice(0, 200),
    );
  }

  return {
    bayuId,
    outletId,
    payrollPeriodId,
    payrollExpenseId: plans
      .find((p) => p.category === "Expense (soft-delete)")
      ?.params[1] as string | null,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log("=".repeat(70));
    console.log(
      `MODE: ${apply ? "APPLY 🚨 (changes will be persisted)" : "DRY-RUN (no changes)"}`,
    );
    console.log("=".repeat(70));
    console.log();

    await buildPlan(c);

    console.log("\n" + "=".repeat(70));
    console.log(`PLAN (${plans.length} ops):`);
    console.log("=".repeat(70));
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i]!;
      console.log(`\n[${i + 1}] ${p.category}`);
      console.log(`    ${p.description}`);
      if (process.argv.includes("--verbose")) {
        console.log(`    SQL: ${p.sql}`);
        console.log(`    Params: ${JSON.stringify(p.params)}`);
      }
    }

    if (!apply) {
      console.log("\n" + "=".repeat(70));
      console.log("DRY-RUN done. Re-run with --apply to execute.");
      console.log("Add --verbose flag to see exact SQL + params.");
      console.log("=".repeat(70));
      return;
    }

    /* APPLY mode — execute in transaction */
    console.log("\n" + "=".repeat(70));
    console.log("APPLYING…");
    console.log("=".repeat(70));
    await c.query("BEGIN");
    try {
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i]!;
        console.log(`\n[${i + 1}/${plans.length}] ${p.category}`);
        const res = await c.query(p.sql, p.params as unknown[]);
        console.log(
          `   ✓ ${p.description} — affected ${res.rowCount} rows`,
        );
      }
      await c.query("COMMIT");
      console.log("\n" + "=".repeat(70));
      console.log("✅ COMMIT done. Cleanup complete.");
      console.log("=".repeat(70));
    } catch (e) {
      await c.query("ROLLBACK");
      console.error("\n❌ ROLLBACK due to error:", e);
      throw e;
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
