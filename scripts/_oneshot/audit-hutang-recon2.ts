/** Sesi AE-181 — rekonsiliasi lanjutan (READ-ONLY). */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const top = await pool.query(`
    select status, receipt_status, count(*)::int as n, coalesce(sum(total_amount),0)::bigint as total
    from purchases where payment_method = 'top'
    group by status, receipt_status order by status, receipt_status`);
  console.log("purchases TOP per status/receipt_status:");
  console.table(top.rows);

  const div = await pool.query(`
    select 'investors' as src, coalesce(sum(dividend_balance),0)::bigint as bal from investors
    union all
    select 'pengelola', coalesce(sum(dividend_balance),0)::bigint from pengelola`);
  console.log("subledger 2160 dividend balances:");
  console.table(div.rows);

  // Bedah semua journal lines yang kena 2101 — sourceType, tanggal, dr/cr
  const j2101 = await pool.query(`
    select je.entry_number, je.entry_date, je.source_type, je.status,
           jl.debit::bigint as dr, jl.credit::bigint as cr, je.description
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join chart_of_accounts a on a.id = jl.account_id
    where a.code = '2101'
    order by je.entry_date, je.entry_number`);
  console.log("journal lines akun 2101:");
  console.table(j2101.rows.map(r => ({...r, description: String(r.description).slice(0,60)})));

  // Jurnal 2150 (siapa yang credit 12jt)
  const j2150 = await pool.query(`
    select je.entry_date, je.source_type, je.status, jl.debit::bigint as dr, jl.credit::bigint as cr,
           left(je.description, 60) as descr
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join chart_of_accounts a on a.id = jl.account_id
    where a.code = '2150' order by je.entry_date`);
  console.log("journal lines akun 2150:");
  console.table(j2150.rows);

  await pool.end();
  process.exit(0);
}
main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
