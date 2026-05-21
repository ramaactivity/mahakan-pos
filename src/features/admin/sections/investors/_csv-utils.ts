/**
 * Sesi AE-80 follow-up — shared CSV parsing utilities untuk semua importer
 * di modul Modal & Dividen (Investor / Pengelola / Kreditur).
 *
 * Pure functions — no React, no DB. Re-usable di 3 wizard tanpa duplication.
 */

export function parseCsv(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (ch === "," && !inQuote) {
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
  return { headers, rows };
}

export function parseRupiahCell(s: string): number {
  /* "Rp 1,700,000" / "Rp1.700.000" → 1700000. Strip semua non-digit. */
  const cleaned = s.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

export function parseDateCell(s: string): string | null {
  /* Accept variants: "7/1/1996", "02 June 1999", "20 March 2001",
   *  "1999-06-02". Output YYYY-MM-DD atau null kalau gagal. */
  if (!s || s.trim().length === 0) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
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
