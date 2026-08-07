/**
 * Sesi AE-188 — diagnosa laporan staff: "hutang sudah lunas di daftar, tapi
 * di Buku Besar masih nyangkut; di Jurnal Umum pelunasannya tidak ada".
 *
 * READ-ONLY. Membandingkan tiap pembelian TOP berstatus lunas dengan jurnal
 * `purchase_pay` miliknya, lalu merekonsiliasi saldo GL 2101 vs subledger.
 *
 * Kenapa ini bisa terjadi: hook jurnal bersifat fire-and-forget, dan sapuan
 * per jam (`sweepJournalGaps`) hanya menambal penjualan, settlement, void,
 * dan pengeluaran — `purchase_pay` TIDAK termasuk, jadi kegagalan sekali
 * tidak pernah pulih sendiri.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const paid = await pool.query(`
    select
      p.id,
      p.purchase_date,
      p.paid_at,
      p.total_amount,
      p.expense_id,
      s.name as supplier,
      coalesce((select sum(gr.total_amount) from goods_receipts gr
                where gr.purchase_id = p.id), 0)::bigint as gr_total,
      (select je.id from journal_entries je
        where je.source_type = 'purchase_pay' and je.source_id = p.id
          and je.status = 'posted' limit 1) as pay_entry,
      (select je.entry_number from journal_entries je
        where je.source_type = 'purchase_pay' and je.source_id = p.id
          and je.status = 'posted' limit 1) as pay_entry_no,
      (select je.entry_date::text from journal_entries je
        where je.source_type = 'purchase_pay' and je.source_id = p.id
          and je.status = 'posted' limit 1) as pay_entry_date,
      (select count(*) from journal_entries je
        where je.source_type = 'purchase_create'
          and je.source_id in (select gr.id from goods_receipts gr where gr.purchase_id = p.id)
          and je.status = 'posted')::int as gr_entries,
      (select count(*) from goods_receipts gr where gr.purchase_id = p.id)::int as gr_count
    from purchases p
    left join suppliers s on s.id = p.supplier_id
    where p.payment_method = 'top' and p.status = 'paid'
    order by p.paid_at nulls first`);

  console.log(`\n=== Pembelian TOP berstatus LUNAS: ${paid.rows.length} ===`);
  console.table(
    paid.rows.map((r) => ({
      tgl_beli: r.purchase_date,
      supplier: (r.supplier ?? "—").slice(0, 20),
      total: Number(r.total_amount),
      gr_total: Number(r.gr_total),
      gr: `${r.gr_entries}/${r.gr_count} jurnal`,
      lunas: r.paid_at ? String(r.paid_at).slice(0, 10) : "—",
      jurnal_bayar: r.pay_entry_no ?? "❌ TIDAK ADA",
      tgl_jurnal: r.pay_entry_date ?? "—",
    })),
  );

  const missing = paid.rows.filter((r) => !r.pay_entry);
  console.log(`\n>>> Lunas TANPA jurnal pelunasan: ${missing.length}`);
  let dampak = 0;
  for (const r of missing) {
    const basis = Number(r.gr_total) > 0 ? Number(r.gr_total) : Number(r.total_amount);
    dampak += basis;
    console.log(
      `  - ${r.purchase_date} ${r.supplier ?? "—"} | basis bayar ${basis.toLocaleString("id-ID")} | lunas ${r.paid_at ? String(r.paid_at).slice(0, 10) : "?"} | id ${r.id}`,
    );
  }
  console.log(`  TOTAL nyangkut di 2101: Rp ${dampak.toLocaleString("id-ID")}`);

  // Basis nol → mapPurchasePay menolak (MAP_PURCHASE_PAY_NONPOSITIVE)
  const basisNol = paid.rows.filter(
    (r) => Number(r.gr_total) === 0 && Number(r.total_amount) === 0,
  );
  console.log(`\n>>> Lunas dengan basis bayar NOL (mapper menolak): ${basisNol.length}`);

  // GR tanpa jurnal purchase_create (hutangnya sendiri tak pernah tercatat)
  const grGap = paid.rows.filter((r) => r.gr_count > 0 && r.gr_entries < r.gr_count);
  console.log(`\n>>> TOP lunas yang GR-nya kurang jurnal: ${grGap.length}`);
  for (const r of grGap) {
    console.log(
      `  - ${r.purchase_date} ${r.supplier ?? "—"} | ${r.gr_entries}/${r.gr_count} GR ter-jurnal | id ${r.id}`,
    );
  }

  // Rekonsiliasi GL 2101 vs subledger
  const gl = await pool.query(`
    select (coalesce(sum(jl.credit),0) - coalesce(sum(jl.debit),0))::bigint as saldo
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id and je.status = 'posted'
    join chart_of_accounts a on a.id = jl.account_id
    where a.code = '2101'`);
  const sub = await pool.query(`
    select coalesce(sum(
      greatest(coalesce((select sum(gr.total_amount) from goods_receipts gr
                          where gr.purchase_id = p.id), 0), 0)
    ),0)::bigint as outstanding
    from purchases p
    where p.payment_method = 'top' and p.status = 'pending_payment'`);
  const glSaldo = Number(gl.rows[0].saldo);
  const subSaldo = Number(sub.rows[0].outstanding);
  console.log(`\n=== Rekonsiliasi akun 2101 Hutang Dagang ===`);
  console.log(`  GL (jurnal posted) : Rp ${glSaldo.toLocaleString("id-ID")}`);
  console.log(`  Subledger (belum bayar, basis GR): Rp ${subSaldo.toLocaleString("id-ID")}`);
  console.log(`  Selisih            : Rp ${(glSaldo - subSaldo).toLocaleString("id-ID")}`);

  // Antrian retry — barangkali kegagalannya tercatat
  const q = await pool.query(`
    select hook_label, status, count(*)::int as n
    from journal_retry_queue group by hook_label, status order by n desc limit 10`);
  console.log(`\n=== Antrian jurnal gagal ===`);
  console.table(q.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
