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
  /* Sesi AE-168 — yield preparation per-porsi. Discrete (tiap porsi unik,
   * tidak dikonversi ke pcs). */
  porsi: { label: "porsi", dimension: "discrete", toBase: 1 },
  Porsi: { label: "porsi", dimension: "discrete", toBase: 1 },
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

/**
 * Sesi AE-173 — Label satuan KANONIK untuk DISPLAY + value dropdown.
 * Case-tolerant: "kg"/"KG"/"Kg" → "Kg", "g"/"gr"/"Gr" → "gr",
 * "ml"/"ML" → "ml", "pcs"/"Pcs" → "Pcs". Label custom yang tak dikenal
 * UNIT_TABLE (mis. "botol", "galon", "Karung") dikembalikan apa adanya
 * (trim) supaya konversi pack tetap match.
 *
 * BEDA dgn normalizeUnitLabel (lowercase + strip plural, dipakai dedup
 * internal opname). `displayUnit` = bentuk tampilan RESMI (UNIT_TABLE label)
 * — dipakai di SEMUA dropdown & teks satuan biar konsisten + tak pernah blank.
 */
export function displayUnit(u: string | null | undefined): string {
  if (!u) return "";
  return resolveUnit(u)?.label ?? u.trim();
}

/** Sesi AE-173 — daftar satuan umum KANONIK (1 sumber untuk semua form
 *  belanja/opname/bahan). Registry units pakai label UNIT_TABLE; discrete
 *  custom (galon/kaleng/dst) lowercase konsisten. */
export const CANONICAL_UNIT_PRESETS = [
  "Kg",
  "gr",
  "L",
  "ml",
  "Pcs",
  "Lusin",
  "Btl",
  "Pack",
  "Bks",
  "Krat",
  "Karton",
  "Box",
  "Sdm",
  "Sdt",
  "galon",
  "kaleng",
  "dus",
  "sachet",
  "renceng",
  "bal",
  "pail",
  "ikat",
  "kotak",
  "tabung",
  "roll",
  "set",
  "pax",
] as const;

/**
 * Sesi AE-173 — Bangun options dropdown satuan yang DIJAMIN tak pernah blank.
 * Semua value dikanonikkan via `displayUnit` + dedup case-insensitive, dan
 * nilai terpilih (`current`) selalu diikutkan paling depan. Return juga
 * `value` (bentuk kanonik dari current) untuk dipasang ke <Select value=...>.
 */
export function buildUnitSelectOptions(args: {
  presets?: ReadonlyArray<string>;
  packLabels?: ReadonlyArray<string>;
  current?: string | null;
}): { options: Array<{ value: string; label: string }>; value: string } {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  const add = (raw: string | null | undefined) => {
    const v = displayUnit(raw);
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ value: v, label: v });
  };
  const current = displayUnit(args.current);
  if (current) add(current);
  for (const p of args.packLabels ?? []) add(p);
  for (const p of args.presets ?? []) add(p);
  return { options: out, value: current };
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
 * Sesi AE-130/AE-174 — Merge dua array pack-conversion, dedup by lowercase
 * label. Entry `primary` (dari ingredient.packConversions) menang atas
 * `fallback` (tier-derived dari unitBelanja) supaya manual override-able.
 * Dipindah ke sini dari purchases/actions.ts agar di-reuse lintas modul.
 */
export function mergePackConversions(
  primary: IngredientPackConversion[],
  fallback: IngredientPackConversion[],
): IngredientPackConversion[] {
  const seen = new Set<string>();
  const out: IngredientPackConversion[] = [];
  for (const p of [...primary, ...fallback]) {
    const lc = p.unitLabel.trim().toLowerCase();
    if (lc.length === 0 || seen.has(lc)) continue;
    seen.add(lc);
    out.push(p);
  }
  return out;
}

export interface ResolveQtyResult {
  ok: boolean;
  /** Qty dalam satuan DASAR (master) ingredient. */
  qtyMaster: number | null;
  /** qtyMaster / qty — untuk scale cost: costPerMaster = unitCost / qtyMaster. */
  costFactor: number | null;
  mode: IngredientConvertMode | null;
  error?: "INVALID_QTY" | "UNRESOLVABLE";
}

/**
 * Sesi AE-174 — SUMBER KEBENARAN TUNGGAL konversi satuan → satuan dasar.
 *
 * Menjawab "berapa unit DASAR (master) dari N fromUnit?" dengan menyatukan
 * ingredient `packConversions` + tier `unitBelanja` jadi satu daftar pack,
 * lalu resolve via `convertQtyWithIngredientPacks` (noop → same-dimension →
 * ingredient-pack). Dipakai Market List untuk effective cost
 * (`unitCost / qtyMaster`); KONSISTEN dengan Opname (`buildOpnameUnitContext`)
 * & Pembelian (`convertPurchaseQty`) karena memakai data pack yang sama.
 *
 * Contoh Chocolatos: master "gr", packConversions [{renceng,280},{sachet,28}].
 *   resolveQtyToMaster({qty:1, fromUnit:"renceng", masterUnit:"gr", ...})
 *   → qtyMaster 280, costFactor 280. Beli Rp21.000/renceng → Rp75/gr.
 */
export function resolveQtyToMaster(input: {
  qty: number;
  fromUnit: string | null | undefined;
  masterUnit: string;
  ingredientPacks?: IngredientPackConversion[] | null;
  unitBelanja?: string | null;
  unitBelanjaPerCogs?: number | string | null;
}): ResolveQtyResult {
  const { qty, fromUnit, masterUnit } = input;
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      ok: false,
      qtyMaster: null,
      costFactor: null,
      mode: null,
      error: "INVALID_QTY",
    };
  }

  /* unitBelanja sebagai synthetic pack (1 belanjaUnit = per × master). */
  const belanjaLabel = input.unitBelanja?.trim();
  const belanjaPer = coercePerCogs(input.unitBelanjaPerCogs);
  const tierPacks: IngredientPackConversion[] =
    belanjaLabel &&
    belanjaPer !== null &&
    belanjaPer > 0 &&
    belanjaLabel.toLowerCase() !== masterUnit.trim().toLowerCase()
      ? [{ unitLabel: belanjaLabel, qtyPerBase: belanjaPer }]
      : [];
  const mergedPacks = mergePackConversions(
    input.ingredientPacks ?? [],
    tierPacks,
  );

  const from = (fromUnit ?? "").trim();
  if (from.length === 0) {
    return { ok: true, qtyMaster: qty, costFactor: 1, mode: "noop" };
  }

  const r = convertQtyWithIngredientPacks(qty, from, masterUnit, mergedPacks);
  if (!r.ok || r.qtyMaster === null || r.qtyMaster <= 0) {
    return {
      ok: false,
      qtyMaster: null,
      costFactor: null,
      mode: null,
      error: "UNRESOLVABLE",
    };
  }
  return {
    ok: true,
    qtyMaster: r.qtyMaster,
    costFactor: r.qtyMaster / qty,
    mode: r.mode,
  };
}

/* ============================================================================
 * Sesi AE-175c — Rantai konversi bertingkat (ladder). Pure & client-safe.
 * Mis. 1 renceng = 10 sachet ; 1 sachet = 28 gr → renceng qtyPerBase = 280.
 * ========================================================================== */

export interface LadderInput {
  label: string;
  /** 1 label = qtyPerRef refUnit. */
  qtyPerRef: number;
  /** Satuan tujuan konversi; null = langsung ke satuan dasar. */
  refUnitLabel: string | null;
}

/** Resolve ladder → Map<lowercaseLabel, qtyPerBase>. Throws kalau ref tidak
 *  ditemukan / cycle / qty invalid. */
export function resolveLadderToBase(
  units: LadderInput[],
  baseUnit: string,
): Map<string, number> {
  const baseLc = baseUnit.trim().toLowerCase();
  const byLc = new Map(units.map((u) => [u.label.trim().toLowerCase(), u]));
  const resolved = new Map<string, number>();
  const resolving = new Set<string>();

  const resolve = (lc: string): number => {
    if (lc === baseLc) return 1;
    if (resolved.has(lc)) return resolved.get(lc)!;
    if (resolving.has(lc))
      throw new Error(`Rantai konversi melingkar di "${lc}".`);
    const u = byLc.get(lc);
    if (!u) throw new Error(`Satuan acuan "${lc}" belum didefinisikan.`);
    if (!Number.isFinite(u.qtyPerRef) || u.qtyPerRef <= 0) {
      throw new Error(`Konversi "${u.label}" harus angka > 0.`);
    }
    resolving.add(lc);
    const refLc = (u.refUnitLabel ?? baseUnit).trim().toLowerCase();
    const qpb = u.qtyPerRef * resolve(refLc);
    resolving.delete(lc);
    resolved.set(lc, qpb);
    return qpb;
  };

  for (const u of units) resolve(u.label.trim().toLowerCase());
  return resolved;
}

/* ============================================================================
 * Sesi AE-174 — Editor satuan terpadu (PackUnitsEditor) helper pure.
 *
 * UI menampilkan 2 bagian: "Satuan Belanja Utama" (1, opsional) + "Satuan Pack
 * Lain" (daftar). Mapping ke data ingredient TANPA ubah schema:
 *   - main  → unitBelanja + unitBelanjaPerCogs
 *   - rows  → packConversions
 * Helper di sini supaya bisa di-test tanpa DOM & jadi 1 sumber kebenaran.
 * ========================================================================== */

export interface PackUnitRow {
  /** Key stabil untuk React list (index-based, deterministik untuk test). */
  id: string;
  unitLabel: string;
  /** Raw input string (parse saat submit; terima koma/titik desimal). */
  qtyPerBaseStr: string;
}

export interface PackUnitsForm {
  /** Satuan Belanja Utama (default form beli). "" = tidak diset. */
  mainLabel: string;
  mainQtyStr: string;
  /** Satuan Pack Lain. */
  packRows: PackUnitRow[];
}

export interface ParsedPackUnits {
  unitBelanja: string | null;
  unitBelanjaPerCogs: number | null;
  packConversions: IngredientPackConversion[] | null;
  error: string | null;
}

/** Format angka qty → string input (buang trailing zero, mis. "280.0000"→"280"). */
function fmtQty(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "";
  return String(n);
}

/** Bangun state form dari data ingredient (untuk init editor). */
export function packUnitsFromIngredient(args: {
  unitBelanja: string | null;
  unitBelanjaPerCogs: number | string | null;
  packConversions: IngredientPackConversion[] | null;
}): PackUnitsForm {
  const mainLabel = args.unitBelanja?.trim() ?? "";
  const mainPer = coercePerCogs(args.unitBelanjaPerCogs);
  const main = mainLabel && mainPer != null && mainPer > 0;
  const packRows: PackUnitRow[] = [];
  let i = 0;
  for (const p of args.packConversions ?? []) {
    /* Skip label yang sama dengan Belanja Utama (sudah jadi main row). */
    if (main && p.unitLabel.trim().toLowerCase() === mainLabel.toLowerCase()) {
      continue;
    }
    packRows.push({
      id: `pack-${i++}`,
      unitLabel: p.unitLabel,
      qtyPerBaseStr: fmtQty(p.qtyPerBase),
    });
  }
  return {
    mainLabel: main ? mainLabel : "",
    mainQtyStr: main ? fmtQty(mainPer) : "",
    packRows,
  };
}

/** Parse + validasi form → data ingredient. Pakai saat submit editor.
 *  baseUnit = satuan dasar (ingredient.unit) untuk cek label ≠ dasar. */
export function parsePackUnitsForm(
  form: PackUnitsForm,
  baseUnit: string,
): ParsedPackUnits {
  const fail = (error: string): ParsedPackUnits => ({
    unitBelanja: null,
    unitBelanjaPerCogs: null,
    packConversions: null,
    error,
  });
  const base = baseUnit.trim().toLowerCase();
  const seen = new Set<string>();

  const validateLabelQty = (
    labelRaw: string,
    qtyRaw: string,
    what: string,
  ): { label: string; qty: number } | { error: string } => {
    const label = labelRaw.trim();
    if (/^[\d.,\s]+$/.test(label)) {
      return {
        error: `${what} "${label}" cuma angka. Isi NAMA satuannya (mis. renceng, sachet, Kg).`,
      };
    }
    if (label.toLowerCase() === base) {
      return { error: `${what} "${label}" sama dengan satuan dasar — hapus atau ganti.` };
    }
    if (seen.has(label.toLowerCase())) {
      return { error: `Satuan "${label}" duplikat.` };
    }
    const qty = parseFloat(qtyRaw.trim().replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: `Jumlah untuk "${label}" harus angka > 0.` };
    }
    if (qty > 1_000_000) {
      return { error: `Jumlah untuk "${label}" terlalu besar (maks 1 juta).` };
    }
    seen.add(label.toLowerCase());
    return { label, qty };
  };

  // ── Satuan Belanja Utama (opsional) ─────────────────────────────────
  let unitBelanja: string | null = null;
  let unitBelanjaPerCogs: number | null = null;
  const mainLabel = form.mainLabel.trim();
  const mainQty = form.mainQtyStr.trim();
  if (mainLabel.length > 0 || mainQty.length > 0) {
    if (mainLabel.length === 0) {
      return fail("Satuan Belanja Utama: isi nama satuannya, atau kosongkan jumlahnya.");
    }
    const r = validateLabelQty(mainLabel, mainQty, "Satuan Belanja Utama");
    if ("error" in r) return fail(r.error);
    unitBelanja = r.label;
    unitBelanjaPerCogs = r.qty;
  }

  // ── Satuan Pack Lain (daftar) ───────────────────────────────────────
  const packs: IngredientPackConversion[] = [];
  for (const row of form.packRows) {
    const label = row.unitLabel.trim();
    const qty = row.qtyPerBaseStr.trim();
    if (label.length === 0 && qty.length === 0) continue; // baris kosong → skip
    const r = validateLabelQty(label, qty, "Satuan Pack");
    if ("error" in r) return fail(r.error);
    packs.push({ unitLabel: r.label, qtyPerBase: r.qty });
  }
  if (packs.length > 10) return fail("Maksimal 10 Satuan Pack Lain.");

  return {
    unitBelanja,
    unitBelanjaPerCogs,
    packConversions: packs.length > 0 ? packs : null,
    error: null,
  };
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

/**
 * Sesi AE-130 — Multi-unit tier helpers (Anisa feedback).
 *
 * Model: 1 ingredient punya 3 satuan untuk konteks berbeda:
 *   - COGS (= `ingredients.unit`): satuan terkecil, authoritative untuk
 *     stock + cost + recipe + movement. Semua kalkulasi internal pakai ini.
 *   - TRACKING (`ingredients.unit_tracking` + `unit_tracking_per_cogs`):
 *     satuan terbesar untuk display human-friendly di Inventory list /
 *     low-stock card. Optional — kalau NULL pakai COGS unit apa adanya.
 *   - BELANJA (`ingredients.unit_belanja` + `unit_belanja_per_cogs`):
 *     satuan default saat staff Catat Pembelian / Permintaan Belanja.
 *     Optional — kalau NULL pakai COGS unit apa adanya.
 *
 * Per_cogs = berapa unit COGS per 1 unit tier (mis. 1 Kotak = 1000 ml →
 * unit_tracking_per_cogs = 1000). DEcimal-precision aware: simpan
 * sebagai numeric(15,4) di DB, parse jadi number di sini.
 *
 * Semantic NULL handling:
 *   - Label NULL atau kosong → tier "disabled" untuk ingredient ini,
 *     fallback ke COGS unit.
 *   - Label set tapi per_cogs NULL → treat 1:1 (cuma rename label, no
 *     scaling). Useful kalau staff mau pakai term "Kg" alih-alih "kg"
 *     dengan magnitude sama.
 *   - Label + per_cogs set → full multi-unit aktif.
 */

export interface IngredientUnitTiers {
  /** Master COGS unit (`ingredients.unit`). Always present (NOT NULL). */
  cogsUnit: string;
  /** Tracking display tier. NULL = fallback ke cogsUnit. */
  trackingUnit?: string | null;
  /** COGS units per 1 tracking unit. NULL = 1:1 identity. */
  trackingPerCogs?: number | string | null;
  /** Belanja entry tier. NULL = fallback ke cogsUnit. */
  belanjaUnit?: string | null;
  /** COGS units per 1 belanja unit. NULL = 1:1 identity. */
  belanjaPerCogs?: number | string | null;
}

/** Coerce numeric|string|null jadi number positif atau null. */
function coercePerCogs(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Effective tracking unit label. Returns cogsUnit kalau tracking disabled. */
export function effectiveTrackingUnit(tiers: IngredientUnitTiers): string {
  const t = tiers.trackingUnit?.trim();
  return t && t.length > 0 ? t : tiers.cogsUnit;
}

/** Effective belanja unit label. Returns cogsUnit kalau belanja disabled. */
export function effectiveBelanjaUnit(tiers: IngredientUnitTiers): string {
  const b = tiers.belanjaUnit?.trim();
  return b && b.length > 0 ? b : tiers.cogsUnit;
}

/** Convert qty dalam COGS unit → tracking unit (untuk display).
 *  Kalau tracking disabled atau identity, return qty apa adanya. */
export function cogsToTracking(
  qtyInCogs: number,
  tiers: IngredientUnitTiers,
): number {
  const tracking = tiers.trackingUnit?.trim();
  if (!tracking) return qtyInCogs;
  const per = coercePerCogs(tiers.trackingPerCogs);
  if (per === null) return qtyInCogs; // identity (label only rename)
  return qtyInCogs / per;
}

/** Convert qty dalam tracking unit → COGS unit (untuk storage). */
export function trackingToCogs(
  qtyInTracking: number,
  tiers: IngredientUnitTiers,
): number {
  const tracking = tiers.trackingUnit?.trim();
  if (!tracking) return qtyInTracking;
  const per = coercePerCogs(tiers.trackingPerCogs);
  if (per === null) return qtyInTracking;
  return qtyInTracking * per;
}

/** Convert qty dalam belanja unit → COGS unit (saat Catat Pembelian save). */
export function belanjaToCogs(
  qtyInBelanja: number,
  tiers: IngredientUnitTiers,
): number {
  const belanja = tiers.belanjaUnit?.trim();
  if (!belanja) return qtyInBelanja;
  const per = coercePerCogs(tiers.belanjaPerCogs);
  if (per === null) return qtyInBelanja;
  return qtyInBelanja * per;
}

/** Convert qty dalam COGS unit → belanja unit (untuk display di history). */
export function cogsToBelanja(
  qtyInCogs: number,
  tiers: IngredientUnitTiers,
): number {
  const belanja = tiers.belanjaUnit?.trim();
  if (!belanja) return qtyInCogs;
  const per = coercePerCogs(tiers.belanjaPerCogs);
  if (per === null) return qtyInCogs;
  return qtyInCogs / per;
}

/** Format display: kalau tracking aktif, tampilkan "2 Kotak (2000 ml)".
 *  Kalau disabled, cukup "2000 ml". Locale-aware Indonesian thousands. */
export function formatStockDisplay(
  qtyInCogs: number,
  tiers: IngredientUnitTiers,
  opts?: { showCogsBreakdown?: boolean; maxDecimals?: number },
): string {
  const tracking = tiers.trackingUnit?.trim();
  const per = coercePerCogs(tiers.trackingPerCogs);
  const maxDec = opts?.maxDecimals ?? 4;
  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: maxDec,
    }).format(n);

  if (!tracking) return `${fmt(qtyInCogs)} ${tiers.cogsUnit}`;
  if (per === null) return `${fmt(qtyInCogs)} ${tracking}`;

  const qtyTracking = qtyInCogs / per;
  const main = `${fmt(qtyTracking)} ${tracking}`;
  if (opts?.showCogsBreakdown) {
    return `${main} (${fmt(qtyInCogs)} ${tiers.cogsUnit})`;
  }
  return main;
}

/**
 * Sesi AE-130 — Backdate detection helper (Anisa anti-double-count).
 *
 * Tentukan apakah purchase dengan `purchase_date` (YYYY-MM-DD) seharusnya
 * SKIP stock update karena sudah ter-cover di opname terakhir yang
 * finalized.
 *
 * Convention: opname finalized di hari X jam Y → stock fisik di-anggap
 * mencakup semua aktivitas di tanggal X dan sebelumnya. Purchase dengan
 * tanggal < X = backdated, sudah counted di opname → SKIP stock update.
 * Purchase dengan tanggal = X = AMBIGUOUS (mungkin counted, mungkin belum,
 * tergantung jam belanja vs jam opname). Default: SKIP juga + warn user.
 * Purchase > X = NORMAL additive.
 *
 * Asia/Jakarta timezone-aware: finalizedAt UTC timestamp di-format ke
 * Jakarta date untuk perbandingan dengan purchase_date (yang interpreted
 * sebagai tanggal Jakarta business day).
 *
 * Returns:
 *  - "after": purchase setelah opname → normal additive
 *  - "same": purchase sama hari dengan opname → ambiguous, SKIP + warn
 *  - "before": purchase sebelum opname → DEFINITELY backdated, SKIP + warn
 *  - "no_baseline": tidak ada opname finalized → normal (fresh setup)
 */
export type BackdateStatus = "after" | "same" | "before" | "no_baseline";

export function classifyPurchaseAgainstOpname(args: {
  purchaseDateIso: string; // YYYY-MM-DD (Jakarta business day)
  lastOpnameFinalizedAt: Date | null;
}): BackdateStatus {
  if (!args.lastOpnameFinalizedAt) return "no_baseline";
  const opnameDateIso = jakartaDateIso(args.lastOpnameFinalizedAt);
  if (args.purchaseDateIso > opnameDateIso) return "after";
  if (args.purchaseDateIso === opnameDateIso) return "same";
  return "before";
}

/** Should stock update be skipped untuk purchase ini? True kalau before/same
 *  (defensive: same-day ambiguous treated as backdated supaya tidak risk
 *  double-count). */
export function shouldSkipStockUpdate(status: BackdateStatus): boolean {
  return status === "before" || status === "same";
}

/** Format Date sebagai YYYY-MM-DD di Asia/Jakarta timezone. */
export function jakartaDateIso(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Sesi AE-147 — Opname unit context.
 *
 * Bundle SEMUA unit options + conversion ratio yang relevan untuk satu
 * ingredient di tampilan opname (Purchase Unit, Recipe Unit, pack
 * alternatives, same-dimension legacy). Memberi 1 source of truth supaya
 * UI tidak fragmented antara `compatibleUnitsFor` + `unitBelanja` +
 * `packConversions`.
 *
 * Default unit: prefer `unitBelanja` (purchase) → fallback recipe.
 * Hint per option: "1 X = N {recipe}" supaya staff paham conversion saat
 * pilih unit.
 *
 * Returns map `multiplierTo` yang gampang dipakai applier: untuk convert
 * qty input ke recipe (master) unit, multiply qty × multiplierTo[unit].
 */
export interface OpnameUnitOption {
  /** Unit label (juga value untuk Select). */
  value: string;
  /** Display label sama dengan value, tapi bisa beda case nanti. */
  label: string;
  /** Berapa unit recipe per 1 unit ini. 1 untuk recipe unit itu sendiri. */
  multiplierToRecipe: number;
  /** Kategori: "purchase" (unitBelanja), "recipe" (master), "pack-alt"
   *  (packConversions), "dimension" (same-dim via UNIT_TABLE).
   *  Dipakai untuk grouping/styling di UI. */
  source: "purchase" | "recipe" | "pack-alt" | "dimension";
  /** Hint text untuk Select option, mis. "= 5 pcs". Null untuk recipe unit
   *  itu sendiri (no conversion needed). */
  hint: string | null;
}

export interface OpnameUnitContext {
  /** Master/recipe unit (= ingredient.unit). Always present. */
  recipeUnit: string;
  /** Purchase unit kalau di-set (= ingredient.unitBelanja). Null = identity. */
  purchaseUnit: string | null;
  /** Sorted list untuk Select. Default unit = options[0]. */
  options: OpnameUnitOption[];
  /** Default unit yang dipilih di awal — purchase kalau ada, else recipe. */
  defaultUnit: string;
  /** Lookup multiplier: unit label → multiplier to recipe. Pakai untuk
   *  convert qty input ke recipe unit (qty × multiplier = recipe qty). */
  multipliers: Map<string, number>;
  /** True kalau split input "penuh + sisa lepas" cocok dipakai
   *  (multiplier purchase > 1 + recipe unit beda). */
  supportsSplitInput: boolean;
}

export interface OpnameUnitContextInput {
  recipeUnit: string;
  unitBelanja?: string | null;
  unitBelanjaPerCogs?: number | string | null;
  packConversions?: IngredientPackConversion[] | null;
}

export function buildOpnameUnitContext(
  input: OpnameUnitContextInput,
): OpnameUnitContext {
  const recipeUnit = input.recipeUnit;
  const opts: OpnameUnitOption[] = [];
  const multipliers = new Map<string, number>();
  const seen = new Set<string>();

  /* Sesi AE-148 — Dedup-aware normalization. Owner feedback: jangan
   * tampilkan "pack" + "Packs" + "Pack" sebagai 3 unit terpisah karena
   * konseptual sama. Norm strip whitespace + lowercase + strip trailing
   * "s" untuk plural variants. */
  const norm = normalizeUnitLabel;

  /* 1. Purchase unit prepend kalau ada + per > 0 + beda dari recipe. */
  const belanjaLabel = input.unitBelanja?.trim();
  const belanjaPer = coercePerCogs(input.unitBelanjaPerCogs);
  let purchaseUnit: string | null = null;
  if (belanjaLabel && belanjaPer !== null && norm(belanjaLabel) !== norm(recipeUnit)) {
    purchaseUnit = belanjaLabel;
    opts.push({
      value: belanjaLabel,
      label: belanjaLabel,
      multiplierToRecipe: belanjaPer,
      source: "purchase",
      hint: `= ${formatRatio(belanjaPer)} ${recipeUnit}`,
    });
    multipliers.set(belanjaLabel, belanjaPer);
    seen.add(norm(belanjaLabel));
  }

  /* 2. Recipe unit (always). */
  opts.push({
    value: recipeUnit,
    label: recipeUnit,
    multiplierToRecipe: 1,
    source: "recipe",
    hint: null,
  });
  multipliers.set(recipeUnit, 1);
  seen.add(norm(recipeUnit));

  /* 3. Pack alternatives (ingredient-scoped, mis. "Packs" untuk Lychee).
   * Sesi AE-148 — DUAL DEDUP: label-based (case+plural) + multiplier-based.
   * Drop pack-alt yang punya multiplier sama dengan purchase unit (mis.
   * unitBelanja "kg" 1000 + pack-alt "Packs" 1000 → keep purchase, drop). */
  const seenMultipliers = new Set<number>();
  for (const opt of opts) {
    seenMultipliers.add(opt.multiplierToRecipe);
  }
  if (input.packConversions) {
    for (const p of input.packConversions) {
      const lc = norm(p.unitLabel);
      if (lc.length === 0 || seen.has(lc)) continue;
      if (!Number.isFinite(p.qtyPerBase) || p.qtyPerBase <= 0) continue;
      if (seenMultipliers.has(p.qtyPerBase)) continue;
      opts.push({
        value: p.unitLabel,
        label: p.unitLabel,
        multiplierToRecipe: p.qtyPerBase,
        source: "pack-alt",
        hint: `= ${formatRatio(p.qtyPerBase)} ${recipeUnit}`,
      });
      multipliers.set(p.unitLabel, p.qtyPerBase);
      seen.add(lc);
      seenMultipliers.add(p.qtyPerBase);
    }
  }

  /* 4. Same-dimension units (kg↔gr, L↔ml) via UNIT_TABLE.
   * Sesi AE-173 — owner feedback: beberapa item tidak bisa opname pakai satuan
   * terbesar. Dulu di-skip kalau purchaseUnit ada (anti-ramai AE-148); sekarang
   * SELALU tawarkan supaya satuan terbesar (mis. kg untuk master g) selalu
   * tersedia. Dedup (label + multiplier) tetap cegah duplikat. */
  {
    const dimComp = compatibleUnitsFor(recipeUnit, null);
    for (const d of dimComp) {
      const lc = norm(d.value);
      if (seen.has(lc)) continue;
      const conv = convertQty(1, d.value, recipeUnit);
      if (conv === null || conv <= 0) continue;
      if (seenMultipliers.has(conv)) continue;
      opts.push({
        value: d.value,
        label: d.label,
        multiplierToRecipe: conv,
        source: "dimension",
        hint: conv === 1 ? null : `= ${formatRatio(conv)} ${recipeUnit}`,
      });
      multipliers.set(d.value, conv);
      seen.add(lc);
      seenMultipliers.add(conv);
    }
  }

  const defaultUnit = purchaseUnit ?? recipeUnit;
  const supportsSplitInput =
    purchaseUnit !== null && (belanjaPer ?? 0) > 1;

  return {
    recipeUnit,
    purchaseUnit,
    options: opts,
    defaultUnit,
    multipliers,
    supportsSplitInput,
  };
}

/** Format ratio tanpa trailing zeros: 1000 → "1000", 1.5 → "1,5",
 *  0.25 → "0,25". Pakai locale id-ID. */
function formatRatio(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(n);
}

/**
 * Sesi AE-148 — Normalize unit label ke canonical form untuk dedup.
 *
 * Aturan:
 *  1. Trim whitespace
 *  2. Lookup canonical case di CANONICAL_UNIT_LABELS (mis. "l"/"liter" → "L",
 *     untuk preserve SI uppercase). Kalau ada match, return canonical.
 *  3. Else lowercase + strip trailing "s" untuk plural variant
 *     (pack/packs/Packs → pack).
 *
 * Reasoning: owner feedback "selaraskan pack dan packs jangan ada dua unit
 * yang sebenarnya sama". Tanpa norm, opname picker tampak duplikat.
 * Tetap preserve "L" uppercase karena standard SI.
 */
const CANONICAL_UNIT_LABELS: Record<string, string> = {
  l: "L",
  liter: "L",
  litre: "L",
  ml: "ml",
  kg: "kg",
  g: "g",
  gr: "g",
  gram: "g",
  pcs: "pcs",
  pc: "pcs",
};

export function normalizeUnitLabel(label: string): string {
  if (!label) return "";
  const trimmed = label.trim();
  if (trimmed.length === 0) return "";
  const lc = trimmed.toLowerCase();
  /* Cek canonical SI / common units dulu (preserve uppercase mis. L). */
  if (CANONICAL_UNIT_LABELS[lc]) return CANONICAL_UNIT_LABELS[lc];
  /* Strip trailing "s" untuk plural — hanya kalau hasilnya > 3 char,
   * supaya "ml", "gr", "gas", "set" tetap intact. */
  let s = lc;
  if (s.length > 3 && s.endsWith("s")) {
    s = s.slice(0, -1);
    /* Re-cek canonical setelah strip (mis. "liters" → "liter" → "L"). */
    if (CANONICAL_UNIT_LABELS[s]) return CANONICAL_UNIT_LABELS[s];
  }
  return s;
}

/**
 * Sesi AE-147 — Compute final qty (in recipe unit) dari split input
 * "penuh + sisa lepas". `primaryQty` di-`primaryUnit`, `loose` di recipe.
 * Returns null kalau both invalid/empty.
 */
export function computeOpnameQtyFromSplit(args: {
  primaryQty: number | null;
  primaryUnit: string;
  looseQtyRecipe: number | null;
  context: OpnameUnitContext;
}): number | null {
  const { primaryQty, primaryUnit, looseQtyRecipe, context } = args;
  let total = 0;
  let hasValue = false;
  if (primaryQty !== null && Number.isFinite(primaryQty) && primaryQty >= 0) {
    const mult = context.multipliers.get(primaryUnit);
    if (mult === undefined) return null;
    total += primaryQty * mult;
    hasValue = true;
  }
  if (looseQtyRecipe !== null && Number.isFinite(looseQtyRecipe) && looseQtyRecipe >= 0) {
    total += looseQtyRecipe;
    hasValue = true;
  }
  if (!hasValue) return null;
  return total;
}
