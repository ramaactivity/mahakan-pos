import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
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
