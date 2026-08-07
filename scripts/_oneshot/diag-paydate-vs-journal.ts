/**
 * Sesi AE-188 — READ-ONLY. Ketiga tempat tanggal pelunasan hutang harus sama:
 * `purchases.paid_at`, `expenses.expense_date`, dan `entry_date` jurnal
 * `purchase_pay`. Skrip ini menunjukkan yang tidak sinkron plus apakah
 * pembayarannya mendarat SEBELUM hutangnya sendiri tercatat.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`
    select p.id::text as po_id, p.purchase_date::text as beli,
           s.name as supplier, p.total_amount::bigint as total,
           to_char(p.paid_at at time zone 'Asia/Jakarta','YYYY-MM-DD') as paid_at,
           e.expense_date::text as kas_tgl, e.id::text as expense_id,
           je.entry_number as je_no, je.entry_date::text as je_tgl,
           (select min(gje.entry_date)::text from journal_entries gje
             where gje.status='posted' and gje.source_type='purchase_create'
               and (gje.source_id = p.id
                    or gje.source_id in (select gr.id from goods_receipts gr
                                          where gr.purchase_id = p.id))) as hutang_tgl
    from purchases p
    left join suppliers s on s.id = p.supplier_id
    left join expenses e on e.id = p.expense_id and e.deleted_at is null
    left join journal_entries je on je.source_type='purchase_pay'
                                and je.source_id = p.id and je.status='posted'
    where p.payment_method='top' and p.status='paid'
    order by p.paid_at`);

  console.log("\n=== Sinkronisasi tanggal pelunasan (TOP lunas) ===");
  const beda: typeof r.rows = [];
  const sebelumHutang: typeof r.rows = [];
  for (const x of r.rows) {
    const sync = x.paid_at === x.je_tgl && x.paid_at === x.kas_tgl;
    if (!sync) beda.push(x);
    if (x.je_tgl && x.hutang_tgl && x.je_tgl < x.hutang_tgl) sebelumHutang.push(x);
    console.log(
      `${sync ? "✓" : "✗"} ${String(x.supplier ?? "—").padEnd(24)} ` +
        `beli ${x.beli} | hutang-di-GL ${x.hutang_tgl ?? "—"} | ` +
        `paid_at ${x.paid_at} | kas ${x.kas_tgl ?? "—"} | jurnal ${x.je_tgl ?? "—"} (${x.je_no ?? "-"})`,
    );
  }
  console.log(`\n>>> Tidak sinkron: ${beda.length} dari ${r.rows.length}`);
  console.log(
    `>>> Jurnal pembayaran mendarat SEBELUM hutangnya tercatat: ${sebelumHutang.length}`,
  );
  for (const x of sebelumHutang) {
    console.log(
      `    - ${x.supplier}: bayar ${x.je_tgl}, padahal hutang baru muncul ${x.hutang_tgl} (${x.je_no})`,
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
