/**
 * DIAG (READ-ONLY) — profil data sebelum cutoff 1 Juli 2026.
 *
 * Rencana owner (sesi AE-207): mulai bersih dari Juli.
 *   KEEP  : penjualan (menu+transaksi), hutang & hutang dagang, payroll, investor
 *   HAPUS : opname sebelum Juli, pembelian bahan baku sebelum Juli, pengeluaran kas sebelum Juli
 *
 * Script ini TIDAK MENGUBAH APA PUN. Hanya menghitung dampak.
 *
 * Usage: npx tsx scripts/_oneshot/diag-cutoff-juli.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const CUTOFF = "2026-07-01"; // hapus data dengan tanggal < CUTOFF

const rp = (n: number | string | null) =>
  "Rp " + Number(n ?? 0).toLocaleString("id-ID");

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const q = async (label: string, sqlText: string) => {
    const res = await pool.query(sqlText);
    console.log(`\n── ${label}`);
    if (res.rows.length === 0) {
      console.log("   (kosong)");
      return res.rows;
    }
    for (const row of res.rows) {
      const parts = Object.entries(row).map(([k, v]) => {
        const isMoney = /amount|total|debit|credit|nilai|saldo/i.test(k);
        return `${k}=${isMoney && v != null ? rp(v as number) : String(v)}`;
      });
      console.log("   " + parts.join("  |  "));
    }
    return res.rows;
  };

  console.log("═".repeat(72));
  console.log(`DIAG CUTOFF — batas ${CUTOFF} (data SEBELUM tanggal ini = kandidat hapus)`);
  console.log("═".repeat(72));

  await q(
    "Rentang tanggal data operasional",
    `SELECT 'transactions' AS tabel, min(created_at)::date AS awal, max(created_at)::date AS akhir, count(*) AS n FROM transactions
     UNION ALL SELECT 'purchases', min(purchase_date), max(purchase_date), count(*) FROM purchases
     UNION ALL SELECT 'expenses', min(expense_date), max(expense_date), count(*) FROM expenses
     UNION ALL SELECT 'incomes', min(income_date), max(income_date), count(*) FROM incomes
     UNION ALL SELECT 'journal_entries', min(entry_date), max(entry_date), count(*) FROM journal_entries
     UNION ALL SELECT 'stock_opname_sessions', min(started_at)::date, max(started_at)::date, count(*) FROM stock_opname_sessions
     UNION ALL SELECT 'inventory_movements', min(created_at)::date, max(created_at)::date, count(*) FROM inventory_movements`,
  );

  /* ═══ PEMBELIAN ═══ */
  await q(
    "PEMBELIAN sebelum Juli — per status bayar × status terima",
    `SELECT status, receipt_status, count(*) AS n, sum(total_amount) AS total_amount
     FROM purchases WHERE purchase_date < '${CUTOFF}'
     GROUP BY 1,2 ORDER BY 1,2`,
  );
  await q(
    "PEMBELIAN sebelum Juli — masih HUTANG (belum lunas) = ini hutang dagang",
    `SELECT p.purchase_date, s.name AS supplier, p.total_amount, p.due_date, p.receipt_status
     FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.purchase_date < '${CUTOFF}' AND p.status = 'pending_payment' AND p.receipt_status <> 'cancelled'
     ORDER BY p.purchase_date`,
  );
  await q(
    "PEMBELIAN Juli ke atas (DIPERTAHANKAN)",
    `SELECT status, receipt_status, count(*) AS n, sum(total_amount) AS total_amount
     FROM purchases WHERE purchase_date >= '${CUTOFF}' GROUP BY 1,2 ORDER BY 1,2`,
  );
  await q(
    "Goods receipts sebelum Juli",
    `SELECT count(*) AS n, sum(total_amount) AS total_amount FROM goods_receipts WHERE received_date < '${CUTOFF}'`,
  );
  await q(
    "⚠️ GR bertanggal Juli+ tapi PO-nya sebelum Juli (kalau PO dihapus, GR ikut hilang)",
    `SELECT count(*) AS n, sum(gr.total_amount) AS total_amount
     FROM goods_receipts gr JOIN purchases p ON p.id = gr.purchase_id
     WHERE gr.received_date >= '${CUTOFF}' AND p.purchase_date < '${CUTOFF}'`,
  );
  await q(
    "⚠️ Pembelian sebelum Juli yang di-link ke PR (purchase_request)",
    `SELECT count(*) AS n FROM purchases WHERE purchase_date < '${CUTOFF}' AND from_purchase_request_id IS NOT NULL`,
  );

  /* ═══ PENGELUARAN KAS ═══ */
  await q(
    "PENGELUARAN sebelum Juli — per sumber",
    `SELECT source_type, payment_method, count(*) AS n, sum(amount) AS total_amount,
            count(*) FILTER (WHERE deleted_at IS NOT NULL) AS sudah_dihapus
     FROM expenses WHERE expense_date < '${CUTOFF}' GROUP BY 1,2 ORDER BY 1,2`,
  );
  await q(
    "PEMASUKAN (incomes) sebelum Juli — TIDAK disebut owner, default DIPERTAHANKAN",
    `SELECT count(*) AS n, sum(amount) AS total_amount FROM incomes WHERE income_date < '${CUTOFF}' AND deleted_at IS NULL`,
  );

  /* ═══ OPNAME ═══ */
  await q(
    "OPNAME — per bulan (started_at WIB) × status",
    `SELECT to_char(started_at + interval '7 hours', 'YYYY-MM') AS bulan, status, count(*) AS n
     FROM stock_opname_sessions GROUP BY 1,2 ORDER BY 1,2`,
  );
  await q(
    "OPNAME sebelum Juli — jumlah baris detail",
    `SELECT count(*) AS n_lines FROM stock_opname_lines l
     JOIN stock_opname_sessions s ON s.id = l.session_id
     WHERE s.started_at < '${CUTOFF} 00:00:00+07'`,
  );
  await q(
    "COGS period closes (rantai opname → HPP)",
    `SELECT period_ym, closed_at::date AS closed_at, total_cogs, adjustment_total FROM cogs_period_closes ORDER BY period_ym`,
  );

  /* ═══ JURNAL ═══ */
  await q(
    "JURNAL sebelum Juli — per sumber",
    `SELECT je.source_type, je.status, count(*) AS n,
            sum((SELECT coalesce(sum(jl.debit),0) FROM journal_lines jl WHERE jl.entry_id = je.id)) AS total_debit
     FROM journal_entries je WHERE je.entry_date < '${CUTOFF}'
     GROUP BY 1,2 ORDER BY 1,2`,
  );
  await q(
    "Periode akuntansi",
    `SELECT * FROM accounting_periods ORDER BY 1 LIMIT 20`,
  );

  /* ═══ SALDO GL per 30 Juni ═══ */
  await q(
    "SALDO GL kumulatif s/d 30 Juni 2026 (posted saja) — akun kunci",
    `SELECT coa.code, coa.name, coa.type,
            sum(jl.debit) AS total_debit, sum(jl.credit) AS total_credit,
            CASE WHEN coa.type IN ('asset','expense') THEN sum(jl.debit) - sum(jl.credit)
                 ELSE sum(jl.credit) - sum(jl.debit) END AS saldo
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     JOIN chart_of_accounts coa ON coa.id = jl.account_id
     WHERE je.status = 'posted' AND je.entry_date < '${CUTOFF}'
     GROUP BY 1,2,3 HAVING sum(jl.debit) <> 0 OR sum(jl.credit) <> 0
     ORDER BY coa.code`,
  );

  /* ═══ STOK & PERGERAKAN ═══ */
  await q(
    "inventory_movements sebelum Juli — per kind",
    `SELECT kind, count(*) AS n FROM inventory_movements WHERE created_at < '${CUTOFF} 00:00:00+07' GROUP BY 1 ORDER BY 1`,
  );

  /* ═══ YANG DIPERTAHANKAN ═══ */
  await q(
    "KEEP — ringkasan tabel yang tidak disentuh",
    `SELECT 'creditors' AS tabel, count(*) AS n FROM creditors
     UNION ALL SELECT 'creditor_repayments', count(*) FROM creditor_repayments
     UNION ALL SELECT 'internal_debt_entries', count(*) FROM internal_debt_entries
     UNION ALL SELECT 'internal_debt_repayments', count(*) FROM internal_debt_repayments
     UNION ALL SELECT 'payroll_periods', count(*) FROM payroll_periods
     UNION ALL SELECT 'investors', count(*) FROM investors
     UNION ALL SELECT 'capital_movements', count(*) FROM capital_movements
     UNION ALL SELECT 'profit_distributions', count(*) FROM profit_distributions
     UNION ALL SELECT 'transactions', count(*) FROM transactions
     UNION ALL SELECT 'purchase_requests', count(*) FROM purchase_requests`,
  );

  /* ═══ FK yang menunjuk ke baris yang akan dihapus ═══ */
  await q(
    "Semua FK yang menunjuk purchases / expenses / stock_opname_sessions",
    `SELECT con.conrelid::regclass::text AS tabel_anak,
            att.attname AS kolom,
            con.confrelid::regclass::text AS tabel_induk,
            con.confdeltype AS on_delete
     FROM pg_constraint con
     JOIN unnest(con.conkey) AS k(attnum) ON TRUE
     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     WHERE con.contype='f'
       AND con.confrelid::regclass::text IN ('purchases','expenses','stock_opname_sessions','goods_receipts','purchase_items','journal_entries')
     ORDER BY 3,1`,
  );

  console.log("\n" + "═".repeat(72));
  console.log("Selesai — TIDAK ADA perubahan data (read-only).");
  await pool.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
