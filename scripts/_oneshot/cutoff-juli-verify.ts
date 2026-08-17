/**
 * Sesi AE-207 — VERIFIKASI cutoff Juli (READ-ONLY).
 *
 * Menirukan filter yang dipasang di lapisan query aplikasi, lalu memastikan:
 *   1. Neraca per hari ini SEIMBANG (aset = kewajiban + modal).
 *   2. Tidak ada jurnal sebelum batas buku yang masih terhitung.
 *   3. Data yang SENGAJA dipertahankan masih ada: penjualan, payroll, hutang
 *      kreditur/internal, investor, opname stok-awal, nota belum lunas.
 *   4. Data lama masih UTUH di database (disembunyikan, bukan dihapus).
 *
 * Usage: npx tsx scripts/_oneshot/cutoff-juli-verify.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL tidak ada di .env.local");
  process.exit(1);
}

const rp = (n: number) =>
  (n < 0 ? "-" : "") + "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID");

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
}
function info(label: string, detail: string) {
  console.log(`  ·  ${label} — ${detail}`);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  const outletRes = await pool.query<{
    id: string;
    name: string;
    cutoff: { date?: string; opnameDate?: string } | null;
  }>(
    `SELECT id, name, settings->'booksCutoff' AS cutoff FROM outlets
     WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`,
  );
  const outlet = outletRes.rows[0];
  const CUTOFF = outlet?.cutoff?.date ?? null;
  const OPNAME_CUTOFF = outlet?.cutoff?.opnameDate ?? CUTOFF;

  console.log("═".repeat(70));
  console.log(`VERIFIKASI CUTOFF — ${outlet?.name}`);
  console.log("═".repeat(70));
  if (!CUTOFF) {
    console.error("\n❌ Batas buku BELUM aktif (outlets.settings.booksCutoff.date kosong).");
    console.error("   Jalankan dulu: npx tsx scripts/_oneshot/cutoff-juli-apply.ts --confirm\n");
    await pool.end();
    process.exit(1);
  }
  console.log(`Batas buku: ${CUTOFF} · batas opname: ${OPNAME_CUTOFF}\n`);
  const O = outlet.id;

  /* ── 1. Neraca seimbang ─────────────────────────────────────────────── */
  console.log("1. NERACA per hari ini (hanya jurnal >= batas buku)");
  const bal = await pool.query<{ type: string; net: string }>(
    `SELECT coa.type, (SUM(jl.debit) - SUM(jl.credit))::text AS net
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     JOIN chart_of_accounts coa ON coa.id = jl.account_id
     WHERE je.outlet_id = $1 AND je.status = 'posted' AND je.entry_date >= $2
     GROUP BY coa.type`,
    [O, CUTOFF],
  );
  const byType = new Map(bal.rows.map((r) => [r.type, Math.round(Number(r.net))]));
  const asset = byType.get("asset") ?? 0;
  const liability = -(byType.get("liability") ?? 0);
  const equity = -(byType.get("equity") ?? 0);
  const revenue = -(byType.get("revenue") ?? 0);
  const cogs = byType.get("cogs") ?? 0;
  const expense = byType.get("expense") ?? 0;
  const laba = revenue - cogs - expense;

  info("Aset", rp(asset));
  info("Kewajiban", rp(liability));
  info("Modal (sebelum laba periode)", rp(equity));
  info("Laba periode berjalan", `${rp(laba)} (pendapatan ${rp(revenue)} − HPP ${rp(cogs)} − beban ${rp(expense)})`);
  check(
    "Aset = Kewajiban + Modal + Laba",
    asset === liability + equity + laba,
    `${rp(asset)} vs ${rp(liability + equity + laba)}`,
  );

  /* ── 2. Tidak ada jurnal lama yang bocor ────────────────────────────── */
  console.log("\n2. JURNAL sebelum batas buku (disembunyikan, tidak terhitung)");
  /* Buktikan floor-nya memang bekerja: kalau jurnal lama IKUT dihitung,
   * neraca jadi dobel (saldo awal + seluruh riwayat) dan aset melonjak. */
  const naive = await pool.query<{ net: string }>(
    `SELECT (SUM(jl.debit) - SUM(jl.credit))::text AS net
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     JOIN chart_of_accounts coa ON coa.id = jl.account_id
     WHERE je.outlet_id = $1 AND je.status = 'posted' AND coa.type = 'asset'`,
    [O],
  );
  const assetAllTime = Math.round(Number(naive.rows[0]?.net ?? 0));
  info("Aset kalau jurnal lama ikut dihitung", `${rp(assetAllTime)} (dobel — inilah yang dicegah)`);
  check(
    "Batas buku benar-benar mengubah hasil (bukan no-op)",
    assetAllTime !== asset,
    `dengan batas ${rp(asset)} vs tanpa batas ${rp(assetAllTime)}`,
  );

  const opening = await pool.query<{ entry_number: string; entry_date: string; total: string }>(
    `SELECT je.entry_number, je.entry_date::text,
            (SELECT SUM(jl.debit)::text FROM journal_lines jl WHERE jl.entry_id = je.id) AS total
     FROM journal_entries je
     WHERE je.outlet_id = $1 AND je.source_type = 'opening_balance' AND je.status = 'posted'`,
    [O],
  );
  check(
    "Jurnal Saldo Awal ada & tanggalnya = batas buku",
    opening.rows.length === 1 && opening.rows[0].entry_date === CUTOFF,
    opening.rows[0]
      ? `${opening.rows[0].entry_number} tgl ${opening.rows[0].entry_date}, total ${rp(Number(opening.rows[0].total))}`
      : "TIDAK ADA",
  );

  /* ── 3. Yang harus TETAP TAMPIL ─────────────────────────────────────── */
  console.log("\n3. Data yang SENGAJA dipertahankan");
  const q = async (label: string, sqlText: string, params: unknown[] = [O]) => {
    const r = await pool.query<{ n: string }>(sqlText, params);
    return { label, n: Number(r.rows[0]?.n ?? 0) };
  };

  const sales = await q(
    "Transaksi penjualan (semua periode)",
    `SELECT count(*)::text AS n FROM transactions WHERE outlet_id = $1`,
  );
  check(sales.label, sales.n > 0, `${sales.n} transaksi`);

  const opnameVisible = await pool.query<{ mulai: string; lines: string }>(
    `SELECT (started_at + interval '7 hours')::date::text AS mulai,
            (SELECT count(*)::text FROM stock_opname_lines l WHERE l.session_id = s.id) AS lines
     FROM stock_opname_sessions s
     WHERE outlet_id = $1 AND started_at >= ($2::date::timestamptz - interval '7 hours')
     ORDER BY started_at`,
    [O, OPNAME_CUTOFF],
  );
  check(
    "Opname stok-awal periode baru masih tampil",
    opnameVisible.rows.length > 0,
    opnameVisible.rows.map((r) => `${r.mulai} (${r.lines} baris)`).join(", "),
  );

  const unpaid = await q(
    "Nota belum lunas tetap tampil walau tanggalnya lama",
    `SELECT count(*)::text AS n FROM purchases
     WHERE outlet_id = $1 AND status = 'pending_payment' AND receipt_status <> 'cancelled'
       AND purchase_date < $2`,
    [O, CUTOFF],
  );
  info(unpaid.label, `${unpaid.n} nota (dikecualikan dari cutoff, by design)`);

  for (const [label, table, extra] of [
    ["Hutang kreditur", "creditors", "AND status <> 'settled'"],
    ["Hutang internal (talangan)", "internal_debt_entries", ""],
    ["Investor", "investors", ""],
    ["Periode payroll", "payroll_periods", ""],
  ] as const) {
    const r = await q(
      label,
      `SELECT count(*)::text AS n FROM ${table} WHERE outlet_id = $1 ${extra}`,
    );
    check(r.label, r.n > 0, `${r.n} baris`);
  }

  /* ── 4. Data lama masih utuh ────────────────────────────────────────── */
  console.log("\n4. Data lama masih UTUH di database (disembunyikan, bukan dihapus)");
  for (const [label, sqlText] of [
    ["Pembelian sebelum batas", `SELECT count(*)::text AS n FROM purchases WHERE outlet_id = $1 AND purchase_date < $2`],
    ["Pengeluaran sebelum batas", `SELECT count(*)::text AS n FROM expenses WHERE outlet_id = $1 AND expense_date < $2`],
    ["Jurnal sebelum batas", `SELECT count(*)::text AS n FROM journal_entries WHERE outlet_id = $1 AND entry_date < $2`],
    ["Penerimaan barang sebelum batas", `SELECT count(*)::text AS n FROM goods_receipts WHERE outlet_id = $1 AND received_date < $2`],
  ] as const) {
    const r = await q(label, sqlText, [O, CUTOFF]);
    check(`${label} masih ada`, r.n > 0, `${r.n} baris (aman, cuma tak ditampilkan)`);
  }

  console.log("\n" + "═".repeat(70));
  if (failures === 0) {
    console.log("✅ SEMUA CEK LOLOS — buku bersih mulai " + CUTOFF + ", data lama utuh.\n");
  } else {
    console.log(`❌ ${failures} cek GAGAL — periksa di atas.\n`);
  }
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
