import type { IngredientSection } from "./types";

/**
 * Sesi AE-210 — NILAI RUPIAH persediaan hasil opname.
 *
 * Owner Rama: "angka stock opname Juni tidak terlihat nominalnya, saya mau
 * masukin saldo awal." Modul opname sebelumnya hanya menampilkan Δ Cost
 * (nilai SELISIH hitung fisik vs sistem) — bukan NILAI STOK-nya. Padahal
 * yang dibutuhkan untuk mengisi Akuntansi → Ubah Saldo Awal adalah nilai
 * stok akhir per akun persediaan.
 *
 * Rumus per baris: qty aktual (hasil hitung) × unit_cost_at_snapshot.
 * Harga dibekukan saat sesi dimulai, jadi nilai sesi lama tetap reproducible
 * walaupun cost_per_unit bahan sudah berubah setelahnya.
 *
 * Pemetaan section → akun MENGIKUTI PERSIS `accounting/mapping/opname.ts`
 * (kitchen→1140, bar→1141, supporting/cleaning/null→1142). Kalau dua tempat
 * ini berbeda, angka yang diketik owner ke saldo awal tidak akan pernah cocok
 * dengan jurnal opname yang ditulis sistem.
 */

export const OPNAME_PERSEDIAAN_ACCOUNTS = [
  { code: "1140", label: "Persediaan Bahan Baku — Kitchen" },
  { code: "1141", label: "Persediaan Bahan Baku — Bar" },
  { code: "1142", label: "Persediaan Bahan Pendukung" },
] as const;

export type PersediaanAccountCode =
  (typeof OPNAME_PERSEDIAAN_ACCOUNTS)[number]["code"];

const ACCOUNT_BY_SECTION: Record<
  IngredientSection | "null",
  PersediaanAccountCode
> = {
  kitchen: "1140",
  bar: "1141",
  supporting: "1142",
  cleaning: "1142",
  null: "1142",
};

export function persediaanAccountForSection(
  section: IngredientSection | null,
): PersediaanAccountCode {
  return ACCOUNT_BY_SECTION[section ?? "null"];
}

export interface StockValueLineLike {
  actualQty: number | null;
  actualQtyDecimal?: string | null;
  unitCostAtSnapshot: number;
  section: IngredientSection | null;
}

export interface StockValueBucket {
  accountCode: PersediaanAccountCode;
  label: string;
  value: number;
  /** Baris yang sudah dihitung dan masuk bucket ini. */
  countedLines: number;
}

export interface StockValueSummary {
  /** Σ qty aktual × unit cost, seluruh baris yang sudah dihitung. */
  total: number;
  buckets: StockValueBucket[];
  countedLines: number;
  /** Baris yang belum dihitung — nilainya TIDAK ikut `total`. */
  uncountedLines: number;
  /**
   * Baris yang stoknya ada tapi harga snapshot-nya Rp 0. Nilainya hilang
   * senyap dari total; owner perlu tahu supaya tidak mengira saldo awalnya
   * sudah lengkap.
   */
  zeroCostLines: number;
}

/* Sama seperti diff-stats: decimal mirror adalah sumber kebenaran (bigint
 * di-clamp 0 oleh check constraint), tapi kalau string-nya korup jangan
 * biarkan NaN merambat ke total rupiah. */
function safeParseDecimal(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function effectiveActual(l: StockValueLineLike): number | null {
  if (l.actualQtyDecimal != null) {
    const p = safeParseDecimal(l.actualQtyDecimal);
    if (p !== null) return p;
  }
  if (l.actualQty === null) return null;
  return Number.isFinite(l.actualQty) ? l.actualQty : null;
}

/**
 * Nilai persediaan hasil satu sesi opname, dipecah per akun persediaan.
 * Baris yang belum dihitung (actual null) DILEWATI — bukan dianggap 0 —
 * dan dilaporkan lewat `uncountedLines` supaya UI bisa jujur bilang
 * angkanya masih sebagian.
 */
export function computeStockValue(
  lines: StockValueLineLike[],
): StockValueSummary {
  const accum = new Map<
    PersediaanAccountCode,
    { value: number; countedLines: number }
  >();
  let total = 0;
  let counted = 0;
  let uncounted = 0;
  let zeroCost = 0;

  for (const l of lines) {
    const actual = effectiveActual(l);
    if (actual === null) {
      uncounted++;
      continue;
    }
    counted++;
    const cost = Number(l.unitCostAtSnapshot);
    const safeCost = Number.isFinite(cost) ? cost : 0;
    if (safeCost === 0 && actual > 0) zeroCost++;
    const value = actual * safeCost;
    if (!Number.isFinite(value)) continue;

    const code = persediaanAccountForSection(l.section);
    const cur = accum.get(code) ?? { value: 0, countedLines: 0 };
    cur.value += value;
    cur.countedLines += 1;
    accum.set(code, cur);
    total += value;
  }

  const buckets: StockValueBucket[] = OPNAME_PERSEDIAAN_ACCOUNTS.map((a) => {
    const v = accum.get(a.code);
    return {
      accountCode: a.code,
      label: a.label,
      value: v?.value ?? 0,
      countedLines: v?.countedLines ?? 0,
    };
  });

  return {
    total,
    buckets,
    countedLines: counted,
    uncountedLines: uncounted,
    zeroCostLines: zeroCost,
  };
}
