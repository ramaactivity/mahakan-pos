/**
 * Read-only: audit modul Persediaan Bahan Baku (mode periodic).
 *
 * Pertanyaan owner: Agustus belum opname, kenapa Stok Akhir sudah ada isinya
 * dan ada "pemakaian", padahal auto-deduct penjualan sudah dimatikan?
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/_oneshot/audit-persediaan-AE202.ts
 */
export {};

type Row = Record<string, unknown>;

async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL kosong");
  const sql = postgres(url, { max: 1, ssl: "require" });

  const [outlet] = await sql`
    SELECT id, name, settings FROM outlets WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `;
  const oid = outlet.id as string;
  console.log(`Outlet: ${outlet.name}\n`);

  // ── 1. Feature flags ────────────────────────────────────────────
  const feats = (outlet.settings as Row | null)?.features as Row | undefined;
  console.log("=== 1. FEATURE FLAGS ===");
  console.log(`  perpetualStockSales     = ${feats?.perpetualStockSales}`);
  console.log(`  perpetualStockPurchases = ${feats?.perpetualStockPurchases}`);

  // ── 2. current_stock vs opname Juli ─────────────────────────────
  console.log("\n=== 2. current_stock vs hitungan opname Juli (10 sampel) ===");
  const cmp = await sql`
    SELECT i.name,
           i.current_stock_decimal::numeric AS current_stock,
           COALESCE(l.actual_qty_decimal, l.actual_qty::numeric) AS opname_juli
    FROM ingredients i
    LEFT JOIN stock_opname_lines l ON l.ingredient_id = i.id
      AND l.session_id = (
        SELECT id FROM stock_opname_sessions
        WHERE outlet_id = ${oid}::uuid AND status = 'completed'
        ORDER BY started_at DESC LIMIT 1
      )
    WHERE i.outlet_id = ${oid}::uuid AND i.deleted_at IS NULL
      AND i.is_preparation = false
    ORDER BY i.name
  `;
  let sama = 0;
  let beda = 0;
  const bedaSample: string[] = [];
  for (const r of cmp) {
    if (r.opname_juli === null) continue;
    const c = Number(r.current_stock);
    const o = Number(r.opname_juli);
    if (Math.abs(c - o) < 0.0001) sama++;
    else {
      beda++;
      if (bedaSample.length < 8)
        bedaSample.push(`${r.name}: current=${c} opname=${o}`);
    }
  }
  console.log(`  current_stock == opname Juli : ${sama} bahan`);
  console.log(`  berbeda                      : ${beda} bahan`);
  for (const s of bedaSample) console.log(`    ${s}`);

  // ── 3. Pergerakan stok Agustus ──────────────────────────────────
  console.log("\n=== 3. inventory_movements Agustus 2026 ===");
  const mv = await sql`
    SELECT kind,
           COUNT(*)::int AS n,
           SUM(CASE WHEN skipped_stock_update THEN 1 ELSE 0 END)::int AS n_skipped,
           SUM(qty_delta_decimal)::numeric AS total_delta
    FROM inventory_movements
    WHERE outlet_id = ${oid}::uuid
      AND created_at >= '2026-08-01 00:00:00+07'
      AND created_at <= '2026-08-31 23:59:59+07'
    GROUP BY kind ORDER BY n DESC
  `;
  if (mv.length === 0) console.log("  (tidak ada pergerakan sama sekali)");
  for (const r of mv) {
    console.log(
      `  ${String(r.kind).padEnd(14)} n=${String(r.n).padStart(4)} skipped=${String(r.n_skipped).padStart(4)} Δ=${r.total_delta}`,
    );
  }

  // ── 4. Pembelian Agustus vs "pemakaian" yang dilaporkan ─────────
  console.log("\n=== 4. Pembelian Agustus (sumber kolom Pembelian) ===");
  const gr = await sql`
    SELECT COALESCE(SUM(gri.total_cost), 0)::numeric AS total, COUNT(*)::int AS n
    FROM goods_receipt_items gri
    JOIN goods_receipts g ON g.id = gri.goods_receipt_id
    JOIN purchases p ON p.id = g.purchase_id
    WHERE g.outlet_id = ${oid}::uuid
      AND g.received_date >= '2026-08-01' AND g.received_date <= '2026-08-31'
      AND p.status != 'cancelled'
  `;
  const inst = await sql`
    SELECT COALESCE(SUM(pi.total_cost), 0)::numeric AS total, COUNT(*)::int AS n
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    WHERE p.outlet_id = ${oid}::uuid
      AND p.purchase_date >= '2026-08-01' AND p.purchase_date <= '2026-08-31'
      AND p.status != 'cancelled' AND p.receipt_status = 'received'
      AND NOT EXISTS (SELECT 1 FROM goods_receipts g WHERE g.purchase_id = p.id)
  `;
  console.log(`  GR (received_date Agustus)     : ${gr[0].n} baris, Rp ${Number(gr[0].total).toLocaleString("id-ID")}`);
  console.log(`  Instant purchase (tanpa GR)    : ${inst[0].n} baris, Rp ${Number(inst[0].total).toLocaleString("id-ID")}`);
  console.log(
    `  TOTAL pembelian Agustus        : Rp ${(Number(gr[0].total) + Number(inst[0].total)).toLocaleString("id-ID")}`,
  );
  console.log("  (bandingkan dgn TOTAL COGS di layar: Rp 6.069.617)");

  // ── 5. Penjualan Agustus (bukti auto-deduct mati) ───────────────
  console.log("\n=== 5. Penjualan Agustus & jejak deduksi stok ===");
  const tx = await sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric AS omzet
    FROM transactions
    WHERE outlet_id = ${oid}::uuid AND status = 'paid'
      AND created_at >= '2026-08-01 00:00:00+07' AND created_at <= '2026-08-31 23:59:59+07'
  `;
  console.log(`  transaksi paid: ${tx[0].n}, omzet Rp ${Number(tx[0].omzet).toLocaleString("id-ID")}`);
  const salesMv = await sql`
    SELECT COUNT(*)::int AS n FROM inventory_movements
    WHERE outlet_id = ${oid}::uuid AND kind = 'sale_deduct'
      AND created_at >= '2026-08-01 00:00:00+07'
  `;
  console.log(`  movement tipe sale di Agustus: ${salesMv[0].n} (harus 0 kalau auto-deduct mati)`);

  // ── 6. Jurnal HPP Agustus (apakah COGS ikut ke-posting?) ────────
  console.log("\n=== 6. Jurnal akun HPP (5101/5102/5103) Agustus ===");
  const jr = await sql`
    SELECT coa.code, je.source_type, COUNT(*)::int AS n,
           SUM(jl.debit - jl.credit)::numeric AS net
    FROM journal_entries je
    JOIN journal_lines jl ON jl.entry_id = je.id
    JOIN chart_of_accounts coa ON coa.id = jl.account_id
    WHERE je.outlet_id = ${oid}::uuid AND je.status = 'posted'
      AND je.entry_date >= '2026-08-01' AND je.entry_date <= '2026-08-31'
      AND coa.code IN ('5101','5102','5103')
    GROUP BY coa.code, je.source_type ORDER BY coa.code
  `;
  if (jr.length === 0) console.log("  (tidak ada — HPP belum diakui di jurnal Agustus)");
  for (const r of jr) {
    console.log(
      `  ${r.code} ${String(r.source_type).padEnd(18)} n=${String(r.n).padStart(4)} net=Rp ${Number(r.net).toLocaleString("id-ID")}`,
    );
  }

  // ── 7. Akun Persediaan (1140/1141/1142) ─────────────────────────
  console.log("\n=== 7. Saldo akun Persediaan vs nilai stok fisik ===");
  const inv = await sql`
    SELECT coa.code, coa.name, SUM(jl.debit - jl.credit)::numeric AS saldo
    FROM journal_entries je
    JOIN journal_lines jl ON jl.entry_id = je.id
    JOIN chart_of_accounts coa ON coa.id = jl.account_id
    WHERE je.outlet_id = ${oid}::uuid AND je.status = 'posted'
      AND coa.code IN ('1140','1141','1142')
    GROUP BY coa.code, coa.name ORDER BY coa.code
  `;
  for (const r of inv) {
    console.log(`  ${r.code} ${String(r.name).padEnd(28)} Rp ${Number(r.saldo).toLocaleString("id-ID")}`);
  }
  const fisik = await sql`
    SELECT i.section, SUM(
      COALESCE(l.actual_qty_decimal, l.actual_qty::numeric) * l.unit_cost_at_snapshot
    )::numeric AS nilai
    FROM stock_opname_lines l
    JOIN ingredients i ON i.id = l.ingredient_id
    WHERE l.session_id = (
      SELECT id FROM stock_opname_sessions
      WHERE outlet_id = ${oid}::uuid AND status='completed' ORDER BY started_at DESC LIMIT 1
    )
    GROUP BY i.section ORDER BY i.section
  `;
  console.log("  Nilai stok per opname Juli (qty × harga snapshot):");
  let tot = 0;
  for (const r of fisik) {
    tot += Number(r.nilai);
    console.log(`    ${String(r.section ?? "—").padEnd(12)} Rp ${Number(r.nilai).toLocaleString("id-ID")}`);
  }
  console.log(`    TOTAL        Rp ${tot.toLocaleString("id-ID")}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
