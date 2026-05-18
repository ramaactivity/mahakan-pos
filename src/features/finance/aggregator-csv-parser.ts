/**
 * Sesi AE-62q — Pure parser untuk CSV/Excel export dari aggregator apps
 * (GoFood/GrabFood/ShopeeFood).
 *
 * Goal: terima CSV string + kolom mapping → array of settlement rows.
 * Format aggregator sering berubah, jadi parser harus FLEXIBLE:
 *  - Auto-detect header row (cari kolom yang match keyword common)
 *  - Allow manual column override
 *  - Support 2 aggregation modes: per-day vs single-period (total semua row)
 *
 * No DB, no React. Testable as pure function.
 */
import Papa from "papaparse";

export interface CsvColumnMapping {
  /** Index/header name untuk kolom tanggal. */
  dateColumn: number | string;
  /** Index/header name untuk gross/omset. */
  grossColumn: number | string;
  /** Optional fee column. Kalau missing, fee default 0. */
  feeColumn?: number | string;
  /** Optional net column (kalau ada, override gross-fee compute). */
  netColumn?: number | string;
}

export interface ParsedSettlementRow {
  /** ISO date (YYYY-MM-DD WIB). */
  date: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  /** Original row index untuk error tracing. */
  sourceRowIndex: number;
}

export interface ParseCsvResult {
  rows: ParsedSettlementRow[];
  /** Detected header row (kalau auto-detect berhasil). */
  detectedHeaders: string[] | null;
  /** Total row di file (termasuk yang gagal parse). */
  totalRowCount: number;
  /** Row yang gagal parse (e.g., date invalid, gross NaN). */
  errors: Array<{ rowIndex: number; message: string }>;
}

export interface AggregateResult {
  date: string;
  periodFrom: string;
  periodTo: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  rowCount: number;
}

/**
 * Common keywords untuk auto-detect header columns. Lower-cased match.
 */
const KEYWORD_DATE = [
  "tanggal",
  "date",
  "tgl",
  "waktu",
  "datetime",
  "transaction date",
  "order date",
  "order_date",
];
const KEYWORD_GROSS = [
  "gross",
  "omset",
  "omzet",
  "total",
  "subtotal",
  "amount",
  "nominal",
  "harga",
];
const KEYWORD_FEE = [
  "fee",
  "komisi",
  "commission",
  "potongan",
  "biaya",
  "service",
  "mdr",
];
const KEYWORD_NET = [
  "net",
  "bersih",
  "diterima",
  "received",
  "settlement",
  "payout",
];

/**
 * Auto-detect kolom dari header row. Returns mapping kalau cukup confident.
 * Kalau gagal detect kolom mandatory (date / gross), return null.
 */
export function autoDetectColumns(
  headers: string[],
): CsvColumnMapping | null {
  const normalized = headers.map((h) => h.trim().toLowerCase());

  function findByKeywords(keywords: string[]): number | null {
    for (let i = 0; i < normalized.length; i++) {
      const h = normalized[i];
      if (keywords.some((kw) => h.includes(kw))) return i;
    }
    return null;
  }

  const dateIdx = findByKeywords(KEYWORD_DATE);
  const grossIdx = findByKeywords(KEYWORD_GROSS);
  const feeIdx = findByKeywords(KEYWORD_FEE);
  const netIdx = findByKeywords(KEYWORD_NET);

  if (dateIdx === null || grossIdx === null) return null;
  return {
    dateColumn: dateIdx,
    grossColumn: grossIdx,
    feeColumn: feeIdx ?? undefined,
    netColumn: netIdx ?? undefined,
  };
}

/**
 * Parse Indonesian-formatted date string into ISO YYYY-MM-DD.
 *
 * Supports:
 *  - "2026-05-15" / "2026/05/15" / "2026.05.15"
 *  - "15-05-2026" / "15/05/2026" / "15 Mei 2026"
 *  - With time suffix: "2026-05-15 14:30:00"
 *  - Excel serial date number (e.g., 45437)
 */
export function parseIndonesianDate(raw: string | number): string | null {
  if (typeof raw === "number") {
    // Excel serial: days since 1900-01-01 (with 1900-leap bug, so origin = 1899-12-30)
    if (raw < 1 || raw > 100000) return null;
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = raw.trim();
  if (!s) return null;
  // Strip time suffix only kalau ada T separator atau time-like pattern
  // (e.g., " 14:30:00"). JANGAN split on plain whitespace karena format
  // "15 Mei 2026" pakai space separator.
  let dateOnly = s;
  const tIdx = dateOnly.indexOf("T");
  if (tIdx > 0) dateOnly = dateOnly.slice(0, tIdx);
  const timeMatch = dateOnly.match(/^(.+?)\s+\d{1,2}:\d{2}/);
  if (timeMatch) dateOnly = timeMatch[1];

  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  const ymdMatch = dateOnly.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY
  const dmyMatch = dateOnly.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // DD Month YYYY (Indonesian month names)
  const months: Record<string, string> = {
    jan: "01",
    januari: "01",
    feb: "02",
    februari: "02",
    mar: "03",
    maret: "03",
    apr: "04",
    april: "04",
    mei: "05",
    may: "05",
    jun: "06",
    juni: "06",
    jul: "07",
    juli: "07",
    agu: "08",
    agustus: "08",
    sep: "09",
    september: "09",
    okt: "10",
    oktober: "10",
    nov: "11",
    november: "11",
    des: "12",
    desember: "12",
  };
  const dmyTextMatch = dateOnly.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (dmyTextMatch) {
    const [, d, monStr, y] = dmyTextMatch;
    const m = months[monStr.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }
  return null;
}

/**
 * Parse rupiah string ke number. Strip "Rp", spaces, thousand separators
 * (titik atau koma).
 */
export function parseRupiahLoose(raw: string | number): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.round(raw) : null;
  }
  const s = raw.trim();
  if (!s) return null;
  // Strip Rp + spaces
  let cleaned = s.replace(/rp\.?/gi, "").trim();
  // Handle negative
  const isNegative = cleaned.startsWith("-") || cleaned.startsWith("(");
  cleaned = cleaned.replace(/^[-(]|[)]$/g, "");
  // Strip all non-digit (Indonesia/Western thousand separators all ignored)
  cleaned = cleaned.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  if (!Number.isFinite(n)) return null;
  return isNegative ? -n : n;
}

/**
 * Parse raw CSV string into ParsedSettlementRow[]. Auto-detect columns
 * kalau mapping not provided. Skip header + blank rows.
 */
export function parseAggregatorCsv(
  csv: string,
  options: {
    mapping?: CsvColumnMapping;
    /** True = skip first row (header). Default true. */
    hasHeader?: boolean;
  } = {},
): ParseCsvResult {
  const { mapping: providedMapping, hasHeader = true } = options;

  // Papa parse with auto-detect delimiter, no header (we handle manually).
  const result = Papa.parse<string[]>(csv.trim(), {
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const rows = result.data;
  if (rows.length === 0) {
    return {
      rows: [],
      detectedHeaders: null,
      totalRowCount: 0,
      errors: [{ rowIndex: 0, message: "File CSV kosong" }],
    };
  }

  let mapping = providedMapping;
  let detectedHeaders: string[] | null = null;
  let dataStartIndex = 0;

  if (hasHeader) {
    detectedHeaders = rows[0];
    dataStartIndex = 1;
    if (!mapping) {
      mapping = autoDetectColumns(detectedHeaders) ?? undefined;
    }
  }

  if (!mapping) {
    return {
      rows: [],
      detectedHeaders,
      totalRowCount: rows.length,
      errors: [
        {
          rowIndex: 0,
          message:
            "Gagal auto-detect kolom Tanggal + Gross. Mohon set kolom manual.",
        },
      ],
    };
  }

  // Resolve column header names → indices
  const resolveCol = (col: number | string): number => {
    if (typeof col === "number") return col;
    if (detectedHeaders) {
      const idx = detectedHeaders.findIndex(
        (h) => h.trim().toLowerCase() === col.trim().toLowerCase(),
      );
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const dateColIdx = resolveCol(mapping.dateColumn);
  const grossColIdx = resolveCol(mapping.grossColumn);
  const feeColIdx =
    mapping.feeColumn !== undefined ? resolveCol(mapping.feeColumn) : -1;
  const netColIdx =
    mapping.netColumn !== undefined ? resolveCol(mapping.netColumn) : -1;

  if (dateColIdx < 0 || grossColIdx < 0) {
    return {
      rows: [],
      detectedHeaders,
      totalRowCount: rows.length,
      errors: [
        {
          rowIndex: 0,
          message: `Kolom mapping invalid: dateColumn=${mapping.dateColumn}, grossColumn=${mapping.grossColumn}`,
        },
      ],
    };
  }

  const parsedRows: ParsedSettlementRow[] = [];
  const errors: Array<{ rowIndex: number; message: string }> = [];

  for (let i = dataStartIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    if (row.every((c) => !c || !c.trim())) continue;

    const dateRaw = row[dateColIdx];
    const grossRaw = row[grossColIdx];
    const date = parseIndonesianDate(dateRaw);
    const gross = parseRupiahLoose(grossRaw);

    if (!date) {
      errors.push({
        rowIndex: i + 1, // human-friendly 1-indexed
        message: `Tanggal invalid: "${dateRaw}"`,
      });
      continue;
    }
    if (gross == null || gross < 0) {
      errors.push({
        rowIndex: i + 1,
        message: `Gross invalid: "${grossRaw}"`,
      });
      continue;
    }

    let fee = 0;
    if (feeColIdx >= 0) {
      const feeRaw = row[feeColIdx];
      const parsedFee = parseRupiahLoose(feeRaw);
      if (parsedFee != null && parsedFee >= 0) {
        fee = parsedFee;
      }
    }

    let net: number;
    if (netColIdx >= 0) {
      const netRaw = row[netColIdx];
      const parsedNet = parseRupiahLoose(netRaw);
      net = parsedNet ?? gross - fee;
    } else {
      net = gross - fee;
    }

    parsedRows.push({
      date,
      grossAmount: gross,
      feeAmount: fee,
      netAmount: net,
      sourceRowIndex: i + 1,
    });
  }

  return {
    rows: parsedRows,
    detectedHeaders,
    totalRowCount: rows.length,
    errors,
  };
}

/**
 * Aggregate parsed rows per-day. Returns array of daily settlements.
 *
 * Use case: aggregator export per-order, owner mau bikin 1 settlement per
 * hari (kurangi clutter di journal + cocok dengan bank settlement yang
 * biasanya per hari).
 */
export function aggregateDaily(
  rows: ParsedSettlementRow[],
): AggregateResult[] {
  const byDate = new Map<
    string,
    { gross: number; fee: number; net: number; count: number }
  >();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { gross: 0, fee: 0, net: 0, count: 0 };
    cur.gross += r.grossAmount;
    cur.fee += r.feeAmount;
    cur.net += r.netAmount;
    cur.count += 1;
    byDate.set(r.date, cur);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({
      date,
      periodFrom: date,
      periodTo: date,
      grossAmount: agg.gross,
      feeAmount: agg.fee,
      netAmount: agg.net,
      rowCount: agg.count,
    }));
}

/**
 * Aggregate all rows into single period (min..max date).
 *
 * Use case: owner mau bikin 1 settlement total per bulan dari export
 * bulanan (lebih simple, less rows di journal).
 */
export function aggregateSinglePeriod(
  rows: ParsedSettlementRow[],
): AggregateResult | null {
  if (rows.length === 0) return null;
  let gross = 0;
  let fee = 0;
  let net = 0;
  let minDate = rows[0].date;
  let maxDate = rows[0].date;
  for (const r of rows) {
    gross += r.grossAmount;
    fee += r.feeAmount;
    net += r.netAmount;
    if (r.date < minDate) minDate = r.date;
    if (r.date > maxDate) maxDate = r.date;
  }
  return {
    date: minDate,
    periodFrom: minDate,
    periodTo: maxDate,
    grossAmount: gross,
    feeAmount: fee,
    netAmount: net,
    rowCount: rows.length,
  };
}
