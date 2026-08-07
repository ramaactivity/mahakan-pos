/**
 * Sesi AE-190 — periksa 8 item PR manual yang masih menggantung: kandidat
 * master mana yang cocok, dan apakah satuan staff bisa dikonversi ke satuan
 * master (punya Konversi Pack / unit belanja atau tidak).
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

  const items = rows(
    await db.execute(sql`
      SELECT pri.id, pri.ingredient_name_snapshot AS nama, pri.unit_snapshot AS satuan,
             pri.requested_qty, pri.requested_qty_decimal, pr.id AS pr_id, pr.status
      FROM purchase_request_items pri
      JOIN purchase_requests pr ON pr.id = pri.request_id
      WHERE pri.ingredient_id IS NULL
        AND pr.deleted_at IS NULL
        AND pr.status IN ('open','partial')
        AND pri.rejected_at IS NULL
        AND COALESCE(pri.received_qty_decimal::numeric, pri.received_qty) = 0
      ORDER BY pri.ingredient_name_snapshot
    `),
  );
  console.log("\n=== 8 ITEM PR MANUAL YANG MENGGANTUNG ===");
  console.table(
    items.map((i) => ({
      id: String(i.id).slice(0, 8),
      nama: i.nama,
      satuan: i.satuan,
      qty: i.requested_qty_decimal,
    })),
  );

  // Kandidat master untuk tiap nama (cocok persis + cocok sebagian).
  for (const it of items) {
    const kand = rows(
      await db.execute(sql`
        SELECT name, unit, pack_conversions, unit_belanja, unit_belanja_per_cogs,
               current_stock
        FROM ingredients
        WHERE is_active AND deleted_at IS NULL
          AND (lower(name) = lower(${it.nama})
               OR lower(name) LIKE '%' || lower(${it.nama}) || '%'
               OR lower(${it.nama}) LIKE '%' || lower(name) || '%')
        ORDER BY name
      `),
    );
    console.log(`\n--- "${it.nama}" (${it.requested_qty_decimal} ${it.satuan})`);
    if (kand.length === 0) {
      console.log("    TIDAK ADA kandidat master");
      continue;
    }
    console.table(
      kand.map((k) => ({
        master: k.name,
        satuan_master: k.unit,
        stok: k.current_stock,
        konversi_pack: JSON.stringify(k.pack_conversions ?? []),
        unit_belanja: k.unit_belanja,
        per_cogs: k.unit_belanja_per_cogs,
      })),
    );
  }

  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
