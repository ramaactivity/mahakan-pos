/**
 * Audit AE-187 — READ-ONLY resource audit (storage, bloat, index, egress).
 * npx tsx --env-file-if-exists=.env.local scripts/_oneshot/audit-resource-usage.ts
 */
export {};
async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const q = async (label: string, query: any) => {
    const r = await db.execute(query);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify((r as any).rows ?? r, null, 1).slice(0, 5000));
  };

  await q("1. Ukuran database total", sql`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`);

  await q("2. Top 15 tabel terbesar (data + index + toast)", sql`
    SELECT c.relname,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
           pg_size_pretty(pg_relation_size(c.oid)) AS data,
           pg_size_pretty(pg_indexes_size(c.oid)) AS idx,
           n_live_tup AS rows, n_dead_tup AS dead
    FROM pg_class c JOIN pg_stat_user_tables t ON t.relid = c.oid
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15`);

  await q("3. Index TIDAK PERNAH dipakai (>1MB)", sql`
    SELECT s.relname AS table, s.indexrelname AS index,
           pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, s.idx_scan
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.idx_scan = 0 AND NOT i.indisunique
      AND pg_relation_size(s.indexrelid) > 1024*1024
    ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 20`);

  await q("4. Seq scan berat (tabel besar sering full-scan)", sql`
    SELECT t.relname, t.seq_scan, t.seq_tup_read, t.idx_scan, t.n_live_tup
    FROM pg_stat_user_tables t
    WHERE t.n_live_tup > 5000 AND t.seq_scan > 1000
    ORDER BY t.seq_tup_read DESC LIMIT 10`);

  await q("5. audit_logs: umur & distribusi per bulan", sql`
    SELECT to_char(created_at, 'YYYY-MM') AS bulan, COUNT(*) AS n,
           pg_size_pretty(SUM(pg_column_size(payload))::bigint) AS payload_size
    FROM audit_logs GROUP BY 1 ORDER BY 1`);

  await q("6. Tabel log/riwayat lain: jumlah baris", sql`
    SELECT 'push_subscriptions' AS t, COUNT(*) FROM push_subscriptions
    UNION ALL SELECT 'journal_retry_queue', COUNT(*) FROM journal_retry_queue
    UNION ALL SELECT 'settlement_logs', COUNT(*) FROM settlement_logs
    UNION ALL SELECT 'approval_codes', COUNT(*) FROM approval_codes
    UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
    UNION ALL SELECT 'notifications', COUNT(*) FROM notifications`);

  await q("7. Dead tuple ratio tinggi (butuh vacuum/bloat)", sql`
    SELECT relname, n_live_tup, n_dead_tup,
           round(100.0*n_dead_tup/GREATEST(n_live_tup+n_dead_tup,1),1) AS dead_pct,
           last_autovacuum
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 1000
    ORDER BY n_dead_tup DESC LIMIT 10`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
