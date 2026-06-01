/**
 * Sesi AE-176 — Bangun template Excel + CSV "Kelola Bahan" untuk owner isi
 * massal. Kolom = mapping modal IngredientManagerModal:
 *   IDENTITAS  : Nama, Section, Satuan Dasar, Stok Minimum (+satuan)
 *   HARGA SUPP : Supplier Utama, Satuan Beli, Harga per Satuan Beli
 *   KONVERSI   : 1 Satuan Beli = K1 jumlah × K1 ke ; 1 K1 ke = K2 jumlah × K2 ke
 *                (rantai diturunkan sampai Satuan Dasar)
 *
 * Pre-fill data SEKARANG (semua bahan atomik aktif) supaya owner mengoreksi,
 * bukan ketik dari nol. Read-only — tidak menulis ke DB.
 *
 * Jalankan: node scripts/_oneshot/build-kelola-bahan-template.cjs
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../../.env.local") });
const { Pool } = require("@neondatabase/serverless");
const XLSX = require("xlsx");

const OUT_DIR = path.join(require("os").homedir(), "Desktop");
const XLSX_PATH = path.join(OUT_DIR, "Template-Kelola-Bahan-Mahakan.xlsx");
const CSV_PATH = path.join(OUT_DIR, "Template-Kelola-Bahan-Mahakan.csv");

const SECTION_LABEL = {
  kitchen: "Kitchen",
  bar: "Bar",
  supporting: "Supporting",
  cleaning: "Cleaning",
};

/** Bulatkan ke 4 desimal, buang trailing nol. */
function num(n) {
  if (n == null || !Number.isFinite(n)) return "";
  const r = Math.round(n * 10000) / 10000;
  return r;
}

/** Rekonstruksi rantai konversi dari unit flat (qtyPerBase) → maks 2 level
 *  yang intuitif (mis. renceng→10→sachet, sachet→28→gr). Fallback flat. */
function buildChain(buy, others, baseUnit) {
  const levels = [];
  let current = buy;
  let pool = others.slice().sort((a, b) => b.qtyPerBase - a.qtyPerBase);
  let guard = 0;
  while (guard++ < 6) {
    const next = pool.find(
      (o) =>
        o.qtyPerBase < current.qtyPerBase &&
        Math.abs(current.qtyPerBase % o.qtyPerBase) < 1e-6,
    );
    if (next) {
      levels.push({ jumlah: current.qtyPerBase / next.qtyPerBase, ke: next.label });
      pool = pool.filter((x) => x !== next);
      current = next;
    } else {
      levels.push({ jumlah: current.qtyPerBase, ke: baseUnit });
      break;
    }
  }
  // Template hanya muat 2 level — kalau lebih, ratakan jadi 1 level flat.
  if (levels.length > 2) {
    return [{ jumlah: buy.qtyPerBase, ke: baseUnit }];
  }
  return levels;
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // 1. Bahan atomik (bukan preparation) aktif, belum dihapus.
  const ingRes = await pool.query(
    `SELECT id, name, section, unit, reorder_threshold::float AS rt,
            cost_per_unit::float AS cpu
       FROM ingredients
      WHERE is_preparation = false
        AND deleted_at IS NULL
        AND is_active = true
      ORDER BY lower(name)`,
  );
  const ings = ingRes.rows;
  const ingIds = ings.map((i) => i.id);

  // 2. Semua ingredient_units → map per bahan.
  const unitRes = await pool.query(
    `SELECT ingredient_id, label, qty_per_base::float AS qpb, is_default_buy
       FROM ingredient_units
      WHERE deleted_at IS NULL
        AND ingredient_id = ANY($1::uuid[])`,
    [ingIds],
  );
  const unitsByIng = new Map();
  for (const r of unitRes.rows) {
    const list = unitsByIng.get(r.ingredient_id) || [];
    list.push({ label: r.label, qtyPerBase: r.qpb, isDefaultBuy: r.is_default_buy });
    unitsByIng.set(r.ingredient_id, list);
  }

  // 3. Harga supplier UTAMA (primary) per bahan + nama supplier.
  const supRes = await pool.query(
    `SELECT si.ingredient_id, si.pack_unit, si.pack_size::float AS psize,
            si.unit_cost::float AS ucost, s.name AS supplier_name
       FROM supplier_ingredients si
       JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.deleted_at IS NULL
        AND si.is_primary = true
        AND si.ingredient_id = ANY($1::uuid[])`,
    [ingIds],
  );
  const primaryByIng = new Map();
  for (const r of supRes.rows) {
    primaryByIng.set(r.ingredient_id, {
      supplierName: r.supplier_name,
      buyUnit: r.pack_unit,
    });
  }

  // 4. Daftar supplier (referensi) + bangun baris template.
  const allSupRes = await pool.query(
    `SELECT name FROM suppliers WHERE deleted_at IS NULL ORDER BY lower(name)`,
  );
  const supplierNames = allSupRes.rows.map((r) => r.name);

  const HEADER = [
    "Nama Bahan",
    "Section",
    "Satuan Dasar",
    "Stok Minimum",
    "Satuan Stok Min",
    "Supplier Utama",
    "Satuan Beli",
    "Harga per Satuan Beli",
    "Konversi 1: Jumlah",
    "Konversi 1: Ke Satuan",
    "Konversi 2: Jumlah (opsional)",
    "Konversi 2: Ke Satuan (opsional)",
  ];

  const rows = [HEADER];
  let withBuy = 0;
  let withSupplier = 0;

  for (const ing of ings) {
    const units = unitsByIng.get(ing.id) || [];
    const prim = primaryByIng.get(ing.id);

    // Tentukan satuan beli: default-buy → primary.buyUnit → kosong.
    const defBuyUnit = units.find((u) => u.isDefaultBuy);
    let buyUnit = defBuyUnit?.label || prim?.buyUnit || "";
    // Isi satuan dasar dalam 1 satuan beli (utk hitung harga & stok min).
    const buyPerBase =
      units.find((u) => u.label.toLowerCase() === buyUnit.toLowerCase())
        ?.qtyPerBase || 1;

    // Bangun rantai konversi dari unit beli.
    let k1j = "", k1k = "", k2j = "", k2k = "";
    if (buyUnit) {
      let buy = units.find(
        (u) => u.label.toLowerCase() === buyUnit.toLowerCase(),
      );
      // Kalau unit beli = satuan dasar (mis. Pcs→Pcs) atau tak ada di units.
      if (!buy) {
        if (buyUnit.toLowerCase() === ing.unit.toLowerCase()) {
          buy = { label: buyUnit, qtyPerBase: 1 };
        } else {
          buy = { label: buyUnit, qtyPerBase: 1 };
        }
      }
      const others = units.filter((u) => u !== buy);
      const chain = buildChain(buy, others, ing.unit);
      if (chain[0]) {
        k1j = num(chain[0].jumlah);
        k1k = chain[0].ke;
      }
      if (chain[1]) {
        k2j = num(chain[1].jumlah);
        k2k = chain[1].ke;
      }
      withBuy++;
    }

    if (prim) withSupplier++;

    // Harga per 1 satuan beli = cost per dasar (kanonik) × isi-per-beli.
    // Konsisten dgn satuan beli + konversi di baris ini (hindari campur
    // konvensi pack_unit yg tidak seragam di data lama).
    let hargaBeli = "";
    if (prim && ing.cpu != null && ing.cpu > 0) {
      hargaBeli = Math.round(ing.cpu * buyPerBase);
    }

    // Stok minimum → tampil dalam satuan beli (sama dgn modal).
    let stokMin = "";
    let stokMinUnit = "";
    if (ing.rt != null) {
      stokMin = num(ing.rt / buyPerBase);
      stokMinUnit = buyUnit || ing.unit;
    }

    rows.push([
      ing.name,
      ing.section ? SECTION_LABEL[ing.section] || ing.section : "",
      ing.unit,
      stokMin,
      stokMinUnit,
      prim?.supplierName || "",
      buyUnit,
      hargaBeli,
      k1j,
      k1k,
      k2j,
      k2k,
    ]);
  }

  // ── Sheet Petunjuk ──────────────────────────────────────────────────
  const petunjuk = [
    ["TEMPLATE KELOLA BAHAN — MAHAKAN POS"],
    [""],
    ["Cara pakai:"],
    ["1. Isi / koreksi tab \"Bahan\" (sudah terisi data sekarang)."],
    ["2. Satu baris = satu bahan. Jangan ubah baris HEADER (baris 1)."],
    ["3. Setelah selesai, kirim file ini kembali untuk di-impor ke sistem."],
    [""],
    ["Penjelasan kolom (urut sesuai modal Kelola Bahan):"],
    ["Kolom", "Arti", "Contoh"],
    ["Nama Bahan", "Nama bahan — KUNCI pencocokan. Harus sama persis dgn di sistem.", "Chocolatos"],
    ["Section", "Lokasi: Kitchen / Bar / Supporting / Cleaning. Boleh kosong.", "Bar"],
    ["Satuan Dasar", "Satuan terkecil yg dipakai di resep (barista). gr/ml/Pcs/Kg/L/Btl.", "gr"],
    ["Stok Minimum", "Batas stok rendah, DALAM satuan beli. Boleh kosong.", "0.5"],
    ["Satuan Stok Min", "Satuan utk Stok Minimum (biasanya = Satuan Beli).", "renceng"],
    ["Supplier Utama", "Nama supplier utama (lihat tab Referensi). Boleh kosong.", "Pasar Cisarua"],
    ["Satuan Beli", "Satuan saat beli dari supplier.", "renceng"],
    ["Harga per Satuan Beli", "Harga utk 1 Satuan Beli (angka, tanpa Rp/titik).", "21000"],
    ["Konversi 1: Jumlah", "1 [Satuan Beli] = berapa [Konversi 1: Ke Satuan].", "10"],
    ["Konversi 1: Ke Satuan", "Satuan tujuan konversi 1. Kalau langsung ke dasar, isi Satuan Dasar.", "sachet"],
    ["Konversi 2: Jumlah", "OPSIONAL. 1 [Konversi 1: Ke] = berapa [Konversi 2: Ke].", "28"],
    ["Konversi 2: Ke Satuan", "OPSIONAL. Tujuan akhir HARUS = Satuan Dasar.", "gr"],
    [""],
    ["ATURAN PENTING:"],
    ["• Satuan tujuan konversi TERAKHIR harus = Satuan Dasar."],
    ["• Bahan sederhana (1 level): isi Konversi 1 saja, Konversi 1: Ke = Satuan Dasar."],
    ["    Contoh: Ayam Fillet — Satuan Beli=Kg, K1 Jumlah=1000, K1 Ke=gr (kosongkan K2)."],
    ["• Bahan bertingkat (mis. Chocolatos): pakai Konversi 1 + Konversi 2."],
    ["    1 renceng = 10 sachet ; 1 sachet = 28 gr  → sistem hitung 1 renceng = 280 gr."],
    ["• Harga = untuk 1 Satuan Beli (mis. 1 renceng = 21000), BUKAN per gram."],
    ["• Nama supplier harus sama persis (lihat tab Referensi). Kosongkan kalau belum ada."],
  ];

  // ── Sheet Referensi ─────────────────────────────────────────────────
  const referensi = [
    ["REFERENSI — nilai valid"],
    [""],
    ["Section yang valid:"],
    ["Kitchen"],
    ["Bar"],
    ["Supporting"],
    ["Cleaning"],
    ["(boleh dikosongkan = belum diset)"],
    [""],
    ["Satuan Dasar yang umum:"],
    ["gr", "(berat)"],
    ["ml", "(volume)"],
    ["Pcs", "(jumlah)"],
    ["Kg", "L", "Btl"],
    [""],
    ["Daftar Supplier (pakai nama persis):"],
    ...supplierNames.map((n) => [n]),
  ];

  // ── Tulis workbook ──────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsPetunjuk = XLSX.utils.aoa_to_sheet(petunjuk);
  wsPetunjuk["!cols"] = [{ wch: 26 }, { wch: 60 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsPetunjuk, "Petunjuk");

  const wsBahan = XLSX.utils.aoa_to_sheet(rows);
  wsBahan["!cols"] = [
    { wch: 26 }, // nama
    { wch: 12 }, // section
    { wch: 12 }, // satuan dasar
    { wch: 12 }, // stok min
    { wch: 14 }, // satuan stok min
    { wch: 20 }, // supplier
    { wch: 12 }, // satuan beli
    { wch: 18 }, // harga
    { wch: 16 }, // k1 jumlah
    { wch: 18 }, // k1 ke
    { wch: 20 }, // k2 jumlah
    { wch: 22 }, // k2 ke
  ];
  wsBahan["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsBahan, "Bahan");

  const wsRef = XLSX.utils.aoa_to_sheet(referensi);
  wsRef["!cols"] = [{ wch: 26 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsRef, "Referensi");

  XLSX.writeFile(wb, XLSX_PATH);

  // CSV (hanya tab Bahan).
  const csv = XLSX.utils.sheet_to_csv(wsBahan);
  fs.writeFileSync(CSV_PATH, "﻿" + csv, "utf8");

  await pool.end();

  console.log("✅ Template dibuat:");
  console.log("   XLSX:", XLSX_PATH);
  console.log("   CSV :", CSV_PATH);
  console.log(`   Bahan: ${ings.length} baris`);
  console.log(`   Punya satuan beli: ${withBuy} | Punya supplier utama: ${withSupplier}`);
})().catch((e) => {
  console.error("GAGAL:", e);
  process.exit(1);
});
