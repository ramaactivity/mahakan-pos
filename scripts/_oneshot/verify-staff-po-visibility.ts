/**
 * Sesi AE-190 — verifikasi SESUDAH fix: mensimulasikan query
 * `fetchRequestableIngredients()` yang baru dan mengecek bahwa bahan yang
 * dulu tidak bisa ditemukan staff (Oreo, Regal, Nugget 500gr, …) sekarang
 * ikut terjaring pencarian.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const rows = (r: any) => ((r as any).rows ?? r) as any[];

  // Query baru: SEMUA bahan aktif, low-stock cuma jadi penanda.
  const all = rows(
    await db.execute(sql`
      SELECT name, unit, current_stock, reorder_threshold,
             (reorder_threshold IS NOT NULL AND current_stock <= reorder_threshold) AS is_low_stock
      FROM ingredients
      WHERE is_active = true AND deleted_at IS NULL
      ORDER BY name
    `),
  );

  const lama = all.filter((r) => r.is_low_stock).length;
  console.log("\n=== SEBELUM vs SESUDAH ===");
  console.table([
    {
      bisa_dicari_staff_SEBELUM: lama,
      bisa_dicari_staff_SESUDAH: all.length,
      tambahan: all.length - lama,
    },
  ]);

  const cari = ["Oreo", "Regal", "Nugget", "Mclewis", "Cinnamon", "Oregano"];
  console.log("\n=== BAHAN YANG DULU HILANG DARI PENCARIAN ===");
  console.table(
    cari.map((q) => {
      const hits = all.filter((r) =>
        String(r.name).toLowerCase().includes(q.toLowerCase()),
      );
      return {
        ketik: q,
        hasil_SEBELUM: hits.filter((h) => h.is_low_stock).length,
        hasil_SESUDAH: hits.length,
        nama: hits.map((h) => h.name).join(", ") || "(tidak ada di master)",
      };
    }),
  );

  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
