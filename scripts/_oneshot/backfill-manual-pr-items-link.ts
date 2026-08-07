/**
 * Sesi AE-190 — tautkan 8 item PR manual yang masih menggantung ke master
 * bahan, supaya konsisten di semua modul (PR → Tarik ke Pembelian → PO → GR →
 * stok → COGS).
 *
 * Item-item ini lahir dari bug modul PO staff: pencariannya cuma menjangkau
 * bahan low-stock, jadi staff terpaksa mengetik nama sendiri dan PR-nya lepas
 * dari master. Penyebabnya sudah diperbaiki; ini menambal data yang terlanjur.
 *
 * Padanan + konversi satuan sudah DIKONFIRMASI owner (Rama, 2026-08-07) untuk
 * tiga item yang ambigu: Gulaku → Sugar Stick Gulaku 2 Pack, Saus Mclewis →
 * Saos Cabai Mclewis 2 pouch @1kg, Ice Cream Vanilla → Ice Cream 2 pail.
 *
 * Jalankan:  npx tsx scripts/_oneshot/backfill-manual-pr-items-link.ts
 *   (dry-run; tambahkan --apply untuk benar-benar menulis)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

/** Padanan final. `qtyMaster` sudah dalam SATUAN MASTER. */
const MAPPING: Array<{
  prItemIdPrefix: string;
  namaLama: string;
  satuanLama: string;
  qtyLama: number;
  masterName: string;
  qtyMaster: number;
  alasan: string;
}> = [
  {
    prItemIdPrefix: "ace5dc39",
    namaLama: "Cup 12 Oz",
    satuanLama: "Pcs",
    qtyLama: 1000,
    masterName: "Cup 12 Oz",
    qtyMaster: 1000,
    alasan: "nama & satuan sama persis",
  },
  {
    prItemIdPrefix: "22cb7fd8",
    namaLama: "Gulaku",
    satuanLama: "Pcs",
    qtyLama: 2,
    masterName: "Sugar Stick Gulaku",
    qtyMaster: 250,
    alasan: "konfirmasi owner: 2 Pack x 125 Pcs",
  },
  {
    prItemIdPrefix: "ba18dcd5",
    namaLama: "Ice Cream Vanilla",
    satuanLama: "pail",
    qtyLama: 2,
    masterName: "Ice Cream",
    qtyMaster: 16000,
    alasan: "konfirmasi owner: 2 pail x 8.000 gr",
  },
  {
    prItemIdPrefix: "90c4e844",
    namaLama: "Nugget",
    satuanLama: "Pack",
    qtyLama: 1,
    masterName: "Nugget 500gr",
    qtyMaster: 20,
    alasan: "konversi pack master: 1 Pack = 20 Pcs",
  },
  {
    prItemIdPrefix: "9826a545",
    namaLama: "Regal",
    satuanLama: "Pcs",
    qtyLama: 2,
    masterName: "Regal",
    qtyMaster: 2,
    alasan: "nama & satuan sama persis",
  },
  {
    prItemIdPrefix: "088a1124",
    namaLama: "Regal",
    satuanLama: "Pack",
    qtyLama: 2,
    masterName: "Regal",
    qtyMaster: 64,
    alasan: "konversi pack master: 2 Pack x 32 Pcs",
  },
  {
    prItemIdPrefix: "83d62f30",
    namaLama: "Saus Mclewis",
    satuanLama: "Pcs",
    qtyLama: 2,
    masterName: "Saos Cabai Mclewis",
    qtyMaster: 2000,
    alasan: "konfirmasi owner: 2 pouch @ 1 Kg = 2.000 gr",
  },
  {
    prItemIdPrefix: "eb9abe73",
    namaLama: "Susu Omela",
    satuanLama: "Karton",
    qtyLama: 3,
    masterName: "Susu Omela",
    qtyMaster: 3000,
    alasan: "konversi pack master: 3 Karton x 1.000 ml",
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const rows = (r: any) => ((r as any).rows ?? r) as any[];

  console.log(
    APPLY ? "\n### MODE: APPLY (menulis ke DB)" : "\n### MODE: DRY-RUN",
  );

  const rencana: any[] = [];
  const masalah: string[] = [];

  for (const m of MAPPING) {
    const item = rows(
      await db.execute(sql`
        SELECT pri.id, pri.ingredient_id, pri.ingredient_name_snapshot AS nama,
               pri.unit_snapshot AS satuan, pri.requested_qty_decimal AS qty,
               COALESCE(pri.received_qty_decimal::numeric, pri.received_qty) AS diterima,
               pri.rejected_at, pr.status, pr.outlet_id
        FROM purchase_request_items pri
        JOIN purchase_requests pr ON pr.id = pri.request_id
        WHERE pri.id::text LIKE ${m.prItemIdPrefix + "%"}
      `),
    );
    if (item.length !== 1) {
      masalah.push(`${m.prItemIdPrefix}: ketemu ${item.length} baris (harus 1)`);
      continue;
    }
    const it = item[0];

    // Pagar keamanan — jangan sentuh yang sudah berubah sejak diagnosa.
    if (it.ingredient_id !== null) {
      masalah.push(`${m.prItemIdPrefix} (${it.nama}): sudah tertaut, dilewati`);
      continue;
    }
    if (Number(it.diterima) !== 0) {
      masalah.push(`${m.prItemIdPrefix} (${it.nama}): sudah ada penerimaan, dilewati`);
      continue;
    }
    if (it.rejected_at !== null) {
      masalah.push(`${m.prItemIdPrefix} (${it.nama}): sudah ditolak, dilewati`);
      continue;
    }
    if (String(it.nama).trim() !== m.namaLama) {
      masalah.push(
        `${m.prItemIdPrefix}: nama berubah ("${it.nama}" != "${m.namaLama}"), dilewati`,
      );
      continue;
    }

    const master = rows(
      await db.execute(sql`
        SELECT id, name, unit FROM ingredients
        WHERE outlet_id = ${it.outlet_id} AND is_active AND deleted_at IS NULL
          AND lower(trim(name)) = lower(trim(${m.masterName}))
      `),
    );
    if (master.length !== 1) {
      masalah.push(
        `${m.prItemIdPrefix}: master "${m.masterName}" ketemu ${master.length} baris (harus 1)`,
      );
      continue;
    }
    const ms = master[0];

    rencana.push({
      item: `${it.nama} ${it.qty} ${it.satuan}`,
      jadi: `${ms.name} ${m.qtyMaster} ${ms.unit}`,
      alasan: m.alasan,
      _id: it.id,
      _ingredientId: ms.id,
      _name: ms.name,
      _unit: ms.unit,
      _qty: m.qtyMaster,
    });
  }

  console.log("\n=== RENCANA PERUBAHAN ===");
  console.table(
    rencana.map((r) => ({ item: r.item, jadi: r.jadi, alasan: r.alasan })),
  );
  if (masalah.length > 0) {
    console.log("\n=== DILEWATI / PERLU PERHATIAN ===");
    for (const p of masalah) console.log("  - " + p);
  }

  if (!APPLY) {
    console.log(
      `\n(dry-run) ${rencana.length} baris siap ditulis. Jalankan ulang dengan --apply.`,
    );
    await pool.end();
    return;
  }

  for (const r of rencana) {
    // bigint mirror pakai aturan yang sama dgn createPurchaseRequest:
    // max(1, floor(qty)) — decimal mirror tetap sumber kebenaran.
    const qtyBigint = Math.max(1, Math.floor(r._qty));
    await db.execute(sql`
      UPDATE purchase_request_items
      SET ingredient_id = ${r._ingredientId},
          ingredient_name_snapshot = ${r._name},
          unit_snapshot = ${r._unit},
          requested_qty = ${qtyBigint},
          requested_qty_decimal = ${r._qty.toFixed(4)}
      WHERE id = ${r._id} AND ingredient_id IS NULL
    `);
  }
  console.log(`\n✅ ${rencana.length} item PR ditautkan ke master.`);

  const sisa = rows(
    await db.execute(sql`
      SELECT count(*)::int AS n FROM purchase_request_items pri
      JOIN purchase_requests pr ON pr.id = pri.request_id
      WHERE pri.ingredient_id IS NULL AND pr.deleted_at IS NULL
        AND pr.status IN ('open','partial') AND pri.rejected_at IS NULL
        AND COALESCE(pri.received_qty_decimal::numeric, pri.received_qty) = 0
    `),
  );
  console.log(`Sisa item manual menggantung: ${sisa[0].n}`);

  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
