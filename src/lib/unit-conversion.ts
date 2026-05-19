/**
 * Sesi AE-20 — unit conversion helper untuk stock opname + future modules.
 *
 * Owner feedback: staff sering hitung pakai timbangan kg padahal master
 * unit gr → manual ×1000 di kepala = error-prone. Sekarang staff pilih
 * unit yang dia pakai, system auto-convert ke unit master.
 *
 * Model: 3 dimensi (mass / volume / count). Unit di luar dimensi (Btl,
 * Pcs, Pak, Bks, Krat, Karton, dll) tidak dikonversi — staff harus
 * input pakai unit master persis. Dimensi yang sama dikonversi via
 * factor ke base unit (gr / ml / pcs).
 */

export type UnitDimension = "mass" | "volume" | "count" | "discrete";

export interface UnitMeta {
  /** Display label (case-sensitive). */
  label: string;
  /** Dimensi fisik. "discrete" = no conversion (each unit unique). */
  dimension: UnitDimension;
  /** Factor ke base unit dalam dimensi yang sama.
   *  - mass base = gr
   *  - volume base = ml
   *  - count base = pcs
   *  - discrete = N/A (1) */
  toBase: number;
}

const UNIT_TABLE: Record<string, UnitMeta> = {
  // Mass
  Kg: { label: "Kg", dimension: "mass", toBase: 1000 },
  kg: { label: "Kg", dimension: "mass", toBase: 1000 },
  gr: { label: "gr", dimension: "mass", toBase: 1 },
  Gr: { label: "gr", dimension: "mass", toBase: 1 },
  g: { label: "gr", dimension: "mass", toBase: 1 },
  // Volume
  L: { label: "L", dimension: "volume", toBase: 1000 },
  l: { label: "L", dimension: "volume", toBase: 1000 },
  Liter: { label: "L", dimension: "volume", toBase: 1000 },
  ml: { label: "ml", dimension: "volume", toBase: 1 },
  ML: { label: "ml", dimension: "volume", toBase: 1 },
  // Count
  Lusin: { label: "Lusin", dimension: "count", toBase: 12 },
  Pcs: { label: "Pcs", dimension: "count", toBase: 1 },
  pcs: { label: "Pcs", dimension: "count", toBase: 1 },
  // Discrete (no conversion)
  Btl: { label: "Btl", dimension: "discrete", toBase: 1 },
  Pack: { label: "Pack", dimension: "discrete", toBase: 1 },
  Packs: { label: "Packs", dimension: "discrete", toBase: 1 },
  Bks: { label: "Bks", dimension: "discrete", toBase: 1 },
  Krat: { label: "Krat", dimension: "discrete", toBase: 1 },
  Karton: { label: "Karton", dimension: "discrete", toBase: 1 },
  Sdm: { label: "Sdm", dimension: "discrete", toBase: 1 },
  Sdt: { label: "Sdt", dimension: "discrete", toBase: 1 },
  Box: { label: "Box", dimension: "discrete", toBase: 1 },
};

/** Resolve unit string ke meta — case-tolerant for common typos. */
export function resolveUnit(unit: string | null | undefined): UnitMeta | null {
  if (!unit) return null;
  const direct = UNIT_TABLE[unit];
  if (direct) return direct;
  // Try case-insensitive lookup
  const lc = unit.toLowerCase();
  for (const key of Object.keys(UNIT_TABLE)) {
    if (key.toLowerCase() === lc) return UNIT_TABLE[key]!;
  }
  return null;
}

/** Convert qty `from` unit `to` unit. Returns null kalau dimensi beda
 *  atau salah satu unit unknown / discrete. */
export function convertQty(
  qty: number,
  fromUnit: string,
  toUnit: string,
): number | null {
  if (fromUnit === toUnit) return qty;
  const from = resolveUnit(fromUnit);
  const to = resolveUnit(toUnit);
  if (!from || !to) return null;
  if (from.dimension !== to.dimension) return null;
  if (from.dimension === "discrete") return null;
  const base = qty * from.toBase;
  return base / to.toBase;
}

/**
 * Sesi AE-63 phase6 — pure helper untuk auto-scale harga saat user ganti
 * unit dropdown di Catat Pembelian form.
 *
 * Use case: user input Rp 10.000 dengan unit "Kg", lalu ganti ke "gr".
 * Equivalent: Rp 10/gr (10.000 / 1000). Atau sebaliknya: Rp 10/gr → Rp
 * 10.000/Kg saat user ganti ke Kg.
 *
 * Rule: kalau 1 newUnit = X oldUnit (mis. 1 Kg = 1000 gr), maka harga
 * per newUnit = harga per oldUnit × X.
 *
 * Returns null kalau:
 *  - unit lama atau baru kosong
 *  - sama unit (no change)
 *  - convertQty fails (cross-dimension atau discrete unit)
 *  - cost ≤ 0
 *
 * Caller responsibility: round result kalau perlu integer storage.
 */
export function scaleCostOnUnitChange(args: {
  oldUnit: string;
  newUnit: string;
  oldCost: number;
}): number | null {
  if (!args.oldUnit || !args.newUnit) return null;
  if (args.oldUnit === args.newUnit) return null;
  if (!Number.isFinite(args.oldCost) || args.oldCost <= 0) return null;
  const xPerNewInOld = convertQty(1, args.newUnit, args.oldUnit);
  if (xPerNewInOld === null || xPerNewInOld <= 0) return null;
  return args.oldCost * xPerNewInOld;
}

/** List unit options yang compatible dengan master unit (sama dimensi).
 *  Dipakai di Stock Opname picker biar staff cuma lihat unit relevan.
 *
 *  Sesi AE-62y — accept optional `ingredientPacks` untuk include ingredient-
 *  scoped pack alternatives (mis. "packs" untuk Lychee Kaleng master pcs).
 *  Master + same-dimension entries dari UNIT_TABLE + pack alternatives
 *  merged dengan dedup by label. */
export function compatibleUnitsFor(
  masterUnit: string,
  ingredientPacks?: IngredientPackConversion[] | null,
): Array<{ value: string; label: string }> {
  const master = resolveUnit(masterUnit);
  const items: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();

  if (!master) {
    items.push({ value: masterUnit, label: masterUnit });
    seen.add(masterUnit.toLowerCase());
  } else if (master.dimension === "discrete") {
    items.push({ value: master.label, label: master.label });
    seen.add(master.label.toLowerCase());
  } else {
    for (const meta of Object.values(UNIT_TABLE)) {
      if (meta.dimension !== master.dimension) continue;
      const lc = meta.label.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      items.push({ value: meta.label, label: meta.label });
    }
  }

  /* Sesi AE-62y — merge ingredient-scoped pack conversions. Filter out
   * duplicate label (case-insensitive) supaya tidak conflict dengan
   * master / same-dimension entries. */
  if (ingredientPacks && ingredientPacks.length > 0) {
    for (const p of ingredientPacks) {
      const lc = p.unitLabel.trim().toLowerCase();
      if (lc.length === 0 || seen.has(lc)) continue;
      seen.add(lc);
      items.push({ value: p.unitLabel, label: p.unitLabel });
    }
  }
  return items;
}

/**
 * Sesi AE-62y — pack conversion ingredient-scoped.
 *
 * Stored di `ingredients.pack_conversions` (jsonb array). Punya semantic
 * "1 unitLabel = qtyPerBase × masterUnit". Mis. Lychee Kaleng master pcs:
 *   { unitLabel: "packs", qtyPerBase: 20 } → 1 packs = 20 pcs.
 *
 * Berbeda dengan PackInfo (supplier-scoped, Market List). Pack conversion
 * ini global per-ingredient, dipakai di Opname, Edit Inventory, dst.
 */
export interface IngredientPackConversion {
  unitLabel: string;
  qtyPerBase: number;
}

/**
 * Sesi AE-62y — convert qty pakai ingredient pack conversions sebagai
 * fallback. Logic:
 *   1. fromUnit === masterUnit → no-op (qty as-is).
 *   2. convertQty(qty, fromUnit, masterUnit) berhasil (same dimension) → pakai itu.
 *   3. Cari ingredientPacks dengan unitLabel matching fromUnit (case-insensitive).
 *      Kalau ada → qty × qtyPerBase = master qty.
 *   4. Else → null (unknown conversion).
 *
 * Returns { ok: true; qtyMaster; mode } atau { ok: false; reason }.
 */
export type IngredientConvertMode =
  | "noop"
  | "same-dimension"
  | "ingredient-pack";

export interface IngredientConvertResult {
  ok: boolean;
  qtyMaster: number | null;
  mode: IngredientConvertMode | null;
  /** Audit/UI string: "1 packs = 20 pcs (Lychee Kaleng)". */
  explain: string | null;
}

export function convertQtyWithIngredientPacks(
  qty: number,
  fromUnit: string,
  masterUnit: string,
  ingredientPacks?: IngredientPackConversion[] | null,
): IngredientConvertResult {
  if (!Number.isFinite(qty)) {
    return { ok: false, qtyMaster: null, mode: null, explain: null };
  }
  if (fromUnit === masterUnit) {
    return { ok: true, qtyMaster: qty, mode: "noop", explain: null };
  }
  // Try same-dimension via UNIT_TABLE first (Kg→gr, L→ml, dst).
  const sameDim = convertQty(qty, fromUnit, masterUnit);
  if (sameDim !== null) {
    return {
      ok: true,
      qtyMaster: sameDim,
      mode: "same-dimension",
      explain: `${qty} ${fromUnit} = ${sameDim} ${masterUnit}`,
    };
  }
  // Try ingredient pack conversions (case-insensitive label match).
  const lc = fromUnit.trim().toLowerCase();
  const pack = ingredientPacks?.find(
    (p) => p.unitLabel.trim().toLowerCase() === lc,
  );
  if (pack && Number.isFinite(pack.qtyPerBase) && pack.qtyPerBase > 0) {
    const qtyMaster = qty * pack.qtyPerBase;
    return {
      ok: true,
      qtyMaster,
      mode: "ingredient-pack",
      explain: `${qty} ${pack.unitLabel} × ${pack.qtyPerBase} = ${qtyMaster} ${masterUnit}`,
    };
  }
  return { ok: false, qtyMaster: null, mode: null, explain: null };
}

/**
 * Sesi AE-43 — Pack info dari Market List untuk handle conversion
 * discrete → continuous (mis. "1 Pack = 1000 gr").
 *
 * Setiap supplier_ingredient row punya packSize + packUnit yang bilang
 * "berapa qty satu pack". Kalau pack-nya continuous (Kg/L/gr/ml) dan
 * master continuous juga, kita bisa chain convert.
 */
export interface PackInfo {
  /** Qty per 1 pack, dalam packUnit (mis. 1000 untuk "1 Pack = 1000 gr"). */
  packSize: number;
  /** Unit dari packSize (mis. "gr" untuk "1 Pack = 1000 gr"). */
  packUnit: string;
}

export type PurchaseConvertError =
  | "DIMENSION_MISMATCH"
  | "PACK_UNKNOWN"
  | "UNKNOWN_UNIT"
  | "INVALID_QTY";

export type PurchaseConvertResult =
  | {
      ok: true;
      /** Qty dalam master unit, siap simpan ke inventory_movements. */
      qtyMaster: number;
      /** qtyMaster / qty input — untuk scale cost (`unitCost / costFactor`). */
      costFactor: number;
      /** Bagaimana conversion di-resolve, untuk audit log + UI badge. */
      mode: "noop" | "same-dimension" | "via-pack";
      /** Pesan ringkas untuk preview di UI (mis. "via Market List: 1 Pack = 1000 gr"). */
      explain?: string;
    }
  | { ok: false; error: PurchaseConvertError; message: string };

/**
 * Sesi AE-43 — convert qty + cost dari satuan input staff ke satuan
 * master ingredient. Reuse `convertQty()` + tambah jalur pack-info
 * lookup untuk discrete↔continuous (Pack/Box → gr/ml).
 *
 * Pakai di `createPurchase` server action sebelum tulis ke
 * `inventory_movements.qty_delta_decimal` + `ingredients.cost_per_unit`.
 * Juga dipakai di UI form untuk live preview.
 *
 * Logic:
 *   1. fromUnit kosong / sama master → no-op
 *   2. resolveUnit gagal salah satu → UNKNOWN_UNIT
 *   3. Dimensi sama (mass↔mass, volume↔volume, count↔count) → convertQty()
 *   4. Discrete → continuous (Pack/Btl/Karton → gr/ml/Pcs): butuh pack.
 *      Chain: qty pack × pack.packSize × convertQty(pack.packUnit → master).
 *   5. Discrete → discrete beda label (Karton → Box): butuh pack.
 *      Asumsi pack.packUnit memang master (mis. "1 Karton = 6 Box").
 *   6. Continuous → discrete master (gr → Pack): tidak didukung —
 *      DIMENSION_MISMATCH. (Edge case langka; owner bisa adjust master.)
 *   7. Dimensi beda total tanpa pack → DIMENSION_MISMATCH.
 */
export function convertPurchaseQty(input: {
  qty: number;
  fromUnit: string | null | undefined;
  masterUnit: string;
  pack?: PackInfo | null;
  /** Sesi AE-62af — ingredient-scoped pack alternatives (mis. "packs"
   * untuk Lychee Kaleng master pcs). Fallback kalau market-list pack
   * tidak ada / tidak match label. */
  ingredientPacks?: IngredientPackConversion[] | null;
}): PurchaseConvertResult {
  const { qty, fromUnit, masterUnit, pack, ingredientPacks } = input;

  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      ok: false,
      error: "INVALID_QTY",
      message: "Qty harus angka > 0",
    };
  }

  // 1. No-op path: fromUnit kosong atau resolve ke label sama master.
  const fromLabel = resolveUnit(fromUnit ?? null)?.label ?? null;
  const masterLabel = resolveUnit(masterUnit)?.label ?? masterUnit;
  if (!fromUnit || fromLabel === masterLabel) {
    return {
      ok: true,
      qtyMaster: qty,
      costFactor: 1,
      mode: "noop",
    };
  }

  const fromMeta = resolveUnit(fromUnit);
  const masterMeta = resolveUnit(masterUnit);
  if (!fromMeta) {
    return {
      ok: false,
      error: "UNKNOWN_UNIT",
      message: `Unit "${fromUnit}" tidak dikenali sistem`,
    };
  }
  if (!masterMeta) {
    return {
      ok: false,
      error: "UNKNOWN_UNIT",
      message: `Master unit "${masterUnit}" tidak dikenali sistem`,
    };
  }

  // 3. Dimensi sama (mass↔mass, volume↔volume, count↔count).
  if (
    fromMeta.dimension === masterMeta.dimension &&
    fromMeta.dimension !== "discrete"
  ) {
    const converted = convertQty(qty, fromUnit, masterUnit);
    if (converted === null) {
      // Should not happen kalau dimensi sama non-discrete, defensive.
      return {
        ok: false,
        error: "DIMENSION_MISMATCH",
        message: `Tidak bisa convert ${fromUnit} ke ${masterUnit}`,
      };
    }
    return {
      ok: true,
      qtyMaster: converted,
      costFactor: converted / qty,
      mode: "same-dimension",
      explain: `${qty} ${fromMeta.label} = ${converted} ${masterMeta.label}`,
    };
  }

  // 4-5. Discrete dari fromUnit → butuh pack info untuk derive master qty.
  //   Asumsi: pack.packSize × pack.packUnit ekuivalen 1 unit fromUnit.
  //   Mis. fromUnit="Pack", pack={packSize:1000, packUnit:"gr"}
  //     → 1 Pack = 1000 gr → qty Pack × 1000 gr = qtyMaster (kalau master gr)
  if (fromMeta.dimension === "discrete") {
    /* Sesi AE-62af — coba ingredient-scoped packs dulu (lebih spesifik),
     * fallback ke supplier pack info kalau ada. Match case-insensitive
     * pada unitLabel — kalau owner set "packs" + staff pilih "Packs" → match. */
    if (ingredientPacks && ingredientPacks.length > 0) {
      const fromLc = (fromUnit ?? "").trim().toLowerCase();
      const matched = ingredientPacks.find(
        (p) => p.unitLabel.trim().toLowerCase() === fromLc,
      );
      if (matched && Number.isFinite(matched.qtyPerBase) && matched.qtyPerBase > 0) {
        const qtyMaster = qty * matched.qtyPerBase;
        return {
          ok: true,
          qtyMaster,
          costFactor: qtyMaster / qty,
          mode: "via-pack",
          explain: `via Konversi Pack bahan: 1 ${matched.unitLabel} = ${matched.qtyPerBase} ${masterMeta.label}`,
        };
      }
    }
    if (!pack) {
      return {
        ok: false,
        error: "PACK_UNKNOWN",
        message: `Sistem belum tahu 1 ${fromUnit} = berapa ${masterUnit}. Set di Edit Satuan Bahan → Konversi Pack, atau pilih supplier dengan Market List entry.`,
      };
    }
    // Convert pack.packUnit → masterUnit. Kalau pack.packUnit === fromUnit
    // (pack entry pakai unit yg sama dengan input staff — mis. master gr,
    // staff "Pack", pack entry "1 Pack = 1000 gr"), lewat. Kalau pack.packUnit
    // adalah master langsung (gr / ml / Pcs), convertQty no-op.
    const packUnitToMaster = convertQty(
      pack.packSize,
      pack.packUnit,
      masterUnit,
    );
    if (packUnitToMaster === null) {
      return {
        ok: false,
        error: "PACK_UNKNOWN",
        message: `Pack di Market List set ke ${pack.packSize} ${pack.packUnit}, tapi tidak compatible dengan master ${masterUnit}. Owner: perbaiki Market List atau master bahan.`,
      };
    }
    const qtyMaster = qty * packUnitToMaster;
    return {
      ok: true,
      qtyMaster,
      costFactor: qtyMaster / qty,
      mode: "via-pack",
      explain: `via Market List: 1 ${fromMeta.label} = ${pack.packSize} ${pack.packUnit} = ${packUnitToMaster} ${masterMeta.label}`,
    };
  }

  // 7. Continuous dari, master discrete — kasus aneh (mis. master "Pack",
  // staff input "gr"). Tidak didukung untuk skenario Mahakan.
  return {
    ok: false,
    error: "DIMENSION_MISMATCH",
    message: `Tidak bisa konversi ${fromUnit} ke ${masterUnit}. Edit master bahan atau pilih unit sejenis (Kg/gr untuk berat, L/ml untuk volume).`,
  };
}
