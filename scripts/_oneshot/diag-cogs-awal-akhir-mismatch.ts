/**
 * Read-only: buktikan tab "Cost of Goods Sold" (getCogsReport) memilih sesi
 * opname yang SALAH untuk Stock Awal / Stock Akhir — sehingga stok akhir
 * bulan lalu tidak jadi stok awal bulan ini.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/_oneshot/diag-cogs-awal-akhir-mismatch.ts
 */
export {};

async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL kosong");
  const sql = postgres(url, { max: 1, ssl: "require" });

  const [outlet] = await sql`
    SELECT id, name FROM outlets WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `;
  console.log(`Outlet: ${outlet.name}\n`);
  const oid = outlet.id as string;

  const sess = await sql`
    SELECT period_label, status,
           (started_at AT TIME ZONE 'Asia/Jakarta')::timestamp AS counted_at,
           (finalized_at AT TIME ZONE 'Asia/Jakarta')::timestamp AS approved_at,
           (SELECT count(*) FROM stock_opname_lines l WHERE l.session_id = s.id) AS n_lines
    FROM stock_opname_sessions s
    WHERE s.outlet_id = ${oid}::uuid AND s.status = 'completed'
    ORDER BY started_at
  `;
  console.log("=== SESI OPNAME COMPLETED (jam WIB) ===");
  for (const r of sess) {
    console.log(
      `hitung ${String(r.counted_at).slice(0, 16)} | setuju ${String(r.approved_at).slice(0, 16)} | ${String(r.n_lines).padStart(4)} baris | ${r.period_label}`,
    );
  }

  const months = ["2026-05", "2026-06", "2026-07", "2026-08"];
  console.log("\n=== PILIHAN SESI PER BULAN ===");
  for (const ym of months) {
    const from = `${ym}-01`;
    const [y, m] = ym.split("-").map(Number);
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    const [before] = await sql`
      SELECT period_label,
             (started_at AT TIME ZONE 'Asia/Jakarta')::date AS counted,
             (finalized_at AT TIME ZONE 'Asia/Jakarta')::date AS approved
      FROM stock_opname_sessions
      WHERE outlet_id = ${oid}::uuid AND status = 'completed'
        AND finalized_at < ${from + "T00:00:00+07:00"}::timestamptz
      ORDER BY finalized_at DESC LIMIT 1
    `;
    const [within] = await sql`
      SELECT period_label,
             (started_at AT TIME ZONE 'Asia/Jakarta')::date AS counted,
             (finalized_at AT TIME ZONE 'Asia/Jakarta')::date AS approved
      FROM stock_opname_sessions
      WHERE outlet_id = ${oid}::uuid AND status = 'completed'
        AND finalized_at >= ${from + "T00:00:00+07:00"}::timestamptz
      ORDER BY finalized_at ASC LIMIT 1
    `;
    const [beforeFix] = await sql`
      SELECT period_label, (started_at AT TIME ZONE 'Asia/Jakarta')::date AS counted
      FROM stock_opname_sessions
      WHERE outlet_id = ${oid}::uuid AND status = 'completed'
        AND started_at < (${from}::date AT TIME ZONE 'Asia/Jakarta')
      ORDER BY started_at DESC LIMIT 1
    `;
    const [withinFix] = await sql`
      SELECT period_label, (started_at AT TIME ZONE 'Asia/Jakarta')::date AS counted
      FROM stock_opname_sessions
      WHERE outlet_id = ${oid}::uuid AND status = 'completed'
        AND started_at >= (${from}::date AT TIME ZONE 'Asia/Jakarta')
        AND started_at < ((${to}::date + interval '1 day') AT TIME ZONE 'Asia/Jakarta')
      ORDER BY started_at DESC LIMIT 1
    `;

    console.log(`\n--- ${ym} (${from} .. ${to}) ---`);
    console.log(
      `  SEKARANG   awal  = ${before ? `${before.period_label} (hitung ${String(before.counted).slice(0, 10)}, setuju ${String(before.approved).slice(0, 10)})` : "TIDAK ADA → fallback current-delta"}`,
    );
    console.log(
      `             akhir = ${within ? `${within.period_label} (hitung ${String(within.counted).slice(0, 10)}, setuju ${String(within.approved).slice(0, 10)})` : "TIDAK ADA → fallback current stock"}`,
    );
    console.log(
      `  SEHARUSNYA awal  = ${beforeFix ? `${beforeFix.period_label} (hitung ${String(beforeFix.counted).slice(0, 10)})` : "TIDAK ADA"}`,
    );
    console.log(
      `             akhir = ${withinFix ? `${withinFix.period_label} (hitung ${String(withinFix.counted).slice(0, 10)})` : "TIDAK ADA"}`,
    );
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
