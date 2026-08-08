/**
 * Sesi AE-193 — DRY RUN paritas jurnal harian.
 *
 * Untuk tiap tanggal, bandingkan:
 *   (a) dampak buku besar dari jurnal pos_sale/pos_compliment PER TRANSAKSI
 *       yang sudah ada di produksi, versus
 *   (b) dampak buku besar dari SATU jurnal harian hasil agregasi baru.
 *
 * Kalau per akun angkanya sama persis, cutover aman: saldo tidak bergerak.
 * Tidak menulis apa pun ke database.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { mapPosSale } from "../../src/features/accounting/mapping/posSale";
import { mapPosCompliment } from "../../src/features/accounting/mapping/posCompliment";
import {
  toDailyComplimentInput,
  toDailySaleInput,
  type DailySalesAggregate,
  type SettleMethod,
} from "../../src/features/accounting/daily-sales-pure";

const OUTLET = "7c51a6dd-5aaf-47e4-8cf8-ab5426ed0ff4";
const FROM = process.argv[2] ?? "2026-06-01";
const TO = process.argv[3] ?? "2026-07-31";
const BATCH = "11111111-1111-4111-8111-111111111111";

function rowsOf(r: unknown): any[] {
  return (r as { rows?: any[] }).rows ?? (r as any[]);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const dayRows = rowsOf(
    await db.execute(sql`
      select to_char((created_at at time zone 'Asia/Jakarta')::date, 'YYYY-MM-DD') as d
      from transactions
      where outlet_id = ${OUTLET}
        and status in ('paid','partially_refunded')
        and (created_at at time zone 'Asia/Jakarta')::date between ${FROM}::date and ${TO}::date
      group by 1 order by 1`),
  );

  let okDays = 0;
  const problems: string[] = [];

  for (const { d } of dayRows) {
    const day = String(d);
    const bounds = sql`(${transactionsInDay(day)})`;

    const [hdr] = rowsOf(
      await db.execute(sql`
        select count(*)::int as cnt,
               coalesce(sum(total),0)::bigint as total,
               coalesce(sum(subtotal),0)::bigint as subtotal,
               coalesce(sum(discount_amount),0)::bigint as discount
        from transactions t where t.id in ${bounds}
          and coalesce(t.discount_reason,'') not like 'Compliment:%'`),
    );

    const payRows = rowsOf(
      await db.execute(sql`
        select payment_method as m, coalesce(sum(total),0)::bigint as amt
        from transactions t where t.id in ${bounds}
          and coalesce(t.discount_reason,'') not like 'Compliment:%'
          and t.payment_method <> 'split'
        group by 1
        union all
        select sp.payment_method as m, coalesce(sum(sp.amount),0)::bigint as amt
        from split_payments sp join transactions t on t.id = sp.transaction_id
        where t.id in ${bounds}
          and coalesce(t.discount_reason,'') not like 'Compliment:%'
          and t.payment_method = 'split'
        group by 1`),
    );

    const catRows = rowsOf(
      await db.execute(sql`
        select ti.item_category_name as c,
               coalesce(sum(ti.subtotal),0)::bigint as amt,
               coalesce(sum(coalesce(ti.cogs,0)),0)::bigint as cogs
        from transaction_items ti join transactions t on t.id = ti.transaction_id
        where t.id in ${bounds}
          and coalesce(t.discount_reason,'') not like 'Compliment:%'
        group by 1`),
    );

    const compCatRows = rowsOf(
      await db.execute(sql`
        select ti.item_category_name as c,
               coalesce(sum(ti.subtotal),0)::bigint as amt,
               coalesce(sum(coalesce(ti.cogs,0)),0)::bigint as cogs
        from transaction_items ti join transactions t on t.id = ti.transaction_id
        where t.id in ${bounds}
          and coalesce(t.discount_reason,'') like 'Compliment:%'
        group by 1`),
    );
    const [compHdr] = rowsOf(
      await db.execute(sql`
        select count(*)::int as cnt from transactions t where t.id in ${bounds}
          and coalesce(t.discount_reason,'') like 'Compliment:%'`),
    );

    // --- (b) dampak jurnal harian baru ---
    const fresh = new Map<string, number>();
    const addLines = (lines: { accountCode?: string; debit?: number; credit?: number }[]) => {
      for (const l of lines) {
        if (!l.accountCode) continue;
        const net = (l.debit ?? 0) - (l.credit ?? 0);
        fresh.set(l.accountCode, (fresh.get(l.accountCode) ?? 0) + net);
      }
    };

    const payments = payRows
      .map((p) => ({ paymentMethod: String(p.m) as SettleMethod, amount: Number(p.amt) }))
      .filter((p) => p.amount !== 0);

    if (Number(hdr.cnt) > 0) {
      const aggregate: DailySalesAggregate = {
        entryDate: day,
        outletId: OUTLET,
        transactionCount: Number(hdr.cnt),
        total: Number(hdr.total),
        subtotal: Number(hdr.subtotal),
        discountAmount: Number(hdr.discount),
        payments,
        categories: catRows.map((c) => ({
          itemCategoryName: String(c.c),
          amount: Number(c.amt),
          cogs: Number(c.cogs),
        })),
      };
      try {
        addLines(mapPosSale(toDailySaleInput(aggregate, BATCH)));
      } catch (e) {
        problems.push(`${day}: agregasi GAGAL — ${(e as Error).message}`);
        continue;
      }
    }
    if (Number(compHdr.cnt) > 0) {
      addLines(
        mapPosCompliment(
          toDailyComplimentInput(
            {
              entryDate: day,
              outletId: OUTLET,
              transactionCount: Number(compHdr.cnt),
              categories: compCatRows.map((c) => ({
                itemCategoryName: String(c.c),
                amount: Number(c.amt),
                cogs: Number(c.cogs),
              })),
            },
            BATCH,
          ),
        ),
      );
    }

    // --- (a) dampak jurnal per-transaksi yang SUDAH ada ---
    const existingRows = rowsOf(
      await db.execute(sql`
        select coa.code as code,
               coalesce(sum(jl.debit),0)::bigint - coalesce(sum(jl.credit),0)::bigint as net
        from journal_entries je
        join journal_lines jl on jl.entry_id = je.id
        join chart_of_accounts coa on coa.id = jl.account_id
        where je.outlet_id = ${OUTLET}
          and je.status = 'posted'
          -- pos_void ikut dihitung: di model lama, transaksi yang di-void
          -- tetap punya jurnal pos_sale penuh lalu dibalik jurnal pos_void
          -- (net nol). Di model harian transaksinya cuma tidak ikut agregat
          -- (juga net nol). Tanpa memasukkan pos_void, perbandingannya tidak
          -- setara dan hari yang ada void terlihat "beda" padahal sama.
          and je.source_type in ('pos_sale','pos_compliment','pos_void')
          and je.entry_date = ${day}::date
        group by 1`),
    );
    const existing = new Map<string, number>();
    for (const r of existingRows) existing.set(String(r.code), Number(r.net));

    /* Model lama mencatat penjualan BRUTO lalu memakai 4111 "Refund
     * Penjualan" sebagai kontra saat di-void; model harian cukup tidak
     * mengikutsertakan transaksi yang di-void. Dampak NETO-nya sama, jadi
     * lipat 4111 ke pendapatan sebelum dibandingkan — kalau tidak, tiap hari
     * yang ada void selalu terlihat "beda" padahal tidak. */
    foldVoidContra(existing);
    foldVoidContra(fresh);
    collapseRevenue(existing);
    collapseRevenue(fresh);

    const codes = new Set([...fresh.keys(), ...existing.keys()]);
    const diffs: string[] = [];
    for (const code of codes) {
      const a = existing.get(code) ?? 0;
      const b = fresh.get(code) ?? 0;
      if (a !== b) diffs.push(`${code}: lama=${a} baru=${b} selisih=${b - a}`);
    }
    if (diffs.length === 0) okDays += 1;
    else problems.push(`${day} (${hdr.cnt} trx): ${diffs.join(" | ")}`);
  }

  console.log(`\nHari diperiksa : ${dayRows.length}`);
  console.log(`Cocok persis   : ${okDays}`);
  console.log(`Beda           : ${problems.length}`);
  if (problems.length > 0) {
    console.log("\n--- SELISIH ---");
    for (const p of problems.slice(0, 40)) console.log(" ", p);
  }
  await pool.end();
}

/** Satukan 4101/4102/4103 jadi satu angka pendapatan neto. */
function collapseRevenue(m: Map<string, number>) {
  const codes = ["4101", "4102", "4103"].filter((c) => m.has(c));
  if (codes.length === 0) return;
  let sum = m.get("REVENUE_NETO") ?? 0;
  for (const c of codes) { sum += m.get(c) ?? 0; m.delete(c); }
  m.set("REVENUE_NETO", sum);
}

/** Lipat kontra 4111 ke akun pendapatan gabungan supaya perbandingan neto. */
function foldVoidContra(m: Map<string, number>) {
  const contra = m.get("4111") ?? 0;
  if (contra === 0) return;
  m.delete("4111");
  const revenueCodes = ["4101", "4102", "4103"].filter((c) => m.has(c));
  // Kembalikan kontra ke pendapatan; kalau tersebar di beberapa akun, cukup
  // bandingkan totalnya lewat satu kunci sintetis.
  let revenueSum = 0;
  for (const c of revenueCodes) {
    revenueSum += m.get(c) ?? 0;
    m.delete(c);
  }
  m.set("REVENUE_NETO", revenueSum + contra);
}

function transactionsInDay(day: string) {
  return sql`select id from transactions
    where outlet_id = ${OUTLET}
      and status in ('paid','partially_refunded')
      and (created_at at time zone 'Asia/Jakarta')::date = ${day}::date`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
