import "server-only";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyMarketEntries, dailyMarketItems } from "@/db/schema";

/**
 * Sesi AE-257 — bahan yang dibeli lewat Daily Market, per bahan, dalam rentang
 * tanggal nota. Dibaca laporan HPP/COGS sebagai bagian dari "Pembelian".
 *
 * Sejak AE-245 rupiah bahan pasar didebit ke PERSEDIAAN dengan janji "jadi
 * biaya nanti lewat COGS/opname". Tapi rumus COGS (awal + beli − akhir) hanya
 * membaca Purchasing, jadi bahan pasar ikut terhitung di stok akhir opname
 * tanpa pernah tercatat dibeli → HPP kurang catat sebesar belanja pasar.
 *
 * `qty_master` sudah dikonversi ke satuan dasar saat disimpan (satuan yang
 * tidak dikenal ditolak di muka), jadi tidak ada baris "perlu dicek" di sini.
 * Nota yang dibatalkan (`reversed`) tidak dihitung — stok & jurnalnya sudah
 * dibalik.
 */
export async function fetchDailyMarketItemsByIngredient(
  outletId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, { qty: number; cost: number }>> {
  const rows = await db
    .select({
      ingredientId: dailyMarketItems.ingredientId,
      qtyMaster: dailyMarketItems.qtyMaster,
      subtotal: dailyMarketItems.subtotal,
    })
    .from(dailyMarketItems)
    .innerJoin(
      dailyMarketEntries,
      eq(dailyMarketEntries.id, dailyMarketItems.entryId),
    )
    .where(
      and(
        eq(dailyMarketEntries.outletId, outletId),
        eq(dailyMarketEntries.status, "posted"),
        isNull(dailyMarketEntries.deletedAt),
        gte(dailyMarketEntries.entryDate, dateFrom),
        lte(dailyMarketEntries.entryDate, dateTo),
      ),
    );

  const map = new Map<string, { qty: number; cost: number }>();
  for (const r of rows) {
    const cur = map.get(r.ingredientId) ?? { qty: 0, cost: 0 };
    cur.qty += Number(r.qtyMaster);
    cur.cost += r.subtotal;
    map.set(r.ingredientId, cur);
  }
  return map;
}

export interface KurirJournalRow {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  /** + masuk ke saldo kurir, − keluar. */
  delta: number;
  /** Akun lawan, mis. "6305 ATK & Cetak". */
  counterAccounts: string;
  receiptImageUrl: string | null;
  createdAt: string;
}

/**
 * Sesi AE-258 — jurnal lain yang menyentuh 1103 Saldo Kurir, di luar catatan
 * Daily Market & nota Pembelian (mis. pengeluaran kurir yang dicatat lewat
 * Jurnal Umum / Buku Kas). Tanpa ini layar Daily Market dan Buku Kas bisa
 * menunjukkan saldo berbeda untuk akun yang sama (kejadian 12 Okt: Rp 102rb
 * vs Rp 73,5rb setelah owner mencatat Nota/Kamper/Print lewat Jurnal Umum).
 *
 * Jurnal Daily Market (`daily_market%`) dan pembelian (`purchase%`) sengaja
 * dikecualikan: keduanya sudah diwakili baris catatan / nota Pembelian.
 * Status 'reversed' tidak dihitung — pasangan pair-void netnya nol.
 */
export async function fetchOtherKurirJournals(
  outletId: string,
): Promise<KurirJournalRow[]> {
  const res = await db.execute<{
    id: string;
    entry_number: string;
    entry_date: string;
    description: string;
    delta: string;
    counter_accounts: string | null;
    receipt_image_url: string | null;
    created_at: string;
  }>(sql`
    SELECT j.id, j.entry_number, j.entry_date::text AS entry_date, j.description,
           sum(l.debit - l.credit)::bigint AS delta,
           (SELECT string_agg(DISTINCT a2.code || ' ' || a2.name, ', ')
              FROM journal_lines l2 JOIN chart_of_accounts a2 ON a2.id = l2.account_id
             WHERE l2.entry_id = j.id AND a2.code <> '1103') AS counter_accounts,
           j.receipt_image_url, j.created_at::text AS created_at
      FROM journal_entries j
      JOIN journal_lines l ON l.entry_id = j.id
      JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE j.outlet_id = ${outletId}
       AND j.status = 'posted'
       AND a.code = '1103'
       AND j.source_type NOT LIKE 'daily_market%'
       AND j.source_type NOT LIKE 'purchase%'
     GROUP BY j.id
    HAVING sum(l.debit - l.credit) <> 0
  `);
  const rows = (res as unknown as { rows: Array<Record<string, string | null>> }).rows;
  return rows.map((r) => ({
    id: r.id!,
    entryNumber: r.entry_number!,
    entryDate: r.entry_date!,
    description: r.description ?? "",
    delta: Number(r.delta),
    counterAccounts: r.counter_accounts ?? "",
    receiptImageUrl: r.receipt_image_url ?? null,
    createdAt: new Date(r.created_at!).toISOString(),
  }));
}
