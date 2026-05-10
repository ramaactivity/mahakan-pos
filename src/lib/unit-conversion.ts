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
