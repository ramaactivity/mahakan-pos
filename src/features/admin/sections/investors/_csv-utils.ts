/**
 * Sesi AE-80 follow-up — shared CSV parsing utilities untuk semua importer
 * di modul Modal & Dividen (Investor / Pengelola / Kreditur).
 *
 * Pure functions — no React, no DB. Re-usable di 3 wizard tanpa duplication.
 */

/* Auto-detect delimiter: Excel ID locale exports CSV dengan `;` karena `,`
 * sudah dipakai sebagai pemisah desimal. Tanpa deteksi ini, file Excel ID
 * di-parse jadi 1 kolom per baris → semua index 0 → field validation rusak. */
function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  let inQuote = false;
  let comma = 0;
  let semi = 0;
  let tab = 0;
  for (const ch of headerLine) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === ",") comma++;
    else if (ch === ";") semi++;
    else if (ch === "\t") tab++;
  }
  if (semi > comma && semi >= tab) return ";";
  if (tab > comma && tab > semi) return "\t";
  return ",";
}

export function parseCsv(text: string): {
  headers: string[];
  rows: string[][];
  delimiter: "," | ";" | "\t";
} {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], delimiter: "," };
  const delimiter = detectDelimiter(lines[0]);
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (ch === delimiter && !inQuote) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows, delimiter };
}

export function parseRupiahCell(s: string): number {
  /* "Rp 1,700,000" / "Rp1.700.000" → 1700000. Strip semua non-digit. */
  const cleaned = s.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

export function parseDateCell(s: string): string | null {
  /* Accept variants: "7/1/1996", "02 June 1999", "20 March 2001",
   *  "1999-06-02". Output YYYY-MM-DD atau null kalau gagal.
   *
   * Untuk text dates ("02 June 1999"), JS Date pakai LOCAL timezone.
   * Kalau di-format UTC, di TZ Asia/Jakarta (+07:00) jadi "1999-06-01".
   * Untuk stability cross-TZ, append "T00:00:00Z" supaya pasti UTC. */
  if (!s || s.trim().length === 0) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const yyyy = parseInt(iso[1], 10);
    if (yyyy < 1900 || yyyy > 2100) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  /* Try parsing dengan UTC anchor untuk hindari TZ shift. */
  const d = new Date(`${s} UTC`);
  if (Number.isNaN(d.getTime())) {
    /* Fallback ke local parse kalau "X UTC" gagal. */
    const fallback = new Date(s);
    if (Number.isNaN(fallback.getTime())) return null;
    const fy = fallback.getUTCFullYear();
    if (fy < 1900 || fy > 2100) return null;
    const fmm = String(fallback.getUTCMonth() + 1).padStart(2, "0");
    const fdd = String(fallback.getUTCDate()).padStart(2, "0");
    return `${fy}-${fmm}-${fdd}`;
  }
  const yyyy = d.getUTCFullYear();
  if (yyyy < 1900 || yyyy > 2100) return null;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Parse number cell — "10.5" / "10,5" / "10.5%" → 10.5. */
export function parseDecimalCell(s: string): number | null {
  if (!s || s.trim().length === 0) return null;
  const cleaned = s
    .replace(/%/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.\-]/g, "")
    .trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Deteksi nilai persen yg masuk format Excel "Percent" — underlying value
 * 0..1 (mis. 0,0862 ditampilkan "8,62%"). Kalau semua nilai ≤ 1 DAN sum-nya
 * di sekitar 1.0 (±0.5), kita anggap fraction → caller harus ×100.
 *
 * `expectedSumOne=false` untuk kasus stand-alone (mis. Bunga % per row tidak
 * jumlah ke 100). Cukup cek semua ≤ 1 + ada minimal 1 yg > 0 tapi < 1 (yg
 * curiga banget format Percent).
 */
export function detectFractionScale(
  values: number[],
  opts: { expectedSumOne?: boolean } = {},
): boolean {
  const expectedSumOne = opts.expectedSumOne ?? false;
  const nonNullVals = values.filter((v) => Number.isFinite(v));
  if (nonNullVals.length === 0) return false;
  const allFraction = nonNullVals.every((v) => v >= 0 && v <= 1);
  if (!allFraction) return false;
  if (expectedSumOne) {
    const sum = nonNullVals.reduce((s, v) => s + v, 0);
    return sum > 0.5 && sum < 1.5;
  }
  /* Stand-alone: minimal 1 nilai > 0 tapi < 1 (kalau semua 0 atau semua 1,
   * ambiguous — jangan auto-scale). */
  return nonNullVals.some((v) => v > 0 && v < 1);
}

export function findHeaderIdx(
  headers: string[],
  patterns: string[],
): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    for (const p of patterns) {
      if (h.includes(p.toLowerCase())) return i;
    }
  }
  return -1;
}

/** Convert object[] ke CSV string dengan BOM UTF-8 (Excel-friendly). */
export function rowsToCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const esc = (v: string | number | null | undefined): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [
    headers.map(esc).join(","),
    ...rows.map((r) => r.map(esc).join(",")),
  ].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  /* BOM (﻿) supaya Excel buka CSV dengan UTF-8 (id chars). */
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
