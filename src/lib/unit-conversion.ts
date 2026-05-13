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

/** List unit options yang compatible dengan master unit (sama dimensi).
 *  Dipakai di Stock Opname picker biar staff cuma lihat unit relevan. */
export function compatibleUnitsFor(
  masterUnit: string,
): Array<{ value: string; label: string }> {
  const master = resolveUnit(masterUnit);
  if (!master) {
    return [{ value: masterUnit, label: masterUnit }];
  }
  if (master.dimension === "discrete") {
    return [{ value: master.label, label: master.label }];
  }
  const seen = new Set<string>();
  const items: Array<{ value: string; label: string }> = [];
  for (const meta of Object.values(UNIT_TABLE)) {
    if (meta.dimension !== master.dimension) continue;
    if (seen.has(meta.label)) continue;
    seen.add(meta.label);
    items.push({ value: meta.label, label: meta.label });
  }
  return items;
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
}): PurchaseConvertResult {
  const { qty, fromUnit, masterUnit, pack } = input;

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
    if (!pack) {
      return {
        ok: false,
        error: "PACK_UNKNOWN",
        message: `Pilih supplier yang punya entry di Market List untuk bahan ini, supaya sistem tahu 1 ${fromUnit} = berapa ${masterUnit}.`,
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
