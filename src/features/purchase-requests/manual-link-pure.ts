/**
 * Sesi AE-190 — pure helper: menautkan item PR yang diketik MANUAL oleh staff
 * ke master bahan berdasarkan nama.
 *
 * Latar: selama modul PO staff cuma menampilkan bahan low-stock, ~60% master
 * tidak pernah bisa ditemukan lewat pencarian sehingga staff mengetik namanya
 * sendiri. Item manual tidak punya `ingredient_id` → tidak dapat saran
 * supplier/harga saat Tarik ke Pembelian dan stoknya tidak bergerak saat GR.
 * Pencarian penuh sudah memperbaiki penyebabnya; fungsi ini jaring pengaman
 * untuk selisih ejaan/kapital yang tersisa.
 *
 * ATURAN AMAN (sengaja konservatif — lebih baik tetap manual daripada salah
 * catat):
 *   1. Nama harus cocok PERSIS setelah trim + lowercase. Tidak ada fuzzy.
 *   2. Kalau ada >1 master dengan nama sama, dianggap ambigu → jangan tebak.
 *   3. Qty wajib bisa dikonversi ke satuan master. Staff tulis "Susu Omela
 *      3 Karton" sementara master-nya ml dan konversi Karton belum di-set →
 *      BATAL menaut, biar owner yang putuskan (daripada mencatat 3 ml).
 *
 * No DB / framework deps — testable isolation.
 */

export interface ManualLinkCandidate {
  id: string;
  name: string;
  /** Satuan master/COGS (basis konversi). */
  unit: string;
  packConversions: Array<{ unitLabel: string; qtyPerBase: number }>;
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
}

export interface ManualLinkResult {
  id: string;
  name: string;
  unit: string;
  /** Qty yang SUDAH dikonversi ke satuan master. */
  qtyMaster: number;
}

/** Dependency konversi satuan — di-inject supaya helper ini tetap murni. */
export interface ManualLinkUnitDeps {
  displayUnit: (u: string | null | undefined) => string;
  convertQtyWithIngredientPacks: (
    qty: number,
    fromUnit: string,
    masterUnit: string,
    packs: Array<{ unitLabel: string; qtyPerBase: number }>,
  ) => { ok: boolean; qtyMaster: number | null };
  mergePackConversions: (
    primary: Array<{ unitLabel: string; qtyPerBase: number }>,
    fallback: Array<{ unitLabel: string; qtyPerBase: number }>,
  ) => Array<{ unitLabel: string; qtyPerBase: number }>;
}

/**
 * Index master bahan berdasarkan nama ter-normalisasi. Nama duplikat dipetakan
 * ke `null` supaya dianggap ambigu (aturan 2).
 */
export function indexMasterByName(
  master: ManualLinkCandidate[],
): Map<string, ManualLinkCandidate | null> {
  const byName = new Map<string, ManualLinkCandidate | null>();
  for (const ing of master) {
    const key = ing.name.trim().toLowerCase();
    byName.set(key, byName.has(key) ? null : ing);
  }
  return byName;
}

/**
 * Cocokkan satu item manual. Mengembalikan `null` kalau tidak boleh ditaut
 * (tidak ketemu / ambigu / qty tidak bisa dikonversi).
 */
export function matchManualItemToMaster(
  item: { name: string; unit: string; qty: number },
  byName: Map<string, ManualLinkCandidate | null>,
  deps: ManualLinkUnitDeps,
): ManualLinkResult | null {
  const key = item.name.trim().toLowerCase();
  if (!key) return null;
  const found = byName.get(key);
  if (!found) return null; // tidak ketemu, atau ambigu (null)

  const masterUnit = deps.displayUnit(found.unit);
  const chosenUnit = deps.displayUnit(item.unit);
  let qtyMaster = item.qty;

  if (chosenUnit && masterUnit && chosenUnit !== masterUnit) {
    const packs = deps.mergePackConversions(
      found.packConversions,
      found.unitBelanja && found.unitBelanjaPerCogs
        ? [
            {
              unitLabel: found.unitBelanja,
              qtyPerBase: parseFloat(found.unitBelanjaPerCogs),
            },
          ]
        : [],
    );
    const conv = deps.convertQtyWithIngredientPacks(
      item.qty,
      chosenUnit,
      masterUnit,
      packs,
    );
    if (!conv.ok || conv.qtyMaster === null || conv.qtyMaster <= 0) return null;
    qtyMaster = conv.qtyMaster;
  }

  return { id: found.id, name: found.name, unit: found.unit, qtyMaster };
}
