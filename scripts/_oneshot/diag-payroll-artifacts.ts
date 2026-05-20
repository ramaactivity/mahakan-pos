/**
 * Sesi AE-63 phase8 — comprehensive audit semua artifacts dari Bayu's
 * payroll testing yang belum cleaned up:
 *  - phantom payroll_periods rows (0 lines, 0 net)
 *  - dangling expenses (description contains "Payroll" / "Gaji Karyawan")
 *  - journal_entries dengan sourceType='payroll_paid' atau description match
 *  - cek apa yang muncul di Petty Cash (cash queries)
 *  - cek period akuntansi Mei 2026 — laba/rugi summary
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* 1. ALL payroll_periods rows */
    console.log("=== ALL PAYROLL PERIODS ===\n");
    const periods = await c.query(`
      SELECT pp.id, pp.label, pp.status, pp.period_start, pp.period_end,
             pp.paid_at, pp.finalized_at, pp.created_at,
             cu.name AS created_by_name, pu.name AS paid_by_name,
             (SELECT COUNT(*) FROM payroll_lines WHERE period_id = pp.id) AS line_count,
             (SELECT COALESCE(SUM(net_pay), 0) FROM payroll_lines WHERE period_id = pp.id) AS total_net
      FROM payroll_periods pp
      LEFT JOIN users cu ON cu.id = pp.created_by
      LEFT JOIN users pu ON pu.id = pp.paid_by
      ORDER BY pp.created_at DESC
    `);
    for (const p of periods.rows) {
      console.log(
        `  ${p.status.toUpperCase().padEnd(10)} | ${p.id} | ${p.label} | ${String(p.period_start).slice(0,10)} → ${String(p.period_end).slice(0,10)} | lines=${p.line_count}, net=${p.total_net} | by ${p.created_by_name} | paid=${p.paid_at?.toISOString().slice(0,10) || "-"} (${p.paid_by_name ?? "-"})`,
      );
    }

    /* 2. Expense rows yang related ke payroll */
    console.log("\n=== EXPENSES RELATED TO PAYROLL ===\n");
    const expenses = await c.query(`
      SELECT e.id, e.description, e.amount, e.payment_method,
             e.expense_date, e.created_at, e.deleted_at, e.payroll_period_id,
             cu.name AS created_by_name
      FROM expenses e
      LEFT JOIN users cu ON cu.id = e.created_by
      WHERE (e.description ILIKE '%payroll%'
             OR e.description ILIKE '%gaji%'
             OR e.payroll_period_id IS NOT NULL)
      ORDER BY e.created_at DESC
    `);
    for (const e of expenses.rows) {
      const status = e.deleted_at ? "DELETED" : "ACTIVE";
      console.log(
        `  [${status}] ${e.id} | ${e.description} | Rp ${Number(e.amount).toLocaleString("id-ID")} | ${e.payment_method} | date=${e.expense_date} | linked_period=${e.payroll_period_id ?? "-"} | by ${e.created_by_name}`,
      );
    }

    /* 3. Journal entries related ke payroll */
    console.log("\n=== JOURNAL ENTRIES — PAYROLL ===\n");
    const journals = await c.query(`
      SELECT je.id, je.entry_number, je.entry_date, je.description,
             je.source_type, je.source_id, je.status,
             je.posted_at, je.reversed_by_entry_id, je.reverses_entry_id,
             cu.name AS created_by_name,
             (SELECT COALESCE(SUM(debit), 0) FROM journal_lines WHERE entry_id = je.id) AS total_debit
      FROM journal_entries je
      LEFT JOIN users cu ON cu.id = je.created_by
      WHERE je.source_type IN ('payroll_paid', 'manual')
        AND (je.description ILIKE '%payroll%' OR je.description ILIKE '%gaji%')
      ORDER BY je.entry_date DESC, je.entry_number DESC
    `);
    for (const j of journals.rows) {
      const reverse =
        j.reversed_by_entry_id || j.reverses_entry_id
          ? `[REV→${j.reversed_by_entry_id?.slice(0, 8)}${j.reverses_entry_id ? ` ←${j.reverses_entry_id.slice(0, 8)}` : ""}]`
          : "";
      console.log(
        `  ${j.entry_number} | ${j.entry_date} | ${j.source_type.padEnd(15)} | ${j.status.padEnd(8)} ${reverse} | Rp ${Number(j.total_debit).toLocaleString("id-ID")} | ${j.description}`,
      );
    }

    /* 4. Journal lines untuk entries di atas */
    if (journals.rows.length > 0) {
      console.log("\n=== JOURNAL LINES (DETAIL) ===\n");
      for (const j of journals.rows) {
        console.log(`\n  ${j.entry_number} ${j.description}`);
        const lines = await c.query(
          `SELECT jl.debit, jl.credit, jl.description AS line_desc,
                  coa.code AS account_code, coa.name AS account_name
           FROM journal_lines jl
           LEFT JOIN chart_of_accounts coa ON coa.id = jl.account_id
           WHERE jl.entry_id = $1 ORDER BY jl.line_number`,
          [j.id],
        );
        for (const l of lines.rows) {
          const dr = Number(l.debit);
          const cr = Number(l.credit);
          console.log(
            `    ${l.account_code} ${l.account_name?.padEnd(35)} Dr ${dr ? Number(dr).toLocaleString("id-ID").padStart(12) : "-".padStart(12)} | Cr ${cr ? Number(cr).toLocaleString("id-ID").padStart(12) : "-".padStart(12)}`,
          );
        }
      }
    }

    /* 5. Period accounting Mei 2026 — total per type */
    console.log("\n=== PERIOD AKUNTANSI MEI 2026 SUMMARY ===\n");
    const periodSummary = await c.query(`
      SELECT coa.type, coa.code, coa.name,
             COALESCE(SUM(jl.debit), 0) AS total_debit,
             COALESCE(SUM(jl.credit), 0) AS total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.entry_date BETWEEN '2026-05-01' AND '2026-05-31'
        AND je.status = 'posted'
        AND coa.type IN ('expense', 'revenue', 'cogs')
      GROUP BY coa.type, coa.code, coa.name
      HAVING COALESCE(SUM(jl.debit), 0) > 0 OR COALESCE(SUM(jl.credit), 0) > 0
      ORDER BY coa.type, coa.code
    `);
    for (const r of periodSummary.rows) {
      const net = Number(r.total_debit) - Number(r.total_credit);
      console.log(
        `  ${r.type.padEnd(8)} | ${r.code} ${r.name?.padEnd(35)} | Dr ${Number(r.total_debit).toLocaleString("id-ID").padStart(15)} Cr ${Number(r.total_credit).toLocaleString("id-ID").padStart(15)} | Net ${net.toLocaleString("id-ID")}`,
      );
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
