import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = DbTx | typeof db;

/**
 * Sesi AE-173 — INVENTORY MODE (periodic vs perpetual).
 *
 * Default = PERPETUAL (perilaku lama): penjualan mengurangi stok, pembelian
 * menambah stok/WAC. Owner bisa set mode PERIODIC di Pengaturan — stok HANYA
 * bergerak dari Opname (opname bln lalu = stok awal, opname bln ini = stok
 * akhir). Reversibel kapan saja tanpa nulis ulang kode.
 *
 * Aturan default-ke-perpetual: kalau flag undefined → true (perpetual). Jadi
 * outlet lama tanpa setting = perilaku persis seperti sebelumnya (no-op).
 */
export type StockMode = {
  /** true = penjualan mengurangi stok (perpetual). false = tidak (periodic). */
  deductOnSale: boolean;
  /** true = pembelian menambah stok/WAC (perpetual). false = tidak (periodic). */
  addOnPurchase: boolean;
};

export async function getStockMode(
  outletId: string,
  tx?: DbOrTx,
): Promise<StockMode> {
  const conn = tx ?? db;
  const [row] = await conn
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const settings = (row?.settings ?? null) as {
    features?: { perpetualStockSales?: boolean; perpetualStockPurchases?: boolean };
  } | null;
  const features = settings?.features;
  // undefined → true (perpetual) supaya outlet lama tak berubah perilaku.
  return {
    deductOnSale: features?.perpetualStockSales !== false,
    addOnPurchase: features?.perpetualStockPurchases !== false,
  };
}
