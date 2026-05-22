/**
 * Sesi AE-112 — CSV import/export utilities untuk bahan (ingredients).
 *
 * Owner workflow:
 *   1. Download CSV → snapshot current bahan
 *   2. Edit di Google Sheets / Excel
 *   3. Upload CSV → bulk update (name, section, unit, cost, threshold, notes)
 *
 * SAFETY RULES:
 *   - `current_stock` di CSV READ-ONLY — di-IGNORE saat import. Stock changes
 *     wajib via Opname supaya inventory_movements audit trail konsisten.
 *   - `id` kosong = create new bahan; `id` match = update existing
 *   - Row yang missing dari upload TIDAK di-delete (preserved)
 *   - isPreparation, alternativeUnits TIDAK editable via CSV (kompleks)
 *   - Atomic transaction — all rows succeed or all rollback
 *
 * Pure functions: no DB access here. Caller (server action) handle persistence.
 */

const SECTIONS = ["kitchen", "bar", "supporting", "cleaning"] as const;
export type Section = (typeof SECTIONS)[number] | null;

export interface IngredientCsvRow {
  id: string | null;
  name: string;
  section: Section;
  unit: string;
  costPerUnit: number;
  currentStock: number; // display only (read on export, ignored on import)
  threshold: number | null;
  notes: string | null;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ParsedRow {
  rowNumber: number; // 1-indexed (excluding header)
  raw: Record<string, string>;
  parsed: IngredientCsvRow | null;
  errors: ValidationError[];
  /** Matching existing ingredient by id (if id provided and found). */
  existingId: string | null;
}

export interface ParseResult {
  rows: ParsedRow[];
  errorCount: number;
  /** Headers found in first non-comment row. */
  headers: string[];
}

// ──────────────────────────────────────────────────────────────────
// EXPORT (serialize)
// ──────────────────────────────────────────────────────────────────

export interface IngredientForExport {
  id: string;
  name: string;
  section: string | null;
  unit: string;
  costPerUnit: number;
  currentStockDecimal: string; // "1.0000" etc
  reorderThreshold: number | null;
  notes: string | null;
}

/**
 * Generate CSV string with UTF-8 BOM (Excel/Sheets compatible).
 * Sort by section (null last), then name.
 */
export function serializeIngredientsCsv(
  ingredients: IngredientForExport[],
  meta: { generatedAt: Date; outletName: string },
): string {
  const sorted = [...ingredients].sort((a, b) => {
    const sa = a.section ?? "zzz";
    const sb = b.section ?? "zzz";
    if (sa !== sb) return sa.localeCompare(sb);
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  // Comment header (will be ignored on import — lines starting with #)
  lines.push(
    `# Generated ${meta.generatedAt.toISOString()} | Outlet: ${meta.outletName} | Total: ${sorted.length} bahan`,
  );
  lines.push(
    `# SAFETY: current_stock column is READ-ONLY on import. Stock changes must use Opname feature.`,
  );
  lines.push(
    `# Empty 'id' creates a new bahan. Matching 'id' updates existing.`,
  );
  // Data header
  lines.push(
    [
      "id",
      "name",
      "section",
      "unit",
      "cost_per_unit",
      "current_stock",
      "threshold",
      "notes",
    ].join(","),
  );

  for (const r of sorted) {
    lines.push(
      [
        r.id,
        csvEscape(r.name),
        r.section ?? "",
        csvEscape(r.unit),
        String(r.costPerUnit),
        // Show decimal stock (read-only)
        r.currentStockDecimal,
        r.reorderThreshold !== null ? String(r.reorderThreshold) : "",
        csvEscape(r.notes ?? ""),
      ].join(","),
    );
  }

  // UTF-8 BOM prefix supaya Excel detect encoding correctly
  return "﻿" + lines.join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (value === "") return "";
  const needsQuote =
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

// ──────────────────────────────────────────────────────────────────
// IMPORT (parse + validate)
// ──────────────────────────────────────────────────────────────────

/**
 * Parse CSV text into rows with per-row validation.
 *
 * Format expectations:
 *   - UTF-8 (BOM optional)
 *   - Lines starting with `#` are comments (skipped)
 *   - First non-comment line = header
 *   - Quote-escape standard CSV (RFC 4180)
 */
export function parseIngredientsCsv(text: string): ParseResult {
  // Strip BOM
  const cleaned = text.replace(/^﻿/, "");
  const rawLines = cleaned.split(/\r?\n/);

  // Skip empty + comment lines
  const dataLines: Array<{ lineIdx: number; line: string }> = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    dataLines.push({ lineIdx: i, line: rawLines[i] });
  }

  if (dataLines.length === 0) {
    return { rows: [], errorCount: 0, headers: [] };
  }

  const headers = parseCsvLine(dataLines[0].line).map((h) => h.trim());

  const expectedHeaders = [
    "id",
    "name",
    "section",
    "unit",
    "cost_per_unit",
    "current_stock",
    "threshold",
    "notes",
  ];

  // Check required headers (name, unit minimum)
  if (!headers.includes("name") || !headers.includes("unit")) {
    return {
      rows: [
        {
          rowNumber: 0,
          raw: {},
          parsed: null,
          errors: [
            {
              field: "header",
              message: `CSV header missing required columns. Expected: ${expectedHeaders.join(", ")}`,
            },
          ],
          existingId: null,
        },
      ],
      errorCount: 1,
      headers,
    };
  }

  const result: ParsedRow[] = [];
  let errorCount = 0;

  for (let i = 1; i < dataLines.length; i++) {
    const cells = parseCsvLine(dataLines[i].line);
    const raw: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      raw[headers[h]] = (cells[h] ?? "").trim();
    }

    const errors: ValidationError[] = [];

    // Required: name
    const name = raw.name ?? "";
    if (name.length === 0) {
      errors.push({ field: "name", message: "name wajib diisi" });
    } else if (name.length > 200) {
      errors.push({ field: "name", message: "name maksimal 200 karakter" });
    }

    // Required: unit
    const unit = raw.unit ?? "";
    if (unit.length === 0) {
      errors.push({ field: "unit", message: "unit wajib diisi" });
    } else if (unit.length > 20) {
      errors.push({ field: "unit", message: "unit maksimal 20 karakter" });
    }

    // section optional, but must be enum if provided
    let section: Section = null;
    const sectionRaw = (raw.section ?? "").toLowerCase();
    if (sectionRaw === "" || sectionRaw === "null") {
      section = null;
    } else if (
      sectionRaw === "kitchen" ||
      sectionRaw === "bar" ||
      sectionRaw === "supporting" ||
      sectionRaw === "cleaning"
    ) {
      section = sectionRaw as Section;
    } else {
      errors.push({
        field: "section",
        message: `section invalid '${raw.section}'. Harus: kitchen/bar/supporting/cleaning atau kosong`,
      });
    }

    // cost_per_unit: integer >= 0
    const costRaw = raw.cost_per_unit ?? raw["cost_per_unit"] ?? "0";
    const cost = Number(costRaw);
    if (!Number.isFinite(cost) || cost < 0 || !Number.isInteger(cost)) {
      errors.push({
        field: "cost_per_unit",
        message: `cost_per_unit harus integer >= 0 (got '${costRaw}')`,
      });
    }

    // threshold: integer >= 0 OR empty
    let threshold: number | null = null;
    const thresholdRaw = raw.threshold ?? "";
    if (thresholdRaw !== "") {
      const t = Number(thresholdRaw);
      if (!Number.isFinite(t) || t < 0 || !Number.isInteger(t)) {
        errors.push({
          field: "threshold",
          message: `threshold harus integer >= 0 atau kosong (got '${thresholdRaw}')`,
        });
      } else {
        threshold = t;
      }
    }

    // notes: optional string
    const notes = raw.notes && raw.notes.length > 0 ? raw.notes : null;

    // id: optional UUID
    const idRaw = (raw.id ?? "").trim();
    const id = idRaw === "" ? null : idRaw;
    if (id !== null && !isUuidLike(id)) {
      errors.push({
        field: "id",
        message: `id tidak valid UUID format (got '${id}'). Kosongkan untuk create new bahan.`,
      });
    }

    const parsed: IngredientCsvRow | null =
      errors.length === 0
        ? {
            id,
            name,
            section,
            unit,
            costPerUnit: cost,
            currentStock: 0, // read-only — ignored on import
            threshold,
            notes,
          }
        : null;

    if (errors.length > 0) errorCount++;

    result.push({
      rowNumber: i, // 1-indexed (after header)
      raw,
      parsed,
      errors,
      existingId: id, // caller will verify exists in DB
    });
  }

  return { rows: result, errorCount, headers };
}

/**
 * Minimal CSV line parser — handles quote-escaping.
 * Per RFC 4180.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ",") {
        result.push(current);
        current = "";
      } else if (ch === '"' && current === "") {
        inQuote = true;
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

// ──────────────────────────────────────────────────────────────────
// DIFF (for preview)
// ──────────────────────────────────────────────────────────────────

export interface ExistingIngredientLite {
  id: string;
  name: string;
  section: string | null;
  unit: string;
  costPerUnit: number;
  reorderThreshold: number | null;
  notes: string | null;
}

export type RowAction = "create" | "update" | "unchanged" | "error";

export interface RowDiff {
  rowNumber: number;
  action: RowAction;
  parsed: IngredientCsvRow | null;
  errors: ValidationError[];
  changedFields: string[];
  existingId: string | null;
}

/**
 * Compute diff between parsed rows and existing ingredients in DB.
 * Used for preview screen before commit.
 */
export function computeDiff(
  parsed: ParseResult,
  existing: ExistingIngredientLite[],
): {
  rows: RowDiff[];
  summary: {
    create: number;
    update: number;
    unchanged: number;
    error: number;
    total: number;
  };
} {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const rows: RowDiff[] = [];
  let create = 0;
  let update = 0;
  let unchanged = 0;
  let error = 0;

  for (const r of parsed.rows) {
    if (r.errors.length > 0 || !r.parsed) {
      rows.push({
        rowNumber: r.rowNumber,
        action: "error",
        parsed: r.parsed,
        errors: r.errors,
        changedFields: [],
        existingId: r.existingId,
      });
      error++;
      continue;
    }

    if (!r.parsed.id) {
      rows.push({
        rowNumber: r.rowNumber,
        action: "create",
        parsed: r.parsed,
        errors: [],
        changedFields: [],
        existingId: null,
      });
      create++;
      continue;
    }

    const ex = byId.get(r.parsed.id);
    if (!ex) {
      rows.push({
        rowNumber: r.rowNumber,
        action: "error",
        parsed: r.parsed,
        errors: [
          {
            field: "id",
            message: `id '${r.parsed.id}' tidak ada di database. Kosongkan untuk create baru, atau cek typo.`,
          },
        ],
        changedFields: [],
        existingId: r.parsed.id,
      });
      error++;
      continue;
    }

    const changed: string[] = [];
    if (ex.name !== r.parsed.name) changed.push("name");
    if (ex.section !== r.parsed.section) changed.push("section");
    if (ex.unit !== r.parsed.unit) changed.push("unit");
    if (ex.costPerUnit !== r.parsed.costPerUnit) changed.push("cost_per_unit");
    if ((ex.reorderThreshold ?? null) !== (r.parsed.threshold ?? null))
      changed.push("threshold");
    if ((ex.notes ?? null) !== (r.parsed.notes ?? null)) changed.push("notes");

    if (changed.length === 0) {
      rows.push({
        rowNumber: r.rowNumber,
        action: "unchanged",
        parsed: r.parsed,
        errors: [],
        changedFields: [],
        existingId: ex.id,
      });
      unchanged++;
    } else {
      rows.push({
        rowNumber: r.rowNumber,
        action: "update",
        parsed: r.parsed,
        errors: [],
        changedFields: changed,
        existingId: ex.id,
      });
      update++;
    }
  }

  return {
    rows,
    summary: { create, update, unchanged, error, total: parsed.rows.length },
  };
}
