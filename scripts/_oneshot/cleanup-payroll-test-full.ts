/**
 * Sesi AE-63 phase8 — Comprehensive cleanup untuk Bayu test payroll yang
 * BELUM lengkap di cleanup-bayu-test.ts (yang sebelumnya cuma delete
 * DRAFT period yang 0-lines).
 *
 * Owner Rama complaint: setelah cleanup pertama, masih ada:
 *  - Payroll period PAID Mei 2026 (4 lines, Rp 9.160.000 net)
 *  - Expense Rp 9.160.000 di Petty Cash POS (linked ke period)
 *  - Journal entry JE-202605-0047 Rp 10.160.000 di Beban Operasional
 *
 * Filter bug sebelumnya: cuma cari `created_by = bayuId`, tapi PAID
 * period dibuat oleh user "Mahakan" (system), Bayu cuma `paid_by`.
 *
 * Cleanup ini DRY-RUN default + --apply. Operasi:
 *  1. Reverse journal entry JE-202605-0047 (create counter-entry +
 *     mark original sebagai 'reversed') → ledger balanced kembali
 *  2. Soft-delete expense row (deleted_at + deleted_by) → hilang dari
 *     Petty Cash POS + Kas listings + Arus Kas
 *  3. Force-delete payroll_period row (status=paid bypass) → cascade
 *     auto-delete payroll_lines + payroll_payslip_emails
 *
 * Single transaction. Auto-ROLLBACK on error.
 *
 * Run dry: npx tsx scripts/_oneshot/cleanup-payroll-test-full.ts
 * Run apply: npx tsx scripts/_oneshot/cleanup-payroll-test-full.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool, type PoolClient } from "@neondatabase/serverless";

const BAYU_EMAIL = "bayukurnia95@gmail.com";

interface CleanupTarget {
  payrollPeriodId: string;
  payrollPeriodLabel: string;
  payrollPeriodStatus: string;
  expenseId: string | null;
  expenseAmount: number;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  journalLines: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    description: string | null;
  }>;
}

async function buildTarget(c: PoolClient): Promise<{
  bayuId: string;
  outletId: string;
  target: CleanupTarget | null;
}> {
  /* Resolve Bayu user */
  const [u] = (
    await c.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
      [BAYU_EMAIL],
    )
  ).rows;
  if (!u) throw new Error(`Bayu not found: ${BAYU_EMAIL}`);
  const bayuId = u.id as string;

  /* Outlet */
  const [out] = (
    await c.query(`SELECT id FROM outlets WHERE deleted_at IS NULL LIMIT 1`)
  ).rows;
  if (!out) throw new Error("No outlet");
  const outletId = out.id as string;

  /* Find PAID payroll period yang Bayu paid (regardless of created_by) */
  const [period] = (
    await c.query(
      `SELECT id, label, status, period_start, period_end, paid_at
       FROM payroll_periods
       WHERE paid_by = $1 AND status = 'paid'
       ORDER BY paid_at DESC LIMIT 1`,
      [bayuId],
    )
  ).rows;
  if (!period) {
    console.log("✓ Tidak ada PAID payroll period yang di-pay oleh Bayu. Cleanup kosong.");
    return { bayuId, outletId, target: null };
  }
  console.log(
    `🎯 Target payroll: ${period.id} | ${period.label} | status=${period.status} | paid_at=${period.paid_at?.toISOString().slice(0, 10)}`,
  );

  /* Find linked expense (sourceType=payroll OR description match) */
  const [exp] = (
    await c.query(
      `SELECT id, description, amount, payment_method, expense_date
       FROM expenses
       WHERE payroll_period_id = $1 AND deleted_at IS NULL`,
      [period.id],
    )
  ).rows;
  if (exp) {
    console.log(
      `🎯 Linked expense: ${exp.id} | ${exp.description} | Rp ${Number(exp.amount).toLocaleString("id-ID")} | ${exp.payment_method}`,
    );
  }

  /* Find journal entry (sourceType=payroll_paid, sourceId=period.id) */
  const [je] = (
    await c.query(
      `SELECT id, entry_number, period_id, status
       FROM journal_entries
       WHERE source_type = 'payroll_paid' AND source_id = $1
         AND status = 'posted'
       LIMIT 1`,
      [period.id],
    )
  ).rows;
  let journalLines: CleanupTarget["journalLines"] = [];
  if (je) {
    console.log(
      `🎯 Linked journal: ${je.entry_number} (${je.id}) | status=${je.status}`,
    );
    const lines = await c.query(
      `SELECT jl.account_id, jl.debit, jl.credit, jl.description, jl.line_number,
              coa.code, coa.name
       FROM journal_lines jl
       JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.entry_id = $1 ORDER BY jl.line_number`,
      [je.id],
    );
    journalLines = lines.rows.map((l) => ({
      accountId: l.account_id,
      accountCode: l.code,
      accountName: l.name,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description,
    }));
    console.log(`  Lines (${journalLines.length}):`);
    for (const l of journalLines) {
      console.log(
        `    ${l.accountCode} ${l.accountName?.padEnd(30)} Dr ${l.debit ? l.debit.toLocaleString("id-ID").padStart(12) : "-".padStart(12)} | Cr ${l.credit ? l.credit.toLocaleString("id-ID").padStart(12) : "-".padStart(12)}`,
      );
    }
  }

  return {
    bayuId,
    outletId,
    target: {
      payrollPeriodId: period.id,
      payrollPeriodLabel: period.label,
      payrollPeriodStatus: period.status,
      expenseId: exp?.id ?? null,
      expenseAmount: Number(exp?.amount ?? 0),
      journalEntryId: je?.id ?? null,
      journalEntryNumber: je?.entry_number ?? null,
      journalLines,
    },
  };
}

async function applyCleanup(
  c: PoolClient,
  target: CleanupTarget,
  bayuId: string,
  outletId: string,
) {
  /* 1. REVERSE journal entry — create counter-entry + mark original.
   *    Generate entry_number untuk counter via sequence: ambil count + 1
   *    di period_id yang sama, format JE-YYYYMM-NNNN. */
  if (target.journalEntryId && target.journalLines.length > 0) {
    console.log(`\n[1] Reversing journal ${target.journalEntryNumber}…`);

    /* Get original entry's period + date */
    const [orig] = (
      await c.query(
        `SELECT period_id, entry_date FROM journal_entries WHERE id = $1`,
        [target.journalEntryId],
      )
    ).rows;
    if (!orig) throw new Error("Original journal entry not found");

    /* Generate next entry_number untuk reverse */
    const periodId = orig.period_id as string;
    const yyyymm = String(orig.entry_date).replace(/-/g, "").slice(0, 6);
    /* Advisory lock untuk serial number gen */
    await c.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`je-seq-cleanup-${outletId}-${yyyymm}`],
    );
    const [{ count }] = (
      await c.query(
        `SELECT COUNT(*)::int AS count FROM journal_entries WHERE period_id = $1`,
        [periodId],
      )
    ).rows;
    const reverseEntryNumber = `JE-${yyyymm}-${String(count + 1).padStart(4, "0")}`;

    /* Insert reverse entry header */
    const [reverseEntry] = (
      await c.query(
        `INSERT INTO journal_entries
          (outlet_id, period_id, entry_number, entry_date, description,
           source_type, source_id, status, posted_at, posted_by,
           reverses_entry_id, reverse_reason, created_by)
         VALUES ($1, $2, $3, $4, $5, 'manual', NULL, 'posted', NOW(), $6, $7, $8, $6)
         RETURNING id`,
        [
          outletId,
          periodId,
          reverseEntryNumber,
          orig.entry_date,
          `Reverse ${target.journalEntryNumber} — cleanup test payroll Bayu`,
          bayuId,
          target.journalEntryId,
          "Cleanup test data Bayu 2026-05-19 (sesi AE-63 phase8)",
        ],
      )
    ).rows;
    console.log(`   ✓ Created reverse entry ${reverseEntryNumber} (${reverseEntry.id})`);

    /* Insert reverse lines (swap Dr ↔ Cr) */
    for (let i = 0; i < target.journalLines.length; i++) {
      const l = target.journalLines[i]!;
      await c.query(
        `INSERT INTO journal_lines
          (entry_id, line_number, account_id, debit, credit, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          reverseEntry.id,
          i + 1,
          l.accountId,
          l.credit, // swap
          l.debit, // swap
          `Reverse: ${l.description ?? ""}`,
        ],
      );
    }
    console.log(`   ✓ Inserted ${target.journalLines.length} reverse lines`);

    /* Mark original entry as reversed */
    await c.query(
      `UPDATE journal_entries
       SET status = 'reversed',
           reversed_by_entry_id = $1,
           reverse_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [
        reverseEntry.id,
        "Cleanup test data Bayu (sesi AE-63 phase8)",
        target.journalEntryId,
      ],
    );
    console.log(`   ✓ Marked ${target.journalEntryNumber} status='reversed'`);
  } else {
    console.log("\n[1] No journal entry to reverse — skip");
  }

  /* 2. SOFT-DELETE expense */
  if (target.expenseId) {
    console.log(
      `\n[2] Soft-delete expense ${target.expenseId} (Rp ${target.expenseAmount.toLocaleString("id-ID")})…`,
    );
    const res = await c.query(
      `UPDATE expenses SET deleted_at = NOW(), deleted_by = $1,
              updated_at = NOW(), updated_by = $1
       WHERE id = $2 AND deleted_at IS NULL`,
      [bayuId, target.expenseId],
    );
    console.log(`   ✓ Soft-deleted ${res.rowCount} expense row`);
  } else {
    console.log("\n[2] No expense to delete — skip");
  }

  /* 3. FORCE-DELETE payroll_period (bypass paid status block; cascade
   *    delete payroll_lines + payroll_payslip_emails via FK).
   *    NOTE: expense.payroll_period_id FK has NO action defined → after
   *    soft-delete above, the FK still points to period. We need to NULL
   *    expense.payroll_period_id first OR rely on FK behavior. Let me
   *    set it to NULL defensively. */
  if (target.expenseId) {
    await c.query(
      `UPDATE expenses SET payroll_period_id = NULL WHERE id = $1`,
      [target.expenseId],
    );
  }

  console.log(
    `\n[3] Force-delete payroll period ${target.payrollPeriodId} (status=${target.payrollPeriodStatus})…`,
  );
  const periodRes = await c.query(
    `DELETE FROM payroll_periods WHERE id = $1`,
    [target.payrollPeriodId],
  );
  console.log(
    `   ✓ Deleted ${periodRes.rowCount} payroll_period row (cascade: payroll_lines + payroll_payslip_emails)`,
  );

  /* 4. Audit log entry */
  await c.query(
    `INSERT INTO audit_logs (event_type, user_id, entity_type, entity_id, payload, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      "payroll.period.delete",
      bayuId,
      "payroll_period",
      target.payrollPeriodId,
      JSON.stringify({
        summary: `Cleanup test data: hapus ${target.payrollPeriodLabel} + reverse JE ${target.journalEntryNumber ?? "-"} + soft-delete expense ${target.expenseId ?? "-"}`,
        before: {
          status: target.payrollPeriodStatus,
          expenseId: target.expenseId,
          expenseAmount: target.expenseAmount,
          journalEntryId: target.journalEntryId,
          journalEntryNumber: target.journalEntryNumber,
        },
      }),
      JSON.stringify({ outletId, actorRole: "owner", sessionTag: "AE-63 phase8 cleanup" }),
    ],
  );
  console.log(`\n   ✓ Audit log entry inserted`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log("=".repeat(70));
    console.log(
      `MODE: ${apply ? "APPLY 🚨 (changes will be persisted)" : "DRY-RUN (read-only)"}`,
    );
    console.log("=".repeat(70));
    console.log();

    const { bayuId, outletId, target } = await buildTarget(c);
    if (!target) {
      console.log("\nNothing to clean up.");
      return;
    }

    console.log("\n" + "=".repeat(70));
    console.log("PLAN:");
    console.log("=".repeat(70));
    console.log(`  [1] Reverse journal entry ${target.journalEntryNumber ?? "(none)"}`);
    console.log(
      `      → Create counter-entry with Dr↔Cr swapped, mark original as 'reversed'`,
    );
    console.log(`  [2] Soft-delete expense ${target.expenseId ?? "(none)"} (Rp ${target.expenseAmount.toLocaleString("id-ID")})`);
    console.log(`      → Removes from Petty Cash POS + Kas + Arus Kas`);
    console.log(
      `  [3] Force-delete payroll_period ${target.payrollPeriodLabel} (cascade lines + emails)`,
    );

    if (!apply) {
      console.log("\n" + "=".repeat(70));
      console.log("DRY-RUN done. Re-run with --apply to execute.");
      console.log("=".repeat(70));
      return;
    }

    console.log("\n" + "=".repeat(70));
    console.log("APPLYING…");
    console.log("=".repeat(70));
    await c.query("BEGIN");
    try {
      await applyCleanup(c, target, bayuId, outletId);
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
main().catch((e) => { console.error(e); process.exit(1); });
