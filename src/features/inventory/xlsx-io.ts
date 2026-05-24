/**
 * Sesi AE-139 — Excel (xlsx) export/import untuk Preparation + Recipe.
 *
 * Owner request: staff agak gaptek soal CSV format Indonesia (delimiter,
 * encoding, dll). Pakai .xlsx biar staff bisa langsung edit di Excel
 * tanpa worry format.
 *
 * Single-sheet flat layout supaya staff tidak perlu navigate antar sheet.
 * Empty prep_name / menu_name di row = continuation row (ingredient line
 * tambahan untuk prep/menu di row sebelumnya).
 *
 * Pure functions — no DB access. Caller (server action) handle persistence.
 */

import * as XLSX from "xlsx";

/* ============================================================
 * PREPARATIONS
 * ============================================================ */

export interface PreparationForExport {
  id: string;
  name: string;
  recipeUnit: string;
  yield: number;
  qFactor: number;
  notes: string | null;
  /** Recipe lines: [{ ingredientName, qty }]. */
  lines: Array<{ ingredientName: string; qty: number }>;
}

export interface ParsedPreparationRow {
  rowNumber: number;
  /** Row 0 = prep header (with prep info filled), > 0 = continuation. */
  id: string | null;
  name: string;
  recipeUnit: string;
  yield: number;
  qFactor: number;
  notes: string | null;
  lines: Array<{
    ingredientName: string;
    qty: number;
  }>;
  errors: string[];
}

export interface PreparationParseResult {
  rows: ParsedPreparationRow[];
  errorCount: number;
  headers: string[];
}

const PREP_HEADERS = [
  "prep_id",
  "prep_name",
  "recipe_unit",
  "yield",
  "q_factor",
  "notes",
  "ingredient_name",
  "qty",
];

/** Serialize preparations + recipe lines to xlsx Buffer. */
export function serializePreparationsXlsx(
  preps: PreparationForExport[],
  meta: { generatedAt: Date; outletName: string },
): Buffer {
  const aoa: (string | number | null)[][] = [];

  /* Comment row di atas — Excel ignore kalau di-mark sebagai komentar
   * (sheet pertama akan tetap parse-able). Sebagai workaround pakai
   * row #1 sebagai header info, row #2 = data header, row #3+ = data. */
  aoa.push([
    `# Generated ${meta.generatedAt.toISOString()} | Outlet: ${meta.outletName} | Total: ${preps.length} preparations`,
  ]);
  aoa.push([
    "# Empty prep_id = create new. Empty prep_name = continuation row (ingredient line tambahan untuk prep di atas).",
  ]);
  aoa.push(PREP_HEADERS);

  for (const p of preps) {
    if (p.lines.length === 0) {
      aoa.push([p.id, p.name, p.recipeUnit, p.yield, p.qFactor, p.notes, "", ""]);
    } else {
      p.lines.forEach((ln, i) => {
        if (i === 0) {
          aoa.push([
            p.id,
            p.name,
            p.recipeUnit,
            p.yield,
            p.qFactor,
            p.notes,
            ln.ingredientName,
            ln.qty,
          ]);
        } else {
          /* Continuation row: leave prep cols blank. */
          aoa.push(["", "", "", "", "", "", ln.ingredientName, ln.qty]);
        }
      });
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  /* Set kolom widths supaya readable di Excel. */
  ws["!cols"] = [
    { wch: 36 }, // prep_id
    { wch: 28 }, // prep_name
    { wch: 12 }, // recipe_unit
    { wch: 8 }, // yield
    { wch: 9 }, // q_factor
    { wch: 24 }, // notes
    { wch: 28 }, // ingredient_name
    { wch: 8 }, // qty
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Preparations");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf as Buffer;
}

export function parsePreparationsXlsx(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): PreparationParseResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errorCount: 1, headers: [] };
  }
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });

  /* Skip leading comment rows (starting with #) + find header row. */
  let headerIdx = -1;
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;
    const first = String(row[0] ?? "").trim();
    if (first.startsWith("#")) continue;
    headerIdx = i;
    break;
  }
  if (headerIdx === -1) {
    return { rows: [], errorCount: 1, headers: [] };
  }

  const headers = (aoa[headerIdx] as unknown[]).map((h) =>
    String(h ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_"),
  );

  const required = ["prep_name", "recipe_unit", "yield", "ingredient_name", "qty"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      rows: [
        {
          rowNumber: headerIdx + 1,
          id: null,
          name: "",
          recipeUnit: "",
          yield: 0,
          qFactor: 0,
          notes: null,
          lines: [],
          errors: [
            `Header xlsx kurang kolom: ${missing.join(", ")}. Expected: ${PREP_HEADERS.join(", ")}`,
          ],
        },
      ],
      errorCount: 1,
      headers,
    };
  }

  const idx = (h: string) => headers.indexOf(h);
  const iId = idx("prep_id");
  const iName = idx("prep_name");
  const iUnit = idx("recipe_unit");
  const iYield = idx("yield");
  const iQ = idx("q_factor");
  const iNotes = idx("notes");
  const iIngName = idx("ingredient_name");
  const iQty = idx("qty");

  const rows: ParsedPreparationRow[] = [];
  let current: ParsedPreparationRow | null = null;
  let errorCount = 0;

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const prepName = String(row[iName] ?? "").trim();
    const ingName = String(row[iIngName] ?? "").trim();
    const qtyRaw = String(row[iQty] ?? "").trim();

    if (prepName.length > 0) {
      /* New prep header row. Flush previous + start new. */
      if (current) rows.push(current);
      const errors: string[] = [];
      const id = String(row[iId] ?? "").trim() || null;
      if (id !== null && !isUuidLike(id)) {
        errors.push(`prep_id invalid UUID: "${id}"`);
      }
      const unit = String(row[iUnit] ?? "").trim();
      if (unit.length === 0) errors.push("recipe_unit wajib diisi");
      const yieldRaw = String(row[iYield] ?? "").trim();
      const yieldNum = parseNumber(yieldRaw);
      if (!Number.isFinite(yieldNum) || yieldNum <= 0) {
        errors.push(`yield harus angka > 0 (got "${yieldRaw}")`);
      }
      const qRaw = String(row[iQ] ?? "10").trim();
      const qNum = qRaw === "" ? 10 : parseNumber(qRaw);
      if (!Number.isFinite(qNum) || qNum < 0 || qNum > 200) {
        errors.push(`q_factor harus 0-200 (got "${qRaw}")`);
      }
      const notes = String(row[iNotes] ?? "").trim() || null;

      current = {
        rowNumber: i + 1,
        id,
        name: prepName,
        recipeUnit: unit,
        yield: Number.isFinite(yieldNum) ? Math.round(yieldNum) : 0,
        qFactor: Number.isFinite(qNum) ? Math.round(qNum) : 10,
        notes,
        lines: [],
        errors,
      };
      if (errors.length > 0) errorCount++;
    }

    /* Add ingredient line (kalau ada). */
    if (ingName.length > 0 || qtyRaw.length > 0) {
      if (!current) {
        rows.push({
          rowNumber: i + 1,
          id: null,
          name: "",
          recipeUnit: "",
          yield: 0,
          qFactor: 0,
          notes: null,
          lines: [],
          errors: [
            `Ingredient line tanpa prep header — pastikan prep_name terisi di atasnya. Row ${i + 1}.`,
          ],
        });
        errorCount++;
        continue;
      }
      if (ingName.length === 0) {
        current.errors.push(`ingredient_name kosong di row ${i + 1}`);
        continue;
      }
      const qtyNum = parseNumber(qtyRaw);
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        current.errors.push(
          `qty invalid untuk ${ingName} (got "${qtyRaw}", harus angka > 0)`,
        );
        continue;
      }
      current.lines.push({
        ingredientName: ingName,
        qty: Math.round(qtyNum),
      });
    }
  }
  if (current) {
    if (current.errors.length > 0) errorCount++;
    rows.push(current);
  }

  /* Final pass: prep tanpa lines = error. */
  for (const r of rows) {
    if (r.errors.length === 0 && r.lines.length === 0 && r.name.length > 0) {
      r.errors.push("Prep tidak punya line ingredient (minimal 1)");
      errorCount++;
    }
  }

  return { rows, errorCount, headers };
}

/* ============================================================
 * RECIPES (menu)
 * ============================================================ */

export interface RecipeForExport {
  menuItemId: string;
  menuName: string;
  variant: "hot" | "iced" | null;
  qFactor: number;
  notes: string | null;
  lines: Array<{ ingredientName: string; qty: number }>;
}

export interface ParsedRecipeRow {
  rowNumber: number;
  menuItemId: string | null;
  menuName: string;
  variant: "hot" | "iced" | null;
  qFactor: number;
  notes: string | null;
  lines: Array<{ ingredientName: string; qty: number }>;
  errors: string[];
}

export interface RecipeParseResult {
  rows: ParsedRecipeRow[];
  errorCount: number;
  headers: string[];
}

const RECIPE_HEADERS = [
  "menu_id",
  "menu_name",
  "variant",
  "q_factor",
  "notes",
  "ingredient_name",
  "qty",
];

export function serializeRecipesXlsx(
  recipes: RecipeForExport[],
  meta: { generatedAt: Date; outletName: string },
): Buffer {
  const aoa: (string | number | null)[][] = [];
  aoa.push([
    `# Generated ${meta.generatedAt.toISOString()} | Outlet: ${meta.outletName} | Total: ${recipes.length} recipes`,
  ]);
  aoa.push([
    "# Empty menu_name = continuation row (ingredient line tambahan untuk recipe di atas). variant = hot/iced atau kosong (single price).",
  ]);
  aoa.push(RECIPE_HEADERS);

  for (const r of recipes) {
    if (r.lines.length === 0) {
      aoa.push([
        r.menuItemId,
        r.menuName,
        r.variant ?? "",
        r.qFactor,
        r.notes,
        "",
        "",
      ]);
    } else {
      r.lines.forEach((ln, i) => {
        if (i === 0) {
          aoa.push([
            r.menuItemId,
            r.menuName,
            r.variant ?? "",
            r.qFactor,
            r.notes,
            ln.ingredientName,
            ln.qty,
          ]);
        } else {
          aoa.push(["", "", "", "", "", ln.ingredientName, ln.qty]);
        }
      });
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 36 }, // menu_id
    { wch: 32 }, // menu_name
    { wch: 8 }, // variant
    { wch: 9 }, // q_factor
    { wch: 24 }, // notes
    { wch: 28 }, // ingredient_name
    { wch: 8 }, // qty
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recipes");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function parseRecipesXlsx(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): RecipeParseResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errorCount: 1, headers: [] };
  }
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });

  let headerIdx = -1;
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;
    const first = String(row[0] ?? "").trim();
    if (first.startsWith("#")) continue;
    headerIdx = i;
    break;
  }
  if (headerIdx === -1) {
    return { rows: [], errorCount: 1, headers: [] };
  }

  const headers = (aoa[headerIdx] as unknown[]).map((h) =>
    String(h ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_"),
  );

  const required = ["menu_name", "ingredient_name", "qty"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      rows: [
        {
          rowNumber: headerIdx + 1,
          menuItemId: null,
          menuName: "",
          variant: null,
          qFactor: 30,
          notes: null,
          lines: [],
          errors: [
            `Header xlsx kurang kolom: ${missing.join(", ")}. Expected: ${RECIPE_HEADERS.join(", ")}`,
          ],
        },
      ],
      errorCount: 1,
      headers,
    };
  }

  const idx = (h: string) => headers.indexOf(h);
  const iMenuId = idx("menu_id");
  const iMenuName = idx("menu_name");
  const iVariant = idx("variant");
  const iQ = idx("q_factor");
  const iNotes = idx("notes");
  const iIngName = idx("ingredient_name");
  const iQty = idx("qty");

  const rows: ParsedRecipeRow[] = [];
  let current: ParsedRecipeRow | null = null;
  let errorCount = 0;

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const menuName = String(row[iMenuName] ?? "").trim();
    const ingName = String(row[iIngName] ?? "").trim();
    const qtyRaw = String(row[iQty] ?? "").trim();

    if (menuName.length > 0) {
      if (current) rows.push(current);
      const errors: string[] = [];
      const menuId = String(row[iMenuId] ?? "").trim() || null;
      if (menuId !== null && !isUuidLike(menuId)) {
        errors.push(`menu_id invalid UUID: "${menuId}"`);
      }
      const variantRaw = String(row[iVariant] ?? "").trim().toLowerCase();
      let variant: "hot" | "iced" | null = null;
      if (variantRaw === "hot" || variantRaw === "iced") {
        variant = variantRaw;
      } else if (variantRaw !== "" && variantRaw !== "null") {
        errors.push(`variant harus "hot"/"iced"/kosong (got "${variantRaw}")`);
      }
      const qRaw = String(row[iQ] ?? "30").trim();
      const qNum = qRaw === "" ? 30 : parseNumber(qRaw);
      if (!Number.isFinite(qNum) || qNum < 0 || qNum > 200) {
        errors.push(`q_factor harus 0-200 (got "${qRaw}")`);
      }
      const notes = String(row[iNotes] ?? "").trim() || null;

      current = {
        rowNumber: i + 1,
        menuItemId: menuId,
        menuName,
        variant,
        qFactor: Number.isFinite(qNum) ? Math.round(qNum) : 30,
        notes,
        lines: [],
        errors,
      };
      if (errors.length > 0) errorCount++;
    }

    if (ingName.length > 0 || qtyRaw.length > 0) {
      if (!current) {
        rows.push({
          rowNumber: i + 1,
          menuItemId: null,
          menuName: "",
          variant: null,
          qFactor: 30,
          notes: null,
          lines: [],
          errors: [
            `Ingredient line tanpa menu header. Row ${i + 1}.`,
          ],
        });
        errorCount++;
        continue;
      }
      if (ingName.length === 0) {
        current.errors.push(`ingredient_name kosong di row ${i + 1}`);
        continue;
      }
      const qtyNum = parseNumber(qtyRaw);
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        current.errors.push(
          `qty invalid untuk ${ingName} (got "${qtyRaw}", harus angka > 0)`,
        );
        continue;
      }
      current.lines.push({
        ingredientName: ingName,
        qty: Math.round(qtyNum),
      });
    }
  }
  if (current) {
    if (current.errors.length > 0) errorCount++;
    rows.push(current);
  }

  for (const r of rows) {
    if (r.errors.length === 0 && r.lines.length === 0 && r.menuName.length > 0) {
      r.errors.push("Recipe tidak punya line ingredient (minimal 1)");
      errorCount++;
    }
  }

  return { rows, errorCount, headers };
}

/* ============================================================
 * Helpers
 * ============================================================ */

/** Strict-ish number parse: accept "1.234,5" (Indonesian) atau "1234.5"
 * (Excel default). Excel default = titik desimal, Indonesian = koma. */
function parseNumber(s: string): number {
  if (!s) return NaN;
  const cleaned = s.trim();
  if (cleaned === "") return NaN;
  /* Kalau ada koma → Indonesian: titik=ribuan, koma=desimal. */
  if (cleaned.includes(",")) {
    const fixed = cleaned.replace(/\./g, "").replace(",", ".");
    return parseFloat(fixed);
  }
  /* Excel default. */
  return parseFloat(cleaned);
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}
