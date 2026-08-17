/**
 * Sesi AE-200 — perencana penyelarasan PENERIMAAN BARANG terhadap PO yang
 * daftar bahannya diedit setelah barang diterima.
 *
 * Latar: alur di outlet ini selalu "terima barang dulu, nota menyusul", jadi
 * SEMUA 253 pembelian di produksi sudah punya penerimaan. Akibatnya kemampuan
 * mengubah item/qty/supplier di Edit PO — yang sebetulnya sudah ada — praktis
 * tidak pernah bisa dipakai karena terkunci begitu ada penerimaan.
 *
 * Kunci itu ada karena alasan nyata: qty sudah menjelma jadi baris penerimaan,
 * pergerakan stok, dan jurnal. Membukanya berarti perubahan PO WAJIB dirambatkan
 * ke sana. Modul ini yang memutuskan rambatannya, dipisah dari aksi server
 * supaya bisa diuji tanpa DB.
 *
 * ATURAN YANG DIPAKAI: **penerimaan mengikuti PO**. Qty yang diterima disetel
 * sama dengan qty PO yang baru. Ini bukan asumsi karangan — di produksi 510
 * dari 510 baris penerimaan qty-nya SUDAH persis sama dengan qty PO-nya, dan
 * tiap pembelian punya tepat SATU penerimaan. Kalau suatu saat ada PO dengan
 * penerimaan bertahap (lebih dari satu), aturan ini jadi ambigu — pemanggil
 * WAJIB menolak kasus itu, bukan menebak.
 */

export interface MirrorPoLine {
  /** purchase_items.id setelah upsert. */
  purchaseItemId: string;
  ingredientId: string;
  /** Qty dalam satuan nota (sama dengan purchase_items.qty_decimal). */
  qtyNota: number;
  /** Qty hasil konversi ke satuan DASAR bahan — untuk pergerakan stok. */
  qtyMaster: number;
  unitCost: number;
  ingredientName: string;
  /** Satuan master bahan saat ini. */
  unitSnapshot: string;
  sectionSnapshot: string | null;
}

export interface MirrorGrLine {
  grItemId: string;
  purchaseItemId: string;
  movementId: string | null;
  /** Qty satuan-dasar yang tercatat di pergerakan stok (absolut). */
  movementQtyMaster: number;
  /** true = pergerakan ini tidak pernah mengubah `ingredients.current_stock`
   *  (mode periodic / backdated), jadi tidak ada stok yang perlu dikoreksi. */
  movementSkipped: boolean;
  ingredientId: string;
}

export type MirrorAction =
  | {
      kind: "update";
      grItemId: string;
      purchaseItemId: string;
      ingredientId: string;
      receivedQtyNota: number;
      unitCost: number;
      lineTotal: number;
      movementId: string | null;
      /** Qty satuan-dasar yang baru untuk pergerakan stok. */
      qtyMaster: number;
      /** Selisih stok yang perlu diterapkan (0 kalau pergerakan di-skip). */
      stockDelta: number;
      sectionSnapshot: string | null;
    }
  | {
      kind: "insert";
      purchaseItemId: string;
      ingredientId: string;
      receivedQtyNota: number;
      unitCost: number;
      lineTotal: number;
      qtyMaster: number;
      ingredientName: string;
      unitSnapshot: string;
      sectionSnapshot: string | null;
    }
  | {
      kind: "delete";
      grItemId: string;
      movementId: string | null;
      ingredientId: string;
      /** Stok yang perlu dikembalikan (negatif; 0 kalau pergerakan di-skip). */
      stockDelta: number;
    };

/** Pembulatan rupiah yang dipakai seluruh modul pembelian. */
function lineTotalOf(qty: number, unitCost: number): number {
  return Math.round(qty * unitCost);
}

/**
 * Susun daftar perubahan agar baris penerimaan mencerminkan PO yang baru.
 *
 * `stockDelta` hanya terisi untuk pergerakan yang MEMANG pernah mengubah stok
 * (`movementSkipped === false`). Di mode periodic — yang sedang aktif — semua
 * pergerakan pembelian ber-skip, jadi delta selalu 0 dan stok fisik tetap hanya
 * dari opname. Perhitungan ini ada untuk pembelian era lama yang pergerakannya
 * tidak ber-skip, supaya mengedit PO lama tidak meninggalkan stok melenceng.
 */
export function planGrMirror(
  poLines: MirrorPoLine[],
  grLines: MirrorGrLine[],
): MirrorAction[] {
  const grByPurchaseItem = new Map<string, MirrorGrLine>();
  for (const g of grLines) grByPurchaseItem.set(g.purchaseItemId, g);

  const actions: MirrorAction[] = [];
  const seen = new Set<string>();

  for (const po of poLines) {
    const existing = grByPurchaseItem.get(po.purchaseItemId);
    const lineTotal = lineTotalOf(po.qtyNota, po.unitCost);

    if (!existing) {
      actions.push({
        kind: "insert",
        purchaseItemId: po.purchaseItemId,
        ingredientId: po.ingredientId,
        receivedQtyNota: po.qtyNota,
        unitCost: po.unitCost,
        lineTotal,
        qtyMaster: po.qtyMaster,
        ingredientName: po.ingredientName,
        unitSnapshot: po.unitSnapshot,
        sectionSnapshot: po.sectionSnapshot,
      });
      continue;
    }

    seen.add(existing.grItemId);
    actions.push({
      kind: "update",
      grItemId: existing.grItemId,
      purchaseItemId: po.purchaseItemId,
      ingredientId: po.ingredientId,
      receivedQtyNota: po.qtyNota,
      unitCost: po.unitCost,
      lineTotal,
      movementId: existing.movementId,
      qtyMaster: po.qtyMaster,
      stockDelta: existing.movementSkipped
        ? 0
        : po.qtyMaster - existing.movementQtyMaster,
      sectionSnapshot: po.sectionSnapshot,
    });
  }

  for (const g of grLines) {
    if (seen.has(g.grItemId)) continue;
    actions.push({
      kind: "delete",
      grItemId: g.grItemId,
      movementId: g.movementId,
      ingredientId: g.ingredientId,
      stockDelta: g.movementSkipped ? 0 : -g.movementQtyMaster,
    });
  }

  return actions;
}

/** Total nilai penerimaan setelah rambatan — dipakai untuk header GR + jurnal. */
export function mirrorReceiptTotal(actions: MirrorAction[]): number {
  return actions.reduce(
    (sum, a) => (a.kind === "delete" ? sum : sum + a.lineTotal),
    0,
  );
}

/** Nilai per seksi persediaan — menentukan akun mana yang di-debit di jurnal. */
export function mirrorSectionLines(
  actions: MirrorAction[],
): Array<{ section: string | null; amount: number }> {
  const bySection = new Map<string | null, number>();
  for (const a of actions) {
    if (a.kind === "delete") continue;
    const key = a.sectionSnapshot ?? null;
    bySection.set(key, (bySection.get(key) ?? 0) + a.lineTotal);
  }
  return Array.from(bySection.entries())
    .filter(([, amount]) => amount !== 0)
    .map(([section, amount]) => ({ section, amount }));
}
