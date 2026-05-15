/**
 * Sesi AE-62 — Pure CSV parser untuk import data historis Majoo/Kasir Pintar.
 *
 * Tidak ada server dependency — testable lewat Vitest. Parser handle:
 *   - Quoted fields with commas
 *   - DD/MM/YYYY (Majoo default) atau YYYY-MM-DD ISO format
 *   - Decimal separator "." atau ","
 *   - Thousand separator (titik atau koma) — di-strip otomatis
 *   - Header auto-detect (`suggestColumnMapping`) untuk wizard UX
 *
 * Format Majoo umum (yang owner share):
 *   Tanggal, Total Penjualan, Refund, Diskon, Total Bersih, Jumlah Transaksi,
 *   Tunai, QRIS, EDC, GoFood, GrabFood, ShopeeFood
 *
 * Output: ParsedRow[] sudah normalized + warnings (gap, duplicate, dll).
 */

/** Field mapping: nama field internal → nama kolom di CSV. */
export interface CsvColumnMapping {
  /** Wajib: nama kolom tanggal. */
  date: string;
  // Revenue fields (semua optional — kalau missing, default 0)
  grossRevenue?: string;
  totalRefund?: string;
  totalVoid?: string;
  totalDiscount?: string;
  netRevenue?: string;
  transactionCount?: string;
  cogs?: string;
  // Cash flow per channel
  cashIn?: string;
  qrisIn?: string;
  edcIn?: string;
  aggregatorIn?: string;
}

export interface ParseOptions {
  /** Default: auto-detect. Eksplisit kalau wizard kasih pilihan ke user. */
  dateFormat?: "YYYY-MM-DD" | "DD/MM/YYYY" | "auto";
  /** Default: auto. Decimal "." atau "," (Indonesia biasa pakai ","). */
  decimalSeparator?: "." | "," | "auto";
}

export interface ParsedRow {
  businessDate: string; // ISO YYYY-MM-DD
  grossRevenue: number;
  totalRefund: number;
  totalVoid: number;
  totalDiscount: number;
  netRevenue: number;
  transactionCount: number;
  cogs: number;
  cashIn: number;
  qrisIn: number;
  edcIn: number;
  aggregatorIn: number;
  /** Baris asli di CSV (1-indexed, exclude header). Untuk UI error reporting. */
  rowIndex: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  warnings: string[];
  errors: string[];
}

/* -------------------------------------------------------------------------- */
/* CSV row tokenizer — handle quoted fields with commas                       */
/* -------------------------------------------------------------------------- */

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double-quote inside quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

/* -------------------------------------------------------------------------- */
/* Number parsing — handle Indonesian "1.250.000,50" + English "1,250,000.50" */
/* -------------------------------------------------------------------------- */

/** Parse number tolerant: strip thousand separators, normalize decimal.
 *  Empty string → 0. Returns NaN kalau invalid. */
export function parseNumberTolerant(
  raw: string,
  decimalSep: "." | "," | "auto" = "auto",
): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  // Strip leading "Rp", trailing currency, whitespace, parens (negative bracket)
  let s = trimmed.replace(/^Rp\.?\s*/i, "").replace(/[()]/g, "");
  const isNegative = trimmed.startsWith("(") || trimmed.startsWith("-");
  s = s.replace(/^-/, "");

  let resolvedSep: "." | "," = ".";
  if (decimalSep === "auto") {
    // Heuristic kalau ada keduanya: separator yang TERAKHIR muncul = decimal
    // (misal "1.250.000,75" → koma decimal; "1,250,000.75" → titik decimal).
    // Kalau cuma 1 jenis: tergantung pola digit setelah separator terakhir
    // dan jumlah occurrences.
    const hasComma = s.includes(",");
    const hasDot = s.includes(".");
    if (hasComma && hasDot) {
      resolvedSep = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    } else if (hasComma && !hasDot) {
      // Komma alone:
      //   - Multiple commas (mis. "1,250,000") → thousand separator
      //   - Single comma + 3 digit suffix (mis. "1,000") → thousand
      //   - Single comma + non-3 digits (mis. "1,5" / "1,75") → decimal
      const commaCount = (s.match(/,/g) || []).length;
      const lastComma = s.lastIndexOf(",");
      const afterComma = s.slice(lastComma + 1);
      resolvedSep = commaCount > 1 || afterComma.length === 3 ? "." : ",";
    } else if (hasDot && !hasComma) {
      // Titik alone (sama logic as komma alone):
      //   - Multiple dots (mis. "1.250.000") → thousand separator (id-ID)
      //   - Single dot + 3 digit suffix (mis. "1.000") → thousand (ambigu, anggap id-ID)
      //   - Single dot + non-3 digits (mis. "1.5" / "1.75") → decimal
      const dotCount = (s.match(/\./g) || []).length;
      const lastDot = s.lastIndexOf(".");
      const afterDot = s.slice(lastDot + 1);
      // dotCount > 1 → pasti thousand (id-ID). afterDot.length === 3 → ambigu,
      // assume thousand (Mahakan = id-ID context).
      resolvedSep = dotCount > 1 || afterDot.length === 3 ? "," : ".";
    } else {
      resolvedSep = ".";
    }
  } else {
    resolvedSep = decimalSep;
  }

  if (resolvedSep === ",") {
    // Indonesian: titik = thousand, koma = decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // English: koma = thousand, titik = decimal
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!isFinite(n)) return NaN;
  return isNegative ? -n : n;
}

/* -------------------------------------------------------------------------- */
/* Date parsing                                                                */
/* -------------------------------------------------------------------------- */

/** Parse tanggal ke ISO YYYY-MM-DD. Return null kalau invalid. */
export function parseDateTolerant(
  raw: string,
  format: "YYYY-MM-DD" | "DD/MM/YYYY" | "auto" = "auto",
): string | null {
  const t = raw.trim();
  if (!t) return null;

  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) {
    const [, y, m, d] = iso;
    if (isValidDateParts(+y!, +m!, +d!)) return `${y}-${m}-${d}`;
  }
  if (format === "YYYY-MM-DD") return null;

  // DD/MM/YYYY or D/M/YYYY (slash or dash separator)
  const ddmm = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(t);
  if (ddmm) {
    const [, d, m, y] = ddmm;
    const yNum = +y!;
    const yy = yNum < 100 ? 2000 + yNum : yNum;
    const mm = String(+m!).padStart(2, "0");
    const dd = String(+d!).padStart(2, "0");
    if (isValidDateParts(yy, +m!, +d!)) return `${yy}-${mm}-${dd}`;
  }
  return null;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 2000 || year > 2100) return false;
  // Last-day-of-month check via Date round-trip
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/* -------------------------------------------------------------------------- */
/* Column mapping auto-detect                                                  */
/* -------------------------------------------------------------------------- */

/** Heuristic match header CSV → internal field. Case-insensitive substring. */
export function suggestColumnMapping(
  headers: string[],
): Partial<CsvColumnMapping> {
  const norm = headers.map((h) => h.toLowerCase().trim());
  const mapping: Partial<CsvColumnMapping> = {};
  const find = (...patterns: string[]): string | undefined => {
    for (const p of patterns) {
      const idx = norm.findIndex((h) => h.includes(p));
      if (idx >= 0) return headers[idx];
    }
    return undefined;
  };
  mapping.date = find("tanggal", "date", "day");
  mapping.grossRevenue = find(
    "total penjualan",
    "gross",
    "penjualan bruto",
    "omzet",
  );
  mapping.netRevenue = find(
    "total bersih",
    "net revenue",
    "pendapatan bersih",
    "net",
  );
  mapping.totalRefund = find("refund", "retur", "pengembalian");
  mapping.totalVoid = find("void", "pembatalan");
  mapping.totalDiscount = find("diskon", "discount", "potongan");
  mapping.transactionCount = find(
    "jumlah transaksi",
    "transaction count",
    "trx count",
    "total transaksi",
  );
  mapping.cogs = find("hpp", "cogs", "harga pokok");
  mapping.cashIn = find("tunai", "cash");
  mapping.qrisIn = find("qris");
  mapping.edcIn = find("edc", "debit", "kartu");
  mapping.aggregatorIn = find(
    "gofood",
    "grabfood",
    "shopeefood",
    "aggregator",
    "online food",
  );
  return mapping;
}

/* -------------------------------------------------------------------------- */
/* Main parser                                                                 */
/* -------------------------------------------------------------------------- */

export function parseHistoricalCsv(
  csvText: string,
  mapping: CsvColumnMapping,
  options: ParseOptions = {},
): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  const lines = csvText
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    errors.push("CSV kosong atau cuma punya header — minimal 1 baris data.");
    return { rows, warnings, errors };
  }

  const headers = parseCsvLine(lines[0]!);
  const dateIdx = headers.indexOf(mapping.date);
  if (dateIdx < 0) {
    errors.push(
      `Kolom tanggal "${mapping.date}" tidak ditemukan di header. Header tersedia: ${headers.join(", ")}`,
    );
    return { rows, warnings, errors };
  }

  // Resolve all column indices once
  const idx: Record<keyof Omit<ParsedRow, "rowIndex" | "businessDate">, number> =
    {
      grossRevenue: mapping.grossRevenue
        ? headers.indexOf(mapping.grossRevenue)
        : -1,
      totalRefund: mapping.totalRefund
        ? headers.indexOf(mapping.totalRefund)
        : -1,
      totalVoid: mapping.totalVoid ? headers.indexOf(mapping.totalVoid) : -1,
      totalDiscount: mapping.totalDiscount
        ? headers.indexOf(mapping.totalDiscount)
        : -1,
      netRevenue: mapping.netRevenue ? headers.indexOf(mapping.netRevenue) : -1,
      transactionCount: mapping.transactionCount
        ? headers.indexOf(mapping.transactionCount)
        : -1,
      cogs: mapping.cogs ? headers.indexOf(mapping.cogs) : -1,
      cashIn: mapping.cashIn ? headers.indexOf(mapping.cashIn) : -1,
      qrisIn: mapping.qrisIn ? headers.indexOf(mapping.qrisIn) : -1,
      edcIn: mapping.edcIn ? headers.indexOf(mapping.edcIn) : -1,
      aggregatorIn: mapping.aggregatorIn
        ? headers.indexOf(mapping.aggregatorIn)
        : -1,
    };

  const seenDates = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const dateRaw = cells[dateIdx] ?? "";
    const businessDate = parseDateTolerant(dateRaw, options.dateFormat);
    if (!businessDate) {
      errors.push(
        `Baris ${i + 1}: tanggal "${dateRaw}" tidak valid (expected DD/MM/YYYY atau YYYY-MM-DD)`,
      );
      continue;
    }
    if (seenDates.has(businessDate)) {
      warnings.push(
        `Tanggal duplikat di baris ${i + 1}: ${businessDate}. Yang terakhir di-import akan menimpa.`,
      );
    }
    seenDates.add(businessDate);

    const num = (key: keyof typeof idx): number => {
      if (idx[key] < 0) return 0;
      const raw = cells[idx[key]] ?? "";
      const n = parseNumberTolerant(raw, options.decimalSeparator);
      if (isNaN(n)) {
        errors.push(
          `Baris ${i + 1}: nilai "${raw}" di kolom ${key} bukan angka valid`,
        );
        return 0;
      }
      return n;
    };

    let grossRevenue = num("grossRevenue");
    const totalRefund = num("totalRefund");
    const totalVoid = num("totalVoid");
    const totalDiscount = num("totalDiscount");
    let netRevenue = num("netRevenue");
    const transactionCount = Math.max(0, Math.trunc(num("transactionCount")));
    const cogs = num("cogs");
    const cashIn = num("cashIn");
    const qrisIn = num("qrisIn");
    const edcIn = num("edcIn");
    const aggregatorIn = num("aggregatorIn");

    // Auto-fill missing gross/net dari yang ada
    if (grossRevenue === 0 && netRevenue > 0) {
      grossRevenue = netRevenue + totalRefund + totalVoid + totalDiscount;
    }
    if (netRevenue === 0 && grossRevenue > 0) {
      netRevenue = Math.max(
        0,
        grossRevenue - totalRefund - totalVoid - totalDiscount,
      );
    }

    // Floor negative → 0
    rows.push({
      businessDate,
      grossRevenue: Math.max(0, Math.round(grossRevenue)),
      totalRefund: Math.max(0, Math.round(totalRefund)),
      totalVoid: Math.max(0, Math.round(totalVoid)),
      totalDiscount: Math.max(0, Math.round(totalDiscount)),
      netRevenue: Math.max(0, Math.round(netRevenue)),
      transactionCount,
      cogs: Math.max(0, Math.round(cogs)),
      cashIn: Math.max(0, Math.round(cashIn)),
      qrisIn: Math.max(0, Math.round(qrisIn)),
      edcIn: Math.max(0, Math.round(edcIn)),
      aggregatorIn: Math.max(0, Math.round(aggregatorIn)),
      rowIndex: i,
    });
  }

  // Gap detection
  if (rows.length > 1) {
    const sorted = [...rows].sort((a, b) =>
      a.businessDate.localeCompare(b.businessDate),
    );
    const dates = sorted.map((r) => r.businessDate);
    const gaps = detectGaps(dates);
    for (const g of gaps) {
      warnings.push(
        `Ada gap ${g.days} hari antara ${g.from} dan ${g.to} (mungkin outlet tutup, atau data Majoo missing).`,
      );
    }
  }

  return { rows, warnings, errors };
}

/** Detect gap antara dates terurut. Return list { from, to, days }. */
export function detectGaps(
  dates: string[],
): Array<{ from: string; to: string; days: number }> {
  const gaps: Array<{ from: string; to: string; days: number }> = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1]!;
    const cur = dates[i]!;
    const diff = dayDiff(prev, cur);
    if (diff > 1) {
      gaps.push({ from: prev, to: cur, days: diff - 1 });
    }
  }
  return gaps;
}

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.UTC(
    +fromIso.slice(0, 4),
    +fromIso.slice(5, 7) - 1,
    +fromIso.slice(8, 10),
  );
  const b = Date.UTC(
    +toIso.slice(0, 4),
    +toIso.slice(5, 7) - 1,
    +toIso.slice(8, 10),
  );
  return Math.round((b - a) / 86400000);
}
