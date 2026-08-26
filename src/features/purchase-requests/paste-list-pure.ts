/**
 * Sesi AE-219 — TEMPEL DAFTAR BELANJA.
 *
 * Selama dua bulan terakhir PR yang tercatat rata-rata hanya 2,29 item (39
 * dari 82 PR berisi TEPAT satu item), sementara daftar belanja yang benar-
 * benar dikirim staff ke grup WhatsApp berisi sepuluhan bahan yang diketik
 * tangan. Dashboard owner jadi tidak pernah menggambarkan belanja yang
 * sesungguhnya.
 *
 * Mengetik sepuluh bahan satu per satu di layar HP memang berat, dan staff
 * sudah punya kebiasaan yang jalan: menulis daftarnya sebagai teks. Modul ini
 * menerima teks itu apa adanya — termasuk SELURUH pesan WhatsApp beserta
 * kepala dan kakinya — lalu mengubahnya jadi baris-baris yang bisa dikoreksi.
 *
 * Sengaja tanpa impor apa pun supaya bisa diuji lepas dari React dan DB.
 * Modul ini TIDAK pernah menebak diam-diam: baris yang namanya cocok ke lebih
 * dari satu bahan dikembalikan sebagai "ambigu" supaya manusia yang memilih.
 */

export interface PasteCandidate {
  id: string;
  name: string;
  /** Satuan dasar bahan (master/COGS). */
  unit: string;
  /** Label satuan lain yang sah untuk bahan ini (satuan belanja + pack). */
  packLabels: string[];
}

export type PasteMatch =
  | { kind: "exact"; ingredientId: string; name: string }
  | { kind: "partial"; ingredientId: string; name: string }
  | { kind: "ambiguous"; options: Array<{ id: string; name: string }> }
  | { kind: "none" };

export interface ParsedPasteLine {
  /** Baris asli apa adanya — ditampilkan kalau pembacaannya meleset. */
  raw: string;
  /** Nama bahan hasil baca (sudah lepas dari nomor urut & qty). */
  name: string;
  /** Qty hasil baca. null = tidak ada angka yang terbaca. */
  qty: number | null;
  /** Satuan yang DITULIS staff, sudah dirapikan ejaannya. null = tidak ditulis. */
  unit: string | null;
  match: PasteMatch;
}

/* ---------------------------------------------------------------- baris ---- */

/** Baris hiasan pesan WhatsApp yang tidak boleh jadi item. */
const SKIP_PATTERNS: RegExp[] = [
  /^[\s─—–_=*]+$/,
  /permintaan\s+belanja/i,
  /daftar\s+belanja/i,
  /^\W*no\.?\s*pr\b/i,
  /^\W*tanggal\b/i,
  /^\W*jam\b/i,
  /^\W*diminta\b/i,
  /^\W*item\s*:/i,
  /pesan\s+otomatis/i,
  /konfirmasi\s+approval/i,
  /^\W*catatan\b/i,
  /balas\s+pesan/i,
];

function isDecorative(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return SKIP_PATTERNS.some((re) => re.test(t));
}

/** Buang nomor urut / bullet / bintang tebal WhatsApp di depan baris. */
function stripLeadIn(line: string): string {
  return line
    .replace(/^\s*[*_~]+/, "")
    .replace(/^\s*\d+\s*[.)]\s*/, "")
    .replace(/^\s*[-•·*▪]\s+/, "")
    .trim();
}

/* --------------------------------------------------------------- satuan ---- */

/** Ejaan sehari-hari staff → label kanonik yang dipakai master. */
const UNIT_ALIASES: Record<string, string> = {
  pck: "Pack",
  pak: "Pack",
  pak2: "Pack",
  pack: "Pack",
  paket: "Pack",
  bks: "Pack",
  bungkus: "Pack",
  kg: "Kg",
  kilo: "Kg",
  kilogram: "Kg",
  gr: "gr",
  gram: "gr",
  g: "gr",
  ons: "ons",
  ml: "ml",
  mililiter: "ml",
  l: "Liter",
  lt: "Liter",
  ltr: "Liter",
  liter: "Liter",
  pcs: "Pcs",
  pc: "Pcs",
  pece: "Pcs",
  biji: "Pcs",
  buah: "Pcs",
  bh: "Pcs",
  lembar: "Pcs",
  lbr: "Pcs",
  btl: "Botol",
  botol: "Botol",
  klg: "Kaleng",
  kaleng: "Kaleng",
  dus: "Dus",
  karton: "Karton",
  ktn: "Karton",
  sachet: "Sachet",
  sct: "Sachet",
  renceng: "Renceng",
  rcg: "Renceng",
  ikat: "Ikat",
  kompan: "Jerigen",
  jerigen: "Jerigen",
  galon: "Galon",
  slop: "Slop",
  rim: "Rim",
  roll: "Roll",
  tray: "Tray",
};

/** Rapikan ejaan satuan. Yang tidak dikenal dikembalikan apa adanya. */
export function normalizeUnitWord(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[.]/g, "");
  return UNIT_ALIASES[key] ?? raw.trim();
}

/* ------------------------------------------------------------------ qty ---- */

/**
 * Baca angka bergaya Indonesia: koma = desimal, titik = pemisah ribuan.
 * "1.500" → 1500, "1,5" → 1.5, "0,25" → 0.25.
 */
export function parseIndonesianQty(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const cleaned = t.replace(/\./g, "").replace(",", ".");
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pisahkan "2 pck" / "250gr" / "1,5 kg" jadi angka + satuan. */
function splitQtyUnit(chunk: string): { qty: number | null; unit: string | null } {
  const t = chunk.trim();
  const m = /^([\d.,]+)\s*(.*)$/.exec(t);
  if (!m) return { qty: null, unit: t || null };
  const qty = parseIndonesianQty(m[1]);
  const unitRaw = m[2].trim();
  return { qty, unit: unitRaw ? normalizeUnitWord(unitRaw) : null };
}

/* --------------------------------------------------------------- cocok ---- */

/** Normalisasi nama untuk pembanding: huruf kecil, tanpa tanda baca ganda. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchIngredient(
  name: string,
  catalog: PasteCandidate[],
): PasteMatch {
  const q = normalizeName(name);
  if (!q) return { kind: "none" };

  const exact = catalog.filter((c) => normalizeName(c.name) === q);
  if (exact.length === 1) {
    return { kind: "exact", ingredientId: exact[0].id, name: exact[0].name };
  }
  if (exact.length > 1) {
    return {
      kind: "ambiguous",
      options: exact.map((c) => ({ id: c.id, name: c.name })),
    };
  }

  /* Cocok sebagian dua arah: "sendok plastik" menemukan "Sendok Plastik
   * Takeaway", dan "ayam fillet paha" menemukan "Ayam Fillet". */
  const partial = catalog.filter((c) => {
    const n = normalizeName(c.name);
    return n.includes(q) || q.includes(n);
  });
  if (partial.length === 1) {
    return { kind: "partial", ingredientId: partial[0].id, name: partial[0].name };
  }
  if (partial.length > 1) {
    return {
      kind: "ambiguous",
      options: partial.map((c) => ({ id: c.id, name: c.name })),
    };
  }
  return { kind: "none" };
}

/**
 * Satuan mana yang sah dipakai untuk bahan ini? Mengembalikan null kalau
 * satuan tulisan staff tidak dikenali bahan tersebut — pemanggil yang
 * memutuskan jatuh ke satuan dasar sambil menandainya untuk diperiksa.
 */
export function resolveUnitForCandidate(
  parsedUnit: string | null,
  candidate: PasteCandidate,
): string | null {
  if (!parsedUnit) return null;
  const want = parsedUnit.trim().toLowerCase();
  const sah = [candidate.unit, ...candidate.packLabels].filter(Boolean);
  const hit = sah.find((u) => u.trim().toLowerCase() === want);
  return hit ?? null;
}

/* ----------------------------------------------------------------- baca ---- */

/**
 * Baca satu baris daftar belanja. Menerima bentuk yang biasa ditulis staff:
 *
 *   "1. sendok plastik - 2 pck"      "daun bawang — 250gr"
 *   "gula 1 kg"                       "sosis : 1 pck"
 */
export function parsePasteLine(
  rawLine: string,
  catalog: PasteCandidate[],
): ParsedPasteLine | null {
  if (isDecorative(rawLine)) return null;
  const line = stripLeadIn(rawLine);
  if (!line) return null;

  /* Pemisah eksplisit dipakai kalau ada — ambil yang PALING KANAN supaya
   * nama bahan yang memuat tanda hubung ("Prep - Sambal Matah") tidak
   * terpotong di tengah. */
  let namePart = line;
  let qtyPart = "";
  const sepMatch = [...line.matchAll(/\s+[-—–:]\s+|\s*:\s+/g)];
  if (sepMatch.length > 0) {
    const last = sepMatch[sepMatch.length - 1];
    namePart = line.slice(0, last.index);
    qtyPart = line.slice(last.index + last[0].length);
  } else {
    /* Tanpa pemisah: potong di angka terakhir yang diikuti satuan/akhir baris. */
    const m = /^(.*?)\s+([\d.,]+\s*[A-Za-z]*)$/.exec(line);
    if (m) {
      namePart = m[1];
      qtyPart = m[2];
    }
  }

  const name = namePart.replace(/[*_~]/g, "").trim();
  if (!name) return null;

  const { qty, unit } = qtyPart ? splitQtyUnit(qtyPart) : { qty: null, unit: null };

  return {
    raw: rawLine.trim(),
    name,
    qty,
    unit,
    match: matchIngredient(name, catalog),
  };
}

/** Baca satu blok teks (boleh seluruh pesan WhatsApp) jadi baris-baris item. */
export function parsePasteList(
  text: string,
  catalog: PasteCandidate[],
): ParsedPasteLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => parsePasteLine(l, catalog))
    .filter((x): x is ParsedPasteLine => x !== null);
}
