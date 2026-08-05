/**
 * Audit AE-186 — READ-ONLY integrity audit, tidak menulis apa pun ke DB.
 * Cek: jurnal tak seimbang, dobel aktif, tanggal di luar periode, header
 * tanpa baris, konsistensi pasangan reverse, transaksi tanpa jurnal,
 * backlog retry, GL vs subledger hutang (2101/2150/2170), status periode.
 * Jalankan: npx tsx --env-file-if-exists=.env.local scripts/_oneshot/audit-db-integrity-readonly.ts
 */
export {};
async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");

  const q = async (label: string, query: ReturnType<typeof sql>) => {
    const res = await db.execute(query);
    console.log(`\n=== ${label} ===`);
    const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? res;
    console.log(JSON.stringify(rows, null, 1).slice(0, 4000));
    return rows;
  };

  await q("1. Jurnal TIDAK SEIMBANG (posted/draft)", sql`
    SELECT je.id, je.entry_number, je.entry_date, je.source_type, je.status,
           SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
    FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
    WHERE je.status IN ('posted','draft')
    GROUP BY je.id
    HAVING SUM(jl.debit) <> SUM(jl.credit)
    LIMIT 20`);

  await q("2. Jurnal DOBEL aktif per (outlet,source)", sql`
    SELECT outlet_id, source_type, source_id, COUNT(*) AS n
    FROM journal_entries
    WHERE source_id IS NOT NULL AND status IN ('posted','draft')
    GROUP BY outlet_id, source_type, source_id
    HAVING COUNT(*) > 1
    LIMIT 20`);

  await q("3. entry_date DI LUAR periodenya", sql`
    SELECT je.id, je.entry_number, je.entry_date, je.status, je.source_type,
           p.period_year, p.period_month
    FROM journal_entries je JOIN accounting_periods p ON p.id = je.period_id
    WHERE (EXTRACT(YEAR FROM je.entry_date) <> p.period_year
        OR EXTRACT(MONTH FROM je.entry_date) <> p.period_month)
    LIMIT 30`);

  await q("4. Jurnal TANPA baris (orphan header)", sql`
    SELECT je.id, je.entry_number, je.entry_date, je.source_type, je.status
    FROM journal_entries je
    WHERE NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id = je.id)
    LIMIT 20`);

  await q("5a. status='reversed' tapi reversed_by NULL", sql`
    SELECT id, entry_number, entry_date, source_type
    FROM journal_entries
    WHERE status = 'reversed' AND reversed_by_entry_id IS NULL
    LIMIT 20`);

  await q("5b. Counter-entry menunjuk entry yang TIDAK berstatus reversed", sql`
    SELECT c.id AS counter_id, c.entry_number AS counter_no,
           o.id AS orig_id, o.entry_number AS orig_no, o.status AS orig_status
    FROM journal_entries c JOIN journal_entries o ON o.id = c.reverses_entry_id
    WHERE c.status = 'posted' AND o.status <> 'reversed'
    LIMIT 20`);

  await q("5c. Pasangan reverse tanggal beda (counter vs original)", sql`
    SELECT c.entry_number AS counter_no, c.entry_date AS counter_date,
           o.entry_number AS orig_no, o.entry_date AS orig_date
    FROM journal_entries c JOIN journal_entries o ON o.id = c.reverses_entry_id
    WHERE c.entry_date <> o.entry_date
    LIMIT 20`);

  await q("6. Transaksi lunas TANPA jurnal pos_sale (sejak 2026-05-17)", sql`
    SELECT COUNT(*) AS missing, COALESCE(SUM(t.total),0) AS total_amount,
           MIN(t.created_at) AS earliest, MAX(t.created_at) AS latest
    FROM transactions t
    WHERE t.status = 'completed'
      AND t.created_at >= '2026-05-17'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.source_type = 'pos_sale' AND je.source_id = t.id)`);

  await q("7. Antrian retry jurnal (backlog belum resolved)", sql`
    SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL AND abandoned_at IS NULL) AS pending,
           COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
           COUNT(*) FILTER (WHERE abandoned_at IS NOT NULL) AS abandoned
    FROM journal_retry_queue`);

  await q("8. Saldo GL akun hutang & subledger", sql`
    SELECT a.code, a.name,
           SUM(jl.credit) - SUM(jl.debit) AS gl_balance
    FROM chart_of_accounts a
    JOIN journal_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
    WHERE a.code IN ('2101','2150','2170')
    GROUP BY a.code, a.name ORDER BY a.code`);

  await q("8b. Subledger: kreditur outstanding / hutang internal / purchase unpaid", sql`
    SELECT
      (SELECT COALESCE(SUM(principal_outstanding),0) FROM creditors WHERE status = 'active') AS kreditur_outstanding,
      (SELECT COALESCE(SUM(total_outstanding),0) FROM internal_debt_parties) AS internal_outstanding,
      (SELECT COALESCE(SUM(total_amount),0) FROM purchases WHERE status = 'pending_payment') AS purchases_unpaid`);

  await q("9. Periode & status", sql`
    SELECT period_year, period_month, status, COUNT(*) AS outlets
    FROM accounting_periods GROUP BY 1,2,3 ORDER BY 1,2`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
