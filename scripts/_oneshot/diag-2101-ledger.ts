/**
 * Sesi AE-188 — lanjutan diagnosa laporan staff. READ-ONLY.
 *
 * Menampilkan Buku Besar akun 2101 persis seperti yang dilihat staff, plus
 * membandingkan tanggal `paid_at` tiap pelunasan dengan `entry_date` jurnalnya,
 * dan jejak audit perubahan tanggal jurnal.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

const rp = (n: number) => "Rp " + n.toLocaleString("id-ID");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const led = await pool.query(`
    select je.entry_date::text as tgl, je.entry_number as no, je.source_type as src,
           je.source_id::text as src_id, je.status,
           jl.debit::bigint as dr, jl.credit::bigint as cr, jl.description as ket
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join chart_of_accounts a on a.id = jl.account_id
    where a.code = '2101'
    order by je.entry_date, je.entry_number`);

  console.log(`\n=== BUKU BESAR 2101 Hutang Dagang (${led.rows.length} baris) ===`);
  let saldo = 0;
  for (const r of led.rows) {
    const aktif = r.status === "posted";
    if (aktif) saldo += Number(r.cr) - Number(r.dr);
    console.log(
      `${r.tgl} ${String(r.no).padEnd(16)} ${String(r.src).padEnd(22)} ` +
        `Dr ${String(Number(r.dr)).padStart(9)} Cr ${String(Number(r.cr)).padStart(9)} ` +
        `${aktif ? "" : "[" + r.status + "] "}saldo ${aktif ? saldo.toLocaleString("id-ID") : "-"} | ${String(r.ket ?? "").slice(0, 45)}`,
    );
  }
  console.log(`\n  Saldo akhir (posted saja): ${rp(saldo)}`);

  console.log(`\n=== paid_at vs tanggal jurnal pelunasan ===`);
  const cmp = await pool.query(`
    select p.id, p.purchase_date::text as beli, p.paid_at,
           s.name as supplier, p.total_amount::bigint as total,
           je.entry_number as no, je.entry_date::text as jurnal_tgl,
           je.created_at as je_created, je.metadata
    from purchases p
    left join suppliers s on s.id = p.supplier_id
    left join journal_entries je on je.source_type = 'purchase_pay'
                                and je.source_id = p.id and je.status = 'posted'
    where p.payment_method = 'top' and p.status = 'paid'
    order by p.paid_at`);
  for (const r of cmp.rows) {
    const paidIso = r.paid_at
      ? new Date(r.paid_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
      : "—";
    const cocok = paidIso === r.jurnal_tgl;
    console.log(
      `${cocok ? "✓" : "✗"} ${String(r.supplier ?? "—").padEnd(24)} beli ${r.beli} | ` +
        `lunas ${paidIso} | jurnal ${r.jurnal_tgl ?? "TIDAK ADA"} (${r.no ?? "-"})` +
        (r.metadata ? ` | meta ${JSON.stringify(r.metadata).slice(0, 90)}` : ""),
    );
  }

  console.log(`\n=== Jejak audit perubahan tanggal jurnal ===`);
  const aud = await pool.query(`
    select created_at, event_type, entity_id::text, payload
    from audit_logs
    where event_type in ('accounting.journal.date_update','accounting.journal.update',
                         'purchase.mark_paid','purchase.payment_date_update')
    order by created_at desc limit 25`);
  for (const r of aud.rows) {
    console.log(
      `${new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} ` +
        `${String(r.event_type).padEnd(32)} ${JSON.stringify(r.payload).slice(0, 130)}`,
    );
  }

  console.log(`\n=== Jurnal purchase_create per GR (cek legacy sourceId) ===`);
  const gr = await pool.query(`
    select gr.id::text as gr_id, gr.received_date::text as tgl,
           gr.total_amount::bigint as total, p.id::text as po_id,
           s.name as supplier, p.status as po_status, p.payment_method as metode,
           (select je.entry_number from journal_entries je
             where je.source_type='purchase_create' and je.source_id = gr.id
               and je.status='posted' limit 1) as je_by_gr,
           (select je.entry_number from journal_entries je
             where je.source_type='purchase_create' and je.source_id = p.id
               and je.status='posted' limit 1) as je_by_po
    from goods_receipts gr
    join purchases p on p.id = gr.purchase_id
    left join suppliers s on s.id = p.supplier_id
    where p.payment_method = 'top'
    order by gr.received_date`);
  for (const r of gr.rows) {
    const punya = r.je_by_gr ?? r.je_by_po;
    console.log(
      `${punya ? "✓" : "✗"} ${r.tgl} ${String(r.supplier ?? "—").padEnd(24)} ` +
        `${String(rp(Number(r.total))).padStart(14)} ${String(r.po_status).padEnd(16)} ` +
        `${punya ? (r.je_by_gr ? "byGR " + r.je_by_gr : "byPO " + r.je_by_po) : "TIDAK ADA JURNAL"}`,
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
