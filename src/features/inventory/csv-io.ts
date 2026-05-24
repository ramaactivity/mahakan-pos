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

/* Sesi AE-136 — auto-inference rasio purchase→recipe untuk pasangan
 * umum. Owner CSV biasanya isi unit lengkap tapi skip kolom ratio. */
const AUTO_INFER_RATIO: Record<string, number> = {
  "kg|g": 1000,
  "l|ml": 1000,
};

export interface IngredientCsvRow {
  id: string | null;
  name: string;
  section: Section;
  /** Recipe Unit — satuan terkecil untuk perhitungan resep + storage. */
  recipeUnit: string;
  /** Purchase Unit — untuk display Inventory + opname + belanja. NULL = pakai recipe unit. */
  purchaseUnit: string | null;
  /** Konversi: 1 purchase unit = X recipe unit. NULL = identity (1:1). */
  purchasePerRecipe: number | null;
  costPerUnit: number;
  currentStock: number; // display only (read on export, ignored on import)
  threshold: number | null;
  notes: string | null;
  /* Sesi AE-143 — partial update flags. Kalau kolom tidak ada di CSV
   * header (vs ada tapi kosong), `preserve*` true → applier WAJIB pakai
   * value existing waktu UPDATE alih-alih overwrite ke null/default.
   * Untuk CREATE: ignore flag, gunakan parsed value apa adanya. */
  preserveSection: boolean;
  preservePurchaseUnit: boolean;
  preservePurchasePerRecipe: boolean;
  preserveCostPerUnit: boolean;
  preserveThreshold: boolean;
  preserveNotes: boolean;
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
  /** Recipe Unit (alias of legacy `unit` column). */
  unit: string;
  /** Purchase Unit — NULL kalau belum diset. */
  unitBelanja: string | null;
  /** Konversi 1 unitBelanja = X unit. NULL/identity = 1:1. */
  unitBelanjaPerCogs: string | null;
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
  /* Sesi AE-136 — kolom unit di-split jadi 2:
   * - purchase_unit = satuan belanja (kg, L, btl, pack). Boleh kosong.
   * - recipe_unit   = satuan terkecil untuk resep (g, ml, pcs).
   * - purchase_per_recipe = 1 purchase = X recipe. Kosong = pakai default
   *   (kg+g=1000, L+ml=1000, recipe==purchase=1, else WAJIB isi). */
  lines.push(
    `# purchase_unit/recipe_unit/purchase_per_recipe: 1 kg = 1000 g, 1 L = 1000 ml. Kalau identik (recipe = purchase) ratio = 1.`,
  );
  // Data header — kolom baru (Sesi AE-136). Backward-compat: parser masih
  // accept legacy "unit" column kalau CSV lama di-upload.
  lines.push(
    [
      "id",
      "name",
      "section",
      "purchase_unit",
      "recipe_unit",
      "purchase_per_recipe",
      "cost_per_unit",
      "current_stock",
      "threshold",
      "notes",
    ].join(","),
  );

  for (const r of sorted) {
    const purchaseUnit = r.unitBelanja?.trim() ?? "";
    const ratio =
      r.unitBelanjaPerCogs && r.unitBelanjaPerCogs.trim().length > 0
        ? /* Trim trailing zeros from decimal: "1000.0000" → "1000" */
          String(parseFloat(r.unitBelanjaPerCogs))
        : "";
    lines.push(
      [
        r.id,
        csvEscape(r.name),
        r.section ?? "",
        csvEscape(purchaseUnit),
        csvEscape(r.unit),
        ratio,
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

  /* Sesi AE-142 — auto-detect delimiter. Excel locale id-ID default
   * "Save As CSV" pakai semicolon (`;`), bukan comma. Owner/staff sering
   * tidak sadar — file ke-upload tapi parser fail. Pilih delimiter dengan
   * count tertinggi di header line; tie → comma (default). */
  const delimiter = detectDelimiter(dataLines[0].line);

  /* Sesi AE-136 — case-insensitive header normalization karena owner
   * suka edit di Excel/Sheets yang capitalize column names. */
  const headers = parseCsvLine(dataLines[0].line, delimiter).map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_"),
  );

  const expectedHeaders = [
    "id",
    "name",
    "section",
    "purchase_unit",
    "recipe_unit",
    "purchase_per_recipe",
    "cost_per_unit",
    "current_stock",
    "threshold",
    "notes",
  ];

  /* Backward-compat: CSV lama hanya punya "unit" (= recipe unit).
   * Baru: "recipe_unit" + "purchase_unit" + "purchase_per_recipe".
   * Acceptable: name + (recipe_unit ATAU unit) minimum. */
  const hasRecipeUnit =
    headers.includes("recipe_unit") || headers.includes("unit");
  const headerSet = new Set(headers);
  /* Sesi AE-143 — partial update detection. */
  const hasSectionCol = headerSet.has("section");
  const hasPurchaseUnitCol = headerSet.has("purchase_unit");
  const hasPurchasePerRecipeCol = headerSet.has("purchase_per_recipe");
  const hasCostCol = headerSet.has("cost_per_unit");
  const hasThresholdCol = headerSet.has("threshold");
  const hasNotesCol = headerSet.has("notes");
  if (!headers.includes("name") || !hasRecipeUnit) {
    return {
      rows: [
        {
          rowNumber: 0,
          raw: {},
          parsed: null,
          errors: [
            {
              field: "header",
              message: `CSV header missing required columns. Expected: ${expectedHeaders.join(", ")}. Minimum: name + recipe_unit (atau legacy "unit").`,
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
    const cells = parseCsvLine(dataLines[i].line, delimiter);
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

    /* Sesi AE-136 — recipe_unit (atau legacy unit) + purchase_unit +
     * purchase_per_recipe parsing. */
    const recipeUnit = (raw.recipe_unit ?? raw.unit ?? "").trim();
    if (recipeUnit.length === 0) {
      errors.push({
        field: "recipe_unit",
        message: "recipe_unit wajib diisi (kolom legacy 'unit' juga diterima)",
      });
    } else if (recipeUnit.length > 20) {
      errors.push({
        field: "recipe_unit",
        message: "recipe_unit maksimal 20 karakter",
      });
    }

    /* Purchase unit + ratio — optional dengan smart defaults. */
    const purchaseUnitRaw = (raw.purchase_unit ?? "").trim();
    const purchasePerRecipeRaw = (raw.purchase_per_recipe ?? "").trim();
    let purchaseUnit: string | null = null;
    let purchasePerRecipe: number | null = null;

    if (purchaseUnitRaw.length > 0) {
      if (purchaseUnitRaw.length > 20) {
        errors.push({
          field: "purchase_unit",
          message: "purchase_unit maksimal 20 karakter",
        });
      } else {
        purchaseUnit = purchaseUnitRaw;
        /* Resolve ratio: explicit > inferred > error.
         * Sesi AE-143: kalau kolom `purchase_per_recipe` TIDAK ada di
         * header (vs ada tapi kosong) → skip error, biarkan applier
         * preserve existing value via flag preservePurchasePerRecipe. */
        if (purchasePerRecipeRaw.length > 0) {
          /* User explicit set ratio — parse Indonesian (koma desimal). */
          const cleaned = purchasePerRecipeRaw
            .replace(/\./g, "") // strip thousand separator
            .replace(",", ".");
          const n = Number(cleaned);
          if (!Number.isFinite(n) || n <= 0) {
            errors.push({
              field: "purchase_per_recipe",
              message: `purchase_per_recipe harus angka positif (got '${purchasePerRecipeRaw}')`,
            });
          } else {
            purchasePerRecipe = n;
          }
        } else {
          /* Auto-infer dari pasangan unit umum. */
          const pairKey = `${purchaseUnit.toLowerCase()}|${recipeUnit.toLowerCase()}`;
          const inferred = AUTO_INFER_RATIO[pairKey];
          if (inferred !== undefined) {
            purchasePerRecipe = inferred;
          } else if (
            purchaseUnit.toLowerCase() === recipeUnit.toLowerCase()
          ) {
            purchasePerRecipe = 1; // identity
          } else if (!hasPurchasePerRecipeCol) {
            /* Kolom ratio missing dari CSV → preserve existing via
             * applier (ditandai flag di bawah). UNTUK CREATE row, applier
             * fallback ke null → admin perlu re-upload dengan ratio
             * setelah create. Untuk UPDATE row (mayoritas case), preserve
             * existing memenuhi expectation user. */
          } else {
            errors.push({
              field: "purchase_per_recipe",
              message: `purchase_per_recipe wajib untuk pair ${purchaseUnit}→${recipeUnit} (tidak ada default). Mis. 1 ${purchaseUnit} = ? ${recipeUnit}.`,
            });
          }
        }
      }
    } else if (purchasePerRecipeRaw.length > 0) {
      /* User isi ratio tapi tidak isi purchase_unit — invalid. */
      errors.push({
        field: "purchase_per_recipe",
        message: "purchase_per_recipe tidak boleh diisi kalau purchase_unit kosong",
      });
    }
    /* Fallback alias supaya rest of code masih jalan. */
    const unit = recipeUnit;

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

    // cost_per_unit: integer >= 0. Sesi AE-143: kalau kolom missing,
    // default 0 + preserve flag akan handle preservation di applier.
    const costRaw = raw.cost_per_unit ?? "0";
    const cost = Number(costRaw);
    if (hasCostCol && (!Number.isFinite(cost) || cost < 0 || !Number.isInteger(cost))) {
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
            recipeUnit: unit,
            purchaseUnit,
            purchasePerRecipe,
            costPerUnit: cost,
            currentStock: 0, // read-only — ignored on import
            threshold,
            notes,
            /* Sesi AE-143 — preserve flags untuk partial update. True =
             * kolom tidak ada di CSV header → applier pakai existing
             * value (UPDATE) atau default (CREATE). */
            preserveSection: !hasSectionCol,
            preservePurchaseUnit: !hasPurchaseUnitCol,
            preservePurchasePerRecipe: !hasPurchasePerRecipeCol,
            preserveCostPerUnit: !hasCostCol,
            preserveThreshold: !hasThresholdCol,
            preserveNotes: !hasNotesCol,
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
 * Sesi AE-142 — detect CSV delimiter dari header line.
 * Hitung occurrence `;` vs `,` di luar quoted regions; pilih yang lebih
 * banyak. Tie atau zero → comma (RFC 4180 default).
 *
 * Why: Excel locale id-ID (juga German, Spanish) default Save As CSV pakai
 * semicolon karena koma dipakai sebagai decimal separator regional.
 */
function detectDelimiter(headerLine: string): "," | ";" {
  let commaCount = 0;
  let semicolonCount = 0;
  let inQuote = false;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === ",") commaCount++;
    else if (ch === ";") semicolonCount++;
  }
  return semicolonCount > commaCount ? ";" : ",";
}

/**
 * Minimal CSV line parser — handles quote-escaping.
 * Per RFC 4180. Delimiter configurable untuk Excel locale support.
 */
function parseCsvLine(line: string, delimiter: "," | ";" = ","): string[] {
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
      if (ch === delimiter) {
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
  unit: string; // recipe unit
  /** Sesi AE-136 — Purchase unit + ratio untuk diff comparison. */
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
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

    /* Sesi AE-143 — Hanya kolom yg present di CSV header yg dibandingkan.
     * Kolom missing → applier akan preserve existing → tidak counted as
     * "changed" supaya UNCHANGED rows bener-bener accurate. */
    const changed: string[] = [];
    if (ex.name !== r.parsed.name) changed.push("name");
    if (!r.parsed.preserveSection && ex.section !== r.parsed.section) {
      changed.push("section");
    }
    if (ex.unit !== r.parsed.recipeUnit) changed.push("recipe_unit");
    if (!r.parsed.preservePurchaseUnit) {
      const exPurchase = ex.unitBelanja?.trim() || null;
      const newPurchase = r.parsed.purchaseUnit?.trim() || null;
      if (exPurchase !== newPurchase) changed.push("purchase_unit");
    }
    if (!r.parsed.preservePurchasePerRecipe) {
      const exRatio = ex.unitBelanjaPerCogs
        ? parseFloat(ex.unitBelanjaPerCogs)
        : null;
      const newRatio = r.parsed.purchasePerRecipe ?? null;
      if (exRatio !== newRatio) changed.push("purchase_per_recipe");
    }
    if (
      !r.parsed.preserveCostPerUnit &&
      ex.costPerUnit !== r.parsed.costPerUnit
    ) {
      changed.push("cost_per_unit");
    }
    if (
      !r.parsed.preserveThreshold &&
      (ex.reorderThreshold ?? null) !== (r.parsed.threshold ?? null)
    ) {
      changed.push("threshold");
    }
    if (
      !r.parsed.preserveNotes &&
      (ex.notes ?? null) !== (r.parsed.notes ?? null)
    ) {
      changed.push("notes");
    }

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
