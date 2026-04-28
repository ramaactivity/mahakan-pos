/**
 * CSV I/O helpers wrapping papaparse. Handles UTF-8 BOM (Excel default),
 * trims cells, supports embedded commas/quotes via RFC 4180.
 *
 * parseCsv: returns rows as string-keyed objects; caller validates types.
 * writeCsv: writes header + rows in a deterministic order.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Papa from "papaparse";

export interface ParseResult<T> {
  rows: T[];
  /** 1-indexed row number from the file (header = row 1, first data = row 2). */
  rowNumbers: number[];
  errors: Array<{ row: number; message: string }>;
}

export function parseCsv<T = Record<string, string>>(
  path: string,
): ParseResult<T> {
  if (!existsSync(path)) {
    return { rows: [], rowNumbers: [], errors: [{ row: 0, message: `File not found: ${path}` }] };
  }
  const raw = readFileSync(path, "utf-8");
  // Strip UTF-8 BOM if present (Excel default).
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });

  const errors: ParseResult<T>["errors"] = result.errors.map((e) => ({
    row: (e.row ?? 0) + 2, // papaparse row is 0-indexed past header; +2 for 1-indexed file row
    message: e.message,
  }));

  // Build 1-indexed file row numbers (header row = 1; data rows start at 2).
  const rowNumbers = result.data.map((_, idx) => idx + 2);

  return {
    rows: result.data as unknown as T[],
    rowNumbers,
    errors,
  };
}

export interface WriteCsvOptions {
  /** Columns in output order. */
  headers: string[];
  /** Fail if file already exists (default: false → overwrite). */
  refuseOnExist?: boolean;
}

export function writeCsv<T extends Record<string, unknown>>(
  path: string,
  rows: T[],
  opts: WriteCsvOptions,
): void {
  if (opts.refuseOnExist && existsSync(path)) {
    throw new Error(
      `File exists: ${path} — use --force to overwrite`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  const csv = Papa.unparse(
    {
      fields: opts.headers,
      data: rows.map((r) =>
        opts.headers.map((h) => {
          const v = r[h];
          if (v === null || v === undefined) return "";
          return String(v);
        }),
      ),
    },
    {
      // LF newlines for git-friendly diffs; papaparse default is CRLF.
      newline: "\n",
      // Default quoting: auto-quote cells containing delimiter, quote, or newline.
    },
  );
  // Trailing newline per POSIX convention.
  writeFileSync(path, csv.endsWith("\n") ? csv : `${csv}\n`, "utf-8");
}
