/**
 * Sesi AE-222 — REKAP PEMBELANJAAN BAHAN BAKU (rupiah).
 *
 * Pertanyaan yang dijawab modul ini: "bulan ini uang belanja bahan habis
 * berapa, untuk apa saja, dari siapa, dan naik/turun dibanding periode
 * sebelumnya?" — tanpa owner harus membuka nota satu per satu.
 *
 * Satuan barisnya sama persis dengan modul Masuk Bahan (AE-192): **barang
 * yang benar-benar diterima**, yaitu Goods Receipt + pembelian instan yang
 * tidak punya baris GR. Alasannya penting: PO yang baru dipesan belum
 * menyentuh kas maupun jurnal, jadi kalau ikut dihitung, rekap ini tidak akan
 * pernah cocok dengan Laba Rugi dan Buku Besar. PO yang masih menggantung
 * tetap dilaporkan terpisah (`pendingOrders`) supaya tidak terlupakan.
 *
 * Uang satu baris = `total_cost` (AE-216: Total Bayar dari nota yang menang,
 * bukan `qty × harga` yang sudah kena pembulatan rupiah).
 *
 * Semua fungsi di file ini bebas DB/React supaya bisa diuji langsung.
 */

export type SpendSection =
  | "kitchen"
  | "bar"
  | "supporting"
  | "cleaning"
  | "unassigned";

export const SPEND_SECTION_ORDER: SpendSection[] = [
  "kitchen",
  "bar",
  "supporting",
  "cleaning",
  "unassigned",
];

export const SPEND_SECTION_LABELS: Record<SpendSection, string> = {
  kitchen: "Dapur",
  bar: "Bar",
  supporting: "Pendukung",
  cleaning: "Kebersihan",
  unassigned: "Belum diset",
};

export type SpendPaymentMethod =
  | "cash"
  | "transfer_bca"
  | "transfer_bri"
  | "transfer_other"
  | "top";

export const SPEND_PAYMENT_LABELS: Record<SpendPaymentMethod, string> = {
  cash: "Tunai",
  transfer_bca: "Transfer BCA",
  transfer_bri: "Transfer BRI",
  transfer_other: "Transfer lain",
  top: "TOP (tempo)",
};

export type SpendPaymentStatus = "pending_payment" | "paid";

/** Satu baris belanja: satu bahan pada satu penerimaan barang. */
export interface SpendLine {
  /** ID baris sumber (goods_receipt_items.id atau purchase_items.id). */
  id: string;
  /** 'gr' = lewat Goods Receipt, 'direct' = pembelian instan tanpa GR. */
  source: "gr" | "direct";
  /** Tanggal yang dipakai rekap (WIB, YYYY-MM-DD) — lihat `SpendDateBasis`. */
  date: string;
  purchaseId: string;
  /** Tanggal nota/PO (WIB). Sama dengan `date` untuk pembelian instan. */
  purchaseDate: string;
  invoiceNo: string | null;
  supplierId: string | null;
  supplierName: string | null;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  section: SpendSection;
  /** Qty dalam satuan `unit` (mirror desimal kalau ada). */
  qty: number;
  amount: number;
  paymentMethod: SpendPaymentMethod;
  paymentStatus: SpendPaymentStatus;
}

/** Tanggal mana yang dipakai menaruh belanja di kalender. */
export type SpendDateBasis = "receipt" | "purchase";

/** Dimensi rincian yang bisa dipilih owner. */
export type SpendDimension =
  | "month"
  | "date"
  | "section"
  | "ingredient"
  | "supplier"
  | "paymentMethod";

export const SPEND_DIMENSION_LABELS: Record<SpendDimension, string> = {
  month: "Bulan",
  date: "Tanggal",
  section: "Section",
  ingredient: "Bahan",
  supplier: "Supplier",
  paymentMethod: "Metode bayar",
};

export interface SpendFilters {
  section?: SpendSection | "all";
  ingredientId?: string | null;
  supplierId?: string | null;
  /** "none" = belanja tanpa supplier (pasar/walk-in). */
  paymentMethod?: SpendPaymentMethod | "all";
  paymentStatus?: SpendPaymentStatus | "all";
  /** Cari nama bahan / supplier / no. nota (case-insensitive). */
  search?: string;
}

export interface SpendGroupRow {
  key: string;
  label: string;
  /** Baris kedua kecil di bawah label (satuan, section, dsb). */
  sublabel: string | null;
  amount: number;
  /** Porsi terhadap total rekap, 0..1. */
  share: number;
  /** Qty terakumulasi — hanya berarti kalau satuannya seragam. */
  qty: number | null;
  unit: string | null;
  lineCount: number;
  purchaseCount: number;
  firstDate: string;
  lastDate: string;
  /** amount ÷ qty. NULL kalau satuannya campur atau qty 0. */
  avgUnitCost: number | null;
}

export interface SpendSummary {
  total: number;
  lineCount: number;
  purchaseCount: number;
  ingredientCount: number;
  supplierCount: number;
  /** Jumlah hari kalender yang benar-benar ada belanjanya. */
  activeDays: number;
  /** Panjang rentang tanggal yang dipilih (hari kalender). */
  rangeDays: number;
  avgPerActiveDay: number;
  avgPerPurchase: number;
  firstDate: string | null;
  lastDate: string | null;
  paidTotal: number;
  unpaidTotal: number;
}

export interface SpendFilterOption {
  value: string;
  label: string;
  amount: number;
}

export interface SpendRecapResult {
  summary: SpendSummary;
  /** Total periode pembanding sepanjang rentang yang sama (untuk delta).
   *  NULL kalau tidak ada pembanding (mis. seluruhnya di balik batas buku). */
  previousTotal: number | null;
  previousFrom: string | null;
  previousTo: string | null;
  byMonth: SpendGroupRow[];
  byDate: SpendGroupRow[];
  bySection: SpendGroupRow[];
  byIngredient: SpendGroupRow[];
  bySupplier: SpendGroupRow[];
  byPaymentMethod: SpendGroupRow[];
  /** Pilihan dropdown, diambil dari rentang tanggal (belum kena filter lain). */
  ingredientOptions: SpendFilterOption[];
  supplierOptions: SpendFilterOption[];
  /** PO yang sudah dipesan tapi barangnya belum diterima — di LUAR total. */
  pendingOrders: { count: number; amount: number };
  /** true kalau baris kena batas — UI minta owner mempersempit rentang. */
  truncated: boolean;
  /** Batas buku yang menggeser tanggal awal (kalau ada). */
  cutoffApplied: string | null;
  appliedFrom: string;
  appliedTo: string;
  dateBasis: SpendDateBasis;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** "2026-08" → "Agu 2026". Input tak dikenal dikembalikan apa adanya. */
export function formatMonthLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return yyyymm;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return yyyymm;
  return `${MONTH_SHORT[idx]} ${m[1]}`;
}

/** "2026-08-26" → "26 Agu 2026". */
export function formatDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${Number(m[3])} ${MONTH_SHORT[idx]} ${m[1]}`;
}

/** Label rentang ringkas: "1 – 26 Agu 2026" / "1 Jul – 26 Agu 2026". */
export function formatRangeLabel(from: string, to: string): string {
  if (!from || !to) return `${from || "?"} – ${to || "?"}`;
  if (from === to) return formatDayLabel(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (sameMonth) {
    return `${Number(from.slice(8, 10))} – ${formatDayLabel(to)}`;
  }
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (sameYear) {
    const m = Number(from.slice(5, 7)) - 1;
    const head = `${Number(from.slice(8, 10))} ${MONTH_SHORT[m] ?? "?"}`;
    return `${head} – ${formatDayLabel(to)}`;
  }
  return `${formatDayLabel(from)} – ${formatDayLabel(to)}`;
}

/** Jumlah hari kalender inklusif antara dua tanggal ISO. Minimal 1. */
export function inclusiveDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 1;
  return Math.round((b - a) / MS_PER_DAY) + 1;
}

function shiftIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Periode pembanding: rentang sepanjang yang sama, persis menempel sebelum
 * rentang terpilih. 1–31 Agu → 1–31 Jul (31 hari, bukan "bulan lalu" kalender)
 * supaya perbandingannya adil untuk rentang apa pun, termasuk rentang bebas.
 */
export function previousRangeOf(
  from: string,
  to: string,
): { from: string; to: string } {
  const days = inclusiveDays(from, to);
  return { from: shiftIso(from, -days), to: shiftIso(to, -days) };
}

/** Nilai `section` apa pun (snapshot lama, NULL, enum) → kunci rekap. */
export function normalizeSpendSection(value: string | null | undefined): SpendSection {
  switch (value) {
    case "kitchen":
    case "bar":
    case "supporting":
    case "cleaning":
      return value;
    default:
      return "unassigned";
  }
}

/** Metode bayar apa pun → kunci rekap ('cash' sebagai jaring pengaman). */
export function normalizeSpendPaymentMethod(
  value: string | null | undefined,
): SpendPaymentMethod {
  switch (value) {
    case "cash":
    case "transfer_bca":
    case "transfer_bri":
    case "transfer_other":
    case "top":
      return value;
    default:
      return "cash";
  }
}

/** Sentinel dropdown untuk belanja tanpa supplier (pasar / walk-in). */
export const SUPPLIER_NONE = "__none__";

export function matchesSpendFilters(
  line: SpendLine,
  f: SpendFilters = {},
): boolean {
  if (f.section && f.section !== "all" && line.section !== f.section) {
    return false;
  }
  if (f.ingredientId && line.ingredientId !== f.ingredientId) return false;
  if (f.supplierId) {
    const want = f.supplierId === SUPPLIER_NONE ? null : f.supplierId;
    if (line.supplierId !== want) return false;
  }
  if (
    f.paymentMethod &&
    f.paymentMethod !== "all" &&
    line.paymentMethod !== f.paymentMethod
  ) {
    return false;
  }
  if (
    f.paymentStatus &&
    f.paymentStatus !== "all" &&
    line.paymentStatus !== f.paymentStatus
  ) {
    return false;
  }
  const q = f.search?.trim().toLowerCase();
  if (q) {
    const hay = [
      line.ingredientName,
      line.supplierName ?? "",
      line.invoiceNo ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

interface Bucket {
  key: string;
  label: string;
  sublabel: string | null;
  amount: number;
  qty: number;
  units: Set<string>;
  lineCount: number;
  purchaseIds: Set<string>;
  firstDate: string;
  lastDate: string;
}

function keyOf(line: SpendLine, dim: SpendDimension): {
  key: string;
  label: string;
  sublabel: string | null;
} {
  switch (dim) {
    case "month":
      return {
        key: line.date.slice(0, 7),
        label: formatMonthLabel(line.date.slice(0, 7)),
        sublabel: null,
      };
    case "date":
      return { key: line.date, label: formatDayLabel(line.date), sublabel: null };
    case "section":
      return {
        key: line.section,
        label: SPEND_SECTION_LABELS[line.section],
        sublabel: null,
      };
    case "ingredient":
      return {
        key: line.ingredientId,
        label: line.ingredientName,
        sublabel: SPEND_SECTION_LABELS[line.section],
      };
    case "supplier":
      return {
        key: line.supplierId ?? SUPPLIER_NONE,
        label: line.supplierName ?? "Tanpa supplier (pasar)",
        sublabel: null,
      };
    case "paymentMethod":
      return {
        key: line.paymentMethod,
        label: SPEND_PAYMENT_LABELS[line.paymentMethod],
        sublabel: null,
      };
  }
}

/**
 * Kelompokkan baris belanja per dimensi. Urutan hasil:
 *  - month/date → kronologis (grafik tren butuh urutan waktu)
 *  - lainnya    → rupiah terbesar dulu (yang paling menguras kas di atas)
 */
export function groupSpendLines(
  lines: SpendLine[],
  dim: SpendDimension,
  totalOverride?: number,
): SpendGroupRow[] {
  const buckets = new Map<string, Bucket>();
  let total = 0;

  for (const line of lines) {
    total += line.amount;
    const { key, label, sublabel } = keyOf(line, dim);
    let b = buckets.get(key);
    if (!b) {
      b = {
        key,
        label,
        sublabel,
        amount: 0,
        qty: 0,
        units: new Set(),
        lineCount: 0,
        purchaseIds: new Set(),
        firstDate: line.date,
        lastDate: line.date,
      };
      buckets.set(key, b);
    }
    b.amount += line.amount;
    b.qty += line.qty;
    if (line.unit) b.units.add(line.unit);
    b.lineCount += 1;
    b.purchaseIds.add(line.purchaseId);
    if (line.date < b.firstDate) b.firstDate = line.date;
    if (line.date > b.lastDate) b.lastDate = line.date;
  }

  const denom = totalOverride ?? total;
  const rows: SpendGroupRow[] = Array.from(buckets.values()).map((b) => {
    const oneUnit = b.units.size === 1 ? Array.from(b.units)[0] : null;
    /* Qty hanya boleh dijumlahkan kalau satuannya seragam — menjumlahkan
     * Kg dengan Pcs menghasilkan angka yang terlihat benar tapi tidak
     * berarti apa-apa. */
    const qty = dim === "ingredient" || oneUnit ? b.qty : null;
    return {
      key: b.key,
      label: b.label,
      sublabel: b.sublabel,
      amount: b.amount,
      share: denom > 0 ? b.amount / denom : 0,
      qty: oneUnit ? qty : null,
      unit: oneUnit,
      lineCount: b.lineCount,
      purchaseCount: b.purchaseIds.size,
      firstDate: b.firstDate,
      lastDate: b.lastDate,
      avgUnitCost: oneUnit && b.qty > 0 ? Math.round(b.amount / b.qty) : null,
    };
  });

  if (dim === "month" || dim === "date") {
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  } else if (dim === "section") {
    rows.sort(
      (a, b) =>
        SPEND_SECTION_ORDER.indexOf(a.key as SpendSection) -
        SPEND_SECTION_ORDER.indexOf(b.key as SpendSection),
    );
  } else {
    rows.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  }
  return rows;
}

export function summarizeSpend(
  lines: SpendLine[],
  range: { from: string; to: string },
): SpendSummary {
  let total = 0;
  let paidTotal = 0;
  let unpaidTotal = 0;
  const purchases = new Set<string>();
  const ingredientIds = new Set<string>();
  const supplierKeys = new Set<string>();
  const days = new Set<string>();
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  for (const l of lines) {
    total += l.amount;
    if (l.paymentStatus === "paid") paidTotal += l.amount;
    else unpaidTotal += l.amount;
    purchases.add(l.purchaseId);
    ingredientIds.add(l.ingredientId);
    supplierKeys.add(l.supplierId ?? SUPPLIER_NONE);
    days.add(l.date);
    if (firstDate === null || l.date < firstDate) firstDate = l.date;
    if (lastDate === null || l.date > lastDate) lastDate = l.date;
  }

  const activeDays = days.size;
  return {
    total,
    lineCount: lines.length,
    purchaseCount: purchases.size,
    ingredientCount: ingredientIds.size,
    supplierCount: supplierKeys.size,
    activeDays,
    rangeDays: inclusiveDays(range.from, range.to),
    avgPerActiveDay: activeDays > 0 ? Math.round(total / activeDays) : 0,
    avgPerPurchase:
      purchases.size > 0 ? Math.round(total / purchases.size) : 0,
    firstDate,
    lastDate,
    paidTotal,
    unpaidTotal,
  };
}

/** Pilihan dropdown bahan/supplier, diurut dari yang paling besar rupiahnya. */
export function spendFilterOptions(lines: SpendLine[]): {
  ingredientOptions: SpendFilterOption[];
  supplierOptions: SpendFilterOption[];
} {
  const ing = groupSpendLines(lines, "ingredient");
  const sup = groupSpendLines(lines, "supplier");
  return {
    ingredientOptions: ing.map((r) => ({
      value: r.key,
      label: r.label,
      amount: r.amount,
    })),
    supplierOptions: sup.map((r) => ({
      value: r.key,
      label: r.label,
      amount: r.amount,
    })),
  };
}

/** Perubahan relatif terhadap periode pembanding. NULL kalau tak bisa dihitung. */
export function spendDeltaPercent(
  current: number,
  previous: number | null,
): number | null {
  if (previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Rakit seluruh hasil rekap dari baris mentah. `lines` = seluruh baris dalam
 * rentang (belum kena filter) supaya pilihan dropdown tidak ikut menyusut
 * setiap owner memilih satu bahan — dropdown yang mengosongkan dirinya sendiri
 * membuat filter tidak bisa diganti tanpa reset.
 */
export function buildSpendRecap(input: {
  lines: SpendLine[];
  previousLines: SpendLine[];
  filters: SpendFilters;
  range: { from: string; to: string };
  /** Rentang pembanding yang BENAR-BENAR dipakai (sudah kena batas buku). */
  previousRange: { from: string; to: string } | null;
  pendingOrders: { count: number; amount: number };
  truncated: boolean;
  cutoffApplied: string | null;
  dateBasis: SpendDateBasis;
}): SpendRecapResult {
  const { lines, filters, range } = input;
  const filtered = lines.filter((l) => matchesSpendFilters(l, filters));
  const summary = summarizeSpend(filtered, range);
  /* Pembanding memakai filter yang sama — kalau tidak, "naik 300%" bisa
   * sekadar karena periode lalu dihitung tanpa filter. */
  const previousTotal = input.previousRange
    ? input.previousLines
        .filter((l) => matchesSpendFilters(l, filters))
        .reduce((s, l) => s + l.amount, 0)
    : null;

  const total = summary.total;
  const opts = spendFilterOptions(lines);

  return {
    summary,
    previousTotal,
    previousFrom: input.previousRange?.from ?? null,
    previousTo: input.previousRange?.to ?? null,
    byMonth: groupSpendLines(filtered, "month", total),
    byDate: groupSpendLines(filtered, "date", total),
    bySection: groupSpendLines(filtered, "section", total),
    byIngredient: groupSpendLines(filtered, "ingredient", total),
    bySupplier: groupSpendLines(filtered, "supplier", total),
    byPaymentMethod: groupSpendLines(filtered, "paymentMethod", total),
    ingredientOptions: opts.ingredientOptions,
    supplierOptions: opts.supplierOptions,
    pendingOrders: input.pendingOrders,
    truncated: input.truncated,
    cutoffApplied: input.cutoffApplied,
    appliedFrom: range.from,
    appliedTo: range.to,
    dateBasis: input.dateBasis,
  };
}
