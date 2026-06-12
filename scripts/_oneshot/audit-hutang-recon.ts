/** Sesi AE-181 — rekonsiliasi GL vs subledger semua akun hutang (READ-ONLY, approved owner). */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // GL balance per akun hutang: SUM(credit) - SUM(debit) dari journal posted
  const gl = await pool.query(`
    select a.code, a.name,
           coalesce(sum(jl.credit),0)::bigint as cr,
           coalesce(sum(jl.debit),0)::bigint as dr,
           (coalesce(sum(jl.credit),0) - coalesce(sum(jl.debit),0))::bigint as balance_cr
    from chart_of_accounts a
    left join journal_lines jl on jl.account_id = a.id
    left join journal_entries je on je.id = jl.entry_id and je.status = 'posted'
    where a.code in ('2101','2102','2110','2150','2160','2170') and a.deleted_at is null
    group by a.code, a.name order by a.code`);
  console.log("=== GL (posted journal) ===");
  console.table(gl.rows);

  // Cek nama kolom journal_lines dulu kalau query di atas error — fallback di catch main.

  // Subledger
  const cred = await pool.query(`
    select count(*)::int as n, coalesce(sum(principal_outstanding),0)::bigint as outstanding
    from creditors where deleted_at is null and status = 'active'`);
  console.log("subledger 2150 — kreditur aktif:", cred.rows[0]);

  const internal = await pool.query(`
    select count(*)::int as n, coalesce(sum(total_outstanding),0)::bigint as outstanding
    from internal_debt_parties where deleted_at is null`);
  console.log("subledger 2170 — pihak internal:", internal.rows[0]);

  const top = await pool.query(`
    select count(*)::int as n, coalesce(sum(total_amount),0)::bigint as outstanding, receipt_status, status
    from purchases where payment_method = 'top' and status = 'pending_payment' and deleted_at is null
    group by receipt_status, status`);
  console.log("subledger 2101 — TOP pending_payment per receipt_status:");
  console.table(top.rows);

  const div = await pool.query(`
    select 'investors' as src, coalesce(sum(dividend_balance),0)::bigint as bal from investors where deleted_at is null
    union all
    select 'pengelola', coalesce(sum(dividend_balance),0)::bigint from pengelola where deleted_at is null`);
  console.log("subledger 2160 — dividend balance:");
  console.table(div.rows);

  await pool.end();
  process.exit(0);
}
main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
