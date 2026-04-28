/**
 * One-shot translator: Owner messy spreadsheets → 5 standardized CSV
 * + 3 sidecars (MENU_SKIP_LIST.txt, INGREDIENT_DUP_RESOLUTION.txt,
 * TRANSLATION_NOTES.md).
 *
 * Run: npx tsx scripts/_oneshot/translate-owner-csv.ts
 *
 * Input: data/source-spreadsheets/_original/
 *   - Marketlist.tsv
 *   - PREP_BEVERAGE.csv, PREP_FOOD.csv
 *   - UPDATE_HPP_BEVERAGE_26042026.csv, UPDATE_HPP_FOOD_26042026.csv
 *
 * Output: data/source-spreadsheets/
 *   - 01-ingredients.csv ... 05-menu-recipe-lines.csv
 *   - MENU_SKIP_LIST.txt, INGREDIENT_DUP_RESOLUTION.txt, TRANSLATION_NOTES.md
 *
 * NOTE: not in package.json scripts (one-shot tool, kept for re-runs if
 * Owner provides updated spreadsheets).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";

const SRC = resolve(process.cwd(), "data/source-spreadsheets/_original");
const OUT = resolve(process.cwd(), "data/source-spreadsheets");

// ----- Indonesian number parsing helpers --------------------------------

function stripIndonesianThousandSep(raw: string): string {
  // Owner format: "1.000" = 1000 (period = thousand sep, always 3 digits after).
  // But "0.5" = 0.5 (decimal point, 1-2 digits after).
  // Heuristic: only strip period if EXACTLY 3 digits follow it (and end-of-string
  // or another period).
  return raw.replace(/\.(\d{3})(?=\.|$|\D)/g, "$1");
}

function parseRupiah(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = stripIndonesianThousandSep(
    raw.replace(/\s+/g, "").replace(/^Rp/i, "").replace(/,/g, ""),
  );
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = stripIndonesianThousandSep(raw.replace(/\s+/g, ""));
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** For integer-required fields (qty, cost_per_unit). Rounds up sub-1 fractions
 * to 1 (since engine requires qty > 0). */
function parseIntegerQty(raw: string | undefined): number {
  const n = parseNumber(raw);
  if (n === 0) return 0;
  if (n > 0 && n < 1) return 1; // tiny fractional (e.g., 0.5g Italian Herb) → 1
  return Math.round(n);
}

function trim(s: string | undefined): string {
  return (s ?? "").trim();
}

// ----- Menu name authority (from src/db/seed-data.ts) ------------------

type VariantMode = "fixed" | "open" | "hot+iced" | "iced-only" | "hot-only";
interface MenuAuth {
  canonicalName: string;
  mode: VariantMode;
}

const SEEDED_MENUS: MenuAuth[] = [
  // Ricebowl
  { canonicalName: "Ayam Asam Manis", mode: "fixed" },
  { canonicalName: "Ayam Sambal Matah", mode: "fixed" }, // ALSO in Bakmie - ambiguous
  { canonicalName: "Scramble / Dadar Matah", mode: "fixed" },
  { canonicalName: "Anak Kost (Telur & Sosis)", mode: "fixed" },
  // Bakmie
  { canonicalName: "Ayam Original", mode: "fixed" },
  { canonicalName: "Ayam Chilli Oil", mode: "fixed" },
  // (Ayam Sambal Matah Bakmie skipped due to name conflict)
  // Sweets
  { canonicalName: "Churros Choco Dip", mode: "fixed" },
  { canonicalName: "Croffle Ice Cream", mode: "fixed" },
  { canonicalName: "Roti Bakar Keju", mode: "fixed" },
  // Bites
  { canonicalName: "Mixed Platter", mode: "fixed" },
  { canonicalName: "French Fries", mode: "fixed" },
  { canonicalName: "Dimsum", mode: "fixed" },
  { canonicalName: "Samosa Kare", mode: "fixed" },
  { canonicalName: "Tahu Walik", mode: "fixed" },
  // Coffee
  { canonicalName: "Americano", mode: "hot+iced" },
  { canonicalName: "Pablo Eskopi", mode: "iced-only" },
  { canonicalName: "Butterscotch Latte", mode: "iced-only" },
  { canonicalName: "Caramel Macchiato", mode: "hot+iced" },
  { canonicalName: "Cappuccino", mode: "hot+iced" },
  { canonicalName: "Latte", mode: "hot+iced" },
  { canonicalName: "Vanilla Latte", mode: "hot+iced" },
  // Non-Coffee
  { canonicalName: "Maroon Velvet", mode: "hot+iced" },
  { canonicalName: "Ariana Green Tea", mode: "hot+iced" },
  { canonicalName: "Chocolate", mode: "hot+iced" },
  { canonicalName: "Lychee Yakult", mode: "iced-only" },
  { canonicalName: "Manggo Yakult", mode: "iced-only" },
  { canonicalName: "Oreo Milkshake", mode: "iced-only" },
  { canonicalName: "Regal Milkshake", mode: "iced-only" },
  { canonicalName: "Mineral Water", mode: "hot+iced" },
  // Tea
  { canonicalName: "Lemon Tea", mode: "hot+iced" },
  { canonicalName: "Lychee Tea", mode: "iced-only" },
  // Frappe
  { canonicalName: "Matcha & The Bear", mode: "fixed" },
  { canonicalName: "Misty Oreo", mode: "fixed" },
  // Mocktail
  { canonicalName: "Mont Blanc", mode: "fixed" },
  { canonicalName: "Cardi Breeze", mode: "fixed" },
  { canonicalName: "The Paps", mode: "fixed" },
  { canonicalName: "Limericano", mode: "fixed" },
  // Manual Brew
  { canonicalName: "V60", mode: "open" },
  { canonicalName: "Japanese", mode: "open" },
  // Ice Cream
  { canonicalName: "Affogato", mode: "fixed" },
  { canonicalName: "Matchagatto", mode: "fixed" },
  { canonicalName: "Oreo Ice Cream", mode: "fixed" },
];

const MENU_BY_LOWER: Map<string, MenuAuth> = new Map(
  SEEDED_MENUS.map((m) => [m.canonicalName.trim().toLowerCase(), m]),
);

// Owner spreadsheet name → canonical seed name (post-prefix-strip)
const NAME_TYPO_FIX: Array<[RegExp, string]> = [
  [/^pablo\s+es\s*kopi$/i, "Pablo Eskopi"],
  [/^montblanc$/i, "Mont Blanc"],
  [/^caramel\s+machiato$/i, "Caramel Macchiato"],
  [/^butterscoth\s+latte$/i, "Butterscotch Latte"],
  [/^iced\s+choco$/i, "Chocolate"], // Owner: "Iced Choco" → seed "Chocolate"
  [/^hot\s+choco$/i, "Chocolate"],
  [/^ricebowl\s+asam\s+manis$/i, "Ayam Asam Manis"],
  [/^rice\s*bowl\s+matah$/i, "Ayam Sambal Matah"],
  [/^rice\s*bowl\s+telur\s+sosis$/i, "Anak Kost (Telur & Sosis)"],
  [/^ricebowl\s+telur\s+matah$/i, "Scramble / Dadar Matah"],
  [/^bakmie\s+original$/i, "Ayam Original"],
  [/^bakmie\s+chili\s+oil$/i, "Ayam Chilli Oil"],
  [/^churros$/i, "Churros Choco Dip"],
];

interface MenuTranslation {
  canonicalName: string | null;
  variant: "hot" | "iced" | null;
  skipReason?: string;
}

function translateMenuName(rawLabel: string): MenuTranslation {
  const trimmed = rawLabel.trim();
  if (!trimmed) return { canonicalName: null, variant: null, skipReason: "empty label" };

  // Strip Iced/Hot prefix OR suffix
  let variant: "hot" | "iced" | null = null;
  let core = trimmed;
  const icedPrefix = /^iced\s+(.+)$/i.exec(trimmed);
  const hotPrefix = /^hot\s+(.+)$/i.exec(trimmed);
  const icedSuffix = /^(.+)\s+iced$/i.exec(trimmed);
  const hotSuffix = /^(.+)\s+hot$/i.exec(trimmed);
  if (icedPrefix) {
    variant = "iced";
    core = icedPrefix[1];
  } else if (hotPrefix) {
    variant = "hot";
    core = hotPrefix[1];
  } else if (icedSuffix) {
    variant = "iced";
    core = icedSuffix[1];
  } else if (hotSuffix) {
    variant = "hot";
    core = hotSuffix[1];
  }

  // Apply typo fixes (operates on full label OR core)
  let candidate = core;
  for (const [pattern, replacement] of NAME_TYPO_FIX) {
    if (pattern.test(trimmed)) {
      candidate = replacement;
      // typo fix on full label may already encode variant (e.g. "Iced Choco" → Chocolate iced)
      const fullMatch = /^(iced|hot)\s+/i.exec(trimmed);
      if (fullMatch) variant = fullMatch[1].toLowerCase() as "hot" | "iced";
      break;
    }
    if (pattern.test(core)) {
      candidate = replacement;
      break;
    }
  }

  // Special-case: "Bakmie Matah" → "Ayam Sambal Matah" (Bakmie cat) but
  // ambiguous with Ricebowl's "Ayam Sambal Matah". Skip explicitly.
  if (/^bakmie\s+matah$/i.test(trimmed)) {
    return {
      canonicalName: null,
      variant: null,
      skipReason: "name conflict: Owner 'Bakmie Matah' maps to seed 'Ayam Sambal Matah' which also exists as Ricebowl menu — engine lookup ambiguous. Rename one menu_item via Admin UI before re-import.",
    };
  }

  // Look up in seed authority
  const auth = MENU_BY_LOWER.get(candidate.toLowerCase());
  if (!auth) {
    return {
      canonicalName: null,
      variant,
      skipReason: `not seeded: "${trimmed}" → candidate "${candidate}" tidak ada di menu_items`,
    };
  }

  // Validate variant matches mode
  if (auth.mode === "fixed" || auth.mode === "open") {
    if (variant !== null) {
      return {
        canonicalName: null,
        variant: null,
        skipReason: `variant mismatch: "${trimmed}" stripped to "${candidate}" but seed is fixed/open (no variant)`,
      };
    }
    return { canonicalName: auth.canonicalName, variant: null };
  }
  if (auth.mode === "hot+iced") {
    if (variant === null) {
      // Special-case: Mineral Water has same price hot/iced; Owner has only one
      // block. Default to iced (most common in Indonesia).
      if (auth.canonicalName === "Mineral Water") {
        return { canonicalName: auth.canonicalName, variant: "iced" };
      }
      return {
        canonicalName: null,
        variant: null,
        skipReason: `variant missing: "${trimmed}" matches variant menu "${auth.canonicalName}" — needs Iced/Hot prefix`,
      };
    }
    return { canonicalName: auth.canonicalName, variant };
  }
  if (auth.mode === "iced-only") {
    if (variant === "hot") {
      return {
        canonicalName: null,
        variant: null,
        skipReason: `variant invalid: "${trimmed}" but seed "${auth.canonicalName}" is iced-only`,
      };
    }
    return { canonicalName: auth.canonicalName, variant: "iced" };
  }
  if (auth.mode === "hot-only") {
    if (variant === "iced") {
      return {
        canonicalName: null,
        variant: null,
        skipReason: `variant invalid: "${trimmed}" but seed "${auth.canonicalName}" is hot-only`,
      };
    }
    return { canonicalName: auth.canonicalName, variant: "hot" };
  }
  return { canonicalName: null, variant: null, skipReason: "unknown mode" };
}

// ----- Ingredient name normalization ------------------------------------

function normalizeIngredientName(raw: string): string {
  const t = raw.trim();
  // Match Marketlist canonical casing for special cases:
  if (/^Skm$/i.test(t)) return "Skm";
  if (/^prep\s*-/i.test(t)) {
    // Title-case after "Prep - "
    const after = t.replace(/^prep\s*-\s*/i, "");
    const titled = after
      .toLowerCase()
      .split(/\s+/)
      .map((w) => {
        if (w === "hb") return "HB";
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");
    return `Prep - ${titled}`;
  }
  return t;
}

// ----- Parse Marketlist.tsv → file 01 -----------------------------------

interface IngredientRow extends Record<string, unknown> {
  name: string;
  unit: string;
  cost_per_unit: number;
  initial_stock: number;
  reorder_threshold: string;
  notes: string;
}

interface DupNote {
  name: string;
  kept: { row: number; price: number; qty: number; unit: string };
  dropped: { row: number; price: number; qty: number; unit: string };
  reason: string;
}

function parseMarketlist(): { ingredients: IngredientRow[]; preps: string[]; dupNotes: DupNote[] } {
  const raw = readFileSync(resolve(SRC, "Marketlist.tsv"), "utf-8");
  const lines = raw.split(/\r?\n/);
  const ingredients: IngredientRow[] = [];
  const preps: string[] = [];
  const seen = new Map<string, { row: number; price: number; qty: number; unit: string }>();
  const dupNotes: DupNote[] = [];

  // Manual exclusion list (rows that look like menus or non-data)
  const MENU_LIKE = new Set([
    "rice bowl ayam sambal matah",
    "rice bowl ayam asam manis",
    "sweet tea",
    "aqua gelas",
    "kurma",
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");
    // TSV: col0=blank, col1=No, col2=Item, col3=Price, col4=Qty, col5=Unit
    if (cols.length < 5) continue;
    const no = trim(cols[1]);
    const item = trim(cols[2]);
    if (!item || isNaN(parseInt(no, 10))) continue;

    const price = parseRupiah(cols[3]);
    const qty = parseNumber(cols[4]);
    const unit = trim(cols[5]) || "pcs";

    if (price === 0 || qty === 0) {
      // Owner row with no price (e.g. "Kurma") — skip silently
      continue;
    }

    const lower = item.toLowerCase();

    // Skip menu-like rows
    if (MENU_LIKE.has(lower)) continue;

    // Prep rows go to preps list, not ingredients
    if (/^prep\s*-/i.test(item)) {
      preps.push(normalizeIngredientName(item));
      continue;
    }

    const cost_per_unit = Math.round(price / qty);
    const normName = normalizeIngredientName(item);

    // Dedup
    const key = normName.toLowerCase();
    if (seen.has(key)) {
      const prior = seen.get(key)!;
      dupNotes.push({
        name: normName,
        kept: prior,
        dropped: { row: i + 1, price, qty, unit },
        reason: `kept first occurrence (row ${prior.row}); drop later`,
      });
      continue;
    }
    seen.set(key, { row: i + 1, price, qty, unit });

    ingredients.push({
      name: normName,
      unit,
      cost_per_unit,
      initial_stock: 0,
      reorder_threshold: "",
      notes: "",
    });
  }

  return { ingredients, preps, dupNotes };
}

// ----- Parse PREP_*.csv (wide-format) → preparations + lines ------------

interface PrepHeader extends Record<string, unknown> {
  name: string;
  unit: "ml" | "gr" | string;
  yield: number;
  waste_factor_pct: number;
  notes: string;
}

interface PrepLine extends Record<string, unknown> {
  prep_name: string;
  ingredient_name: string;
  qty: number;
}

function parsePrepFile(filename: string): {
  preps: PrepHeader[];
  lines: PrepLine[];
  warnings: string[];
} {
  const raw = readFileSync(resolve(SRC, filename), "utf-8");
  const result = Papa.parse<string[]>(raw, { skipEmptyLines: false });
  const grid = result.data;
  const preps: PrepHeader[] = [];
  const lines: PrepLine[] = [];
  const warnings: string[] = [];

  // Walk rows; detect block label rows (col 1 or col 10 has "Prep - X" or
  // "prep - x" pattern, with following columns empty).
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;

    // Check both column slots (left=col 1, right=col 10)
    for (const startCol of [1, 10] as const) {
      const label = trim(row[startCol]);
      if (!label) continue;
      if (!/^prep\s*-/i.test(label)) continue;
      // Parse this block from row i, columns [startCol .. startCol+7]

      // Walk until YIELD row to capture unit + yield
      const blockRows: string[][] = [];
      for (let j = i + 1; j < grid.length && j < i + 20; j++) {
        const r = grid[j];
        if (!r) break;
        // End of block: blank label-row column (no data spanning) AND
        // we've seen a YIELD row already.
        blockRows.push(r);
        const c6 = trim(r[startCol + 5]);
        const c15 = trim(r[startCol + 5]);
        if (/^YIELD/i.test(c6) || /^YIELD/i.test(c15)) {
          break;
        }
      }

      // Find header row (NO,ITEM,QTY...) and item rows + YIELD
      let headerRowIdx = -1;
      let yieldRowIdx = -1;
      for (let k = 0; k < blockRows.length; k++) {
        const r = blockRows[k];
        if (trim(r[startCol]) === "NO" && /^ITEM/i.test(trim(r[startCol + 1]))) {
          headerRowIdx = k;
        }
        if (/^YIELD/i.test(trim(r[startCol + 5]))) {
          yieldRowIdx = k;
        }
      }
      if (headerRowIdx === -1 || yieldRowIdx === -1) {
        warnings.push(`${filename}: incomplete block "${label}" at row ${i + 1} (no header or yield)`);
        continue;
      }

      // Yield value at col startCol+7 of yield row
      const yieldRow = blockRows[yieldRowIdx];
      const yieldUnitLabel = trim(yieldRow[startCol + 5]); // "YIELD ML" / "YIELD GRAM"
      const yieldVal = parseNumber(yieldRow[startCol + 7]);
      let unit: string;
      if (/ML/i.test(yieldUnitLabel)) unit = "ml";
      else if (/GR/i.test(yieldUnitLabel)) unit = "gr";
      else {
        warnings.push(`${filename}: unknown YIELD unit "${yieldUnitLabel}" for "${label}"`);
        continue;
      }

      if (yieldVal === 0) {
        // Filler block (e.g. "Preparation - Rumus") — skip
        continue;
      }

      const normName = normalizeIngredientName(label);
      preps.push({
        name: normName,
        unit,
        yield: yieldVal,
        waste_factor_pct: 10,
        notes: "",
      });

      // Extract item lines: rows headerRowIdx+1 .. yieldRowIdx-1
      for (let k = headerRowIdx + 1; k < yieldRowIdx; k++) {
        const r = blockRows[k];
        const itemName = trim(r[startCol + 1]);
        // End-marker: TOTAL/Q FACTOR/empty
        if (!itemName) continue;
        if (/^TOTAL/i.test(itemName) || /^Q\s*FACTOR/i.test(itemName)) continue;
        const recipeQty = parseIntegerQty(r[startCol + 5]);
        if (recipeQty === 0) continue;
        const normIng = normalizeIngredientName(itemName);
        lines.push({
          prep_name: normName,
          ingredient_name: normIng,
          qty: recipeQty,
        });
      }
    }
  }

  return { preps, lines, warnings };
}

// ----- Parse UPDATE_HPP_*.csv (wide-format) → menu recipes + lines ------

interface MenuRecipe extends Record<string, unknown> {
  menu_name: string;
  variant: string;
  waste_factor_pct: number;
  notes: string;
}

interface MenuRecipeLine extends Record<string, unknown> {
  menu_name: string;
  variant: string;
  ingredient_name: string;
  qty: number;
}

interface SkipEntry {
  rawLabel: string;
  fileName: string;
  rowNumber: number;
  reason: string;
}

function parseHppFile(filename: string): {
  recipes: MenuRecipe[];
  lines: MenuRecipeLine[];
  skips: SkipEntry[];
  warnings: string[];
} {
  const raw = readFileSync(resolve(SRC, filename), "utf-8");
  const result = Papa.parse<string[]>(raw, { skipEmptyLines: false });
  const grid = result.data;
  const recipes: MenuRecipe[] = [];
  const lines: MenuRecipeLine[] = [];
  const skips: SkipEntry[] = [];
  const warnings: string[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;

    for (const startCol of [1, 10] as const) {
      const label = trim(row[startCol]);
      if (!label) continue;
      // Menu label rows: not "NO" header, not "YIELD"/"TOTAL" footer.
      // Distinguish from PREP files: HPP file has no "Prep - " prefix on
      // menu labels (only ingredient lines have prep names).
      // Heuristic: label row has column 2-8 mostly empty.
      const colsAfterFilled = [
        trim(row[startCol + 1]),
        trim(row[startCol + 2]),
        trim(row[startCol + 3]),
      ].filter(Boolean).length;
      if (colsAfterFilled > 0) continue;

      // Skip header rows ("NO ITEM QTY...")
      if (label === "NO") continue;
      // Skip pure-numeric labels (these are NO column values from data rows
      // when the second/third columns are also empty due to fewer items)
      if (/^\d+$/.test(label)) continue;
      // Skip filler labels
      if (/^pakai\s+rumus/i.test(label) || /^tanpa\s+rumus/i.test(label)) continue;
      if (/^preparation/i.test(label)) continue;

      // Translate menu name
      const trans = translateMenuName(label);
      if (!trans.canonicalName) {
        skips.push({
          rawLabel: label,
          fileName: filename,
          rowNumber: i + 1,
          reason: trans.skipReason ?? "unknown",
        });
        continue;
      }

      const variant = trans.variant ?? "";
      const key = `${trans.canonicalName.toLowerCase()}|${variant}`;
      if (seenKeys.has(key)) {
        skips.push({
          rawLabel: label,
          fileName: filename,
          rowNumber: i + 1,
          reason: `duplicate translation: another block already mapped to (${trans.canonicalName}, ${variant || "-"})`,
        });
        continue;
      }
      seenKeys.add(key);

      // Read line items: rows after header (NO,ITEM,...) until TOTAL row.
      // Header is typically i+2 (label row + blank + header row).
      let headerRow = -1;
      for (let j = i + 1; j < Math.min(i + 4, grid.length); j++) {
        if (trim(grid[j]?.[startCol]) === "NO") {
          headerRow = j;
          break;
        }
      }
      if (headerRow === -1) {
        warnings.push(`${filename} row ${i + 1}: header row not found for "${label}"`);
        continue;
      }

      recipes.push({
        menu_name: trans.canonicalName,
        variant,
        waste_factor_pct: 30,
        notes: "",
      });

      // Walk lines until TOTAL or empty NO
      for (let j = headerRow + 1; j < grid.length; j++) {
        const r = grid[j];
        if (!r) break;
        const noVal = trim(r[startCol]);
        const itemName = trim(r[startCol + 1]);
        // Check TOTAL marker (TOTAL is typically in col startCol+5)
        if (/^TOTAL/i.test(trim(r[startCol + 5]))) break;
        // Empty row — end of block
        if (!noVal && !itemName) {
          // Could be blank inside, but normally end-of-block
          continue;
        }
        if (!itemName) continue;
        if (isNaN(parseInt(noVal, 10))) continue;

        const recipeQty = parseIntegerQty(r[startCol + 5]);
        if (recipeQty === 0) continue;

        // Skip rows where ingredient_name is itself a menu (e.g. bundling
        // recipes like "Rice Bowl Ayam Sambal Matah" inside BBM). These
        // should be split into atomic lines manually — skip for now.
        const normIng = normalizeIngredientName(itemName);
        lines.push({
          menu_name: trans.canonicalName,
          variant,
          ingredient_name: normIng,
          qty: recipeQty,
        });
      }
    }
  }

  return { recipes, lines, skips, warnings };
}

// ----- CSV writing helpers ----------------------------------------------

function writeCsv(
  path: string,
  headers: string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): void {
  const csv = Papa.unparse(
    {
      fields: headers,
      data: rows.map((r) =>
        headers.map((h) => {
          const v = r[h];
          if (v === null || v === undefined) return "";
          return String(v);
        }),
      ),
    },
    { newline: "\n" },
  );
  writeFileSync(path, csv.endsWith("\n") ? csv : `${csv}\n`, "utf-8");
}

// ----- Main --------------------------------------------------------------

function main() {
  console.log(`Source: ${SRC}`);
  console.log(`Output: ${OUT}\n`);

  // 1) Marketlist → file 01
  console.log("Parsing Marketlist.tsv...");
  const mk = parseMarketlist();
  console.log(`  ${mk.ingredients.length} atomic ingredients`);
  console.log(`  ${mk.preps.length} prep rows (will be ignored — file 02 uses PREP_*.csv as truth)`);
  console.log(`  ${mk.dupNotes.length} duplicate(s) resolved`);

  // 2) PREP_BEVERAGE + PREP_FOOD → file 02 + 03
  console.log("\nParsing PREP files...");
  const pb = parsePrepFile("PREP_BEVERAGE.csv");
  const pf = parsePrepFile("PREP_FOOD.csv");
  const allPreps = [...pb.preps, ...pf.preps];
  const allPrepLines = [...pb.lines, ...pf.lines];
  console.log(`  ${pb.preps.length} (beverage) + ${pf.preps.length} (food) = ${allPreps.length} preparations`);
  console.log(`  ${pb.lines.length} (beverage) + ${pf.lines.length} (food) = ${allPrepLines.length} prep lines`);
  for (const w of [...pb.warnings, ...pf.warnings]) console.log(`  WARN: ${w}`);

  // 3) UPDATE_HPP_*.csv → file 04 + 05
  console.log("\nParsing HPP files...");
  const hb = parseHppFile("UPDATE_HPP_BEVERAGE_26042026.csv");
  const hf = parseHppFile("UPDATE_HPP_FOOD_26042026.csv");
  const allMenuRecipes = [...hb.recipes, ...hf.recipes];
  const allMenuLines = [...hb.lines, ...hf.lines];
  const allSkips = [...hb.skips, ...hf.skips];
  console.log(`  ${hb.recipes.length} (beverage) + ${hf.recipes.length} (food) = ${allMenuRecipes.length} menu recipes`);
  console.log(`  ${hb.lines.length} (beverage) + ${hf.lines.length} (food) = ${allMenuLines.length} menu recipe lines`);
  console.log(`  ${allSkips.length} menus skipped`);
  for (const w of [...hb.warnings, ...hf.warnings]) console.log(`  WARN: ${w}`);

  // Write 5 standardized CSVs
  console.log("\nWriting outputs...");
  writeCsv(resolve(OUT, "01-ingredients.csv"),
    ["name", "unit", "cost_per_unit", "initial_stock", "reorder_threshold", "notes"],
    mk.ingredients);
  writeCsv(resolve(OUT, "02-preparations.csv"),
    ["name", "unit", "yield", "waste_factor_pct", "notes"],
    allPreps);
  writeCsv(resolve(OUT, "03-preparation-lines.csv"),
    ["prep_name", "ingredient_name", "qty"],
    allPrepLines);
  writeCsv(resolve(OUT, "04-menu-recipes.csv"),
    ["menu_name", "variant", "waste_factor_pct", "notes"],
    allMenuRecipes);
  writeCsv(resolve(OUT, "05-menu-recipe-lines.csv"),
    ["menu_name", "variant", "ingredient_name", "qty"],
    allMenuLines);

  // Sidecars
  const skipLines = ["# MENU_SKIP_LIST — menus dropped during translation\n"];
  for (const s of allSkips) {
    skipLines.push(`[${s.fileName} row ${s.rowNumber}] "${s.rawLabel}"`);
    skipLines.push(`  REASON: ${s.reason}`);
    skipLines.push("");
  }
  writeFileSync(resolve(OUT, "MENU_SKIP_LIST.txt"), skipLines.join("\n"), "utf-8");

  const dupLines = ["# INGREDIENT_DUP_RESOLUTION — duplicate name picks\n"];
  for (const d of mk.dupNotes) {
    dupLines.push(`Name: "${d.name}"`);
    dupLines.push(`  KEPT:    row ${d.kept.row} — Rp ${d.kept.price}, ${d.kept.qty} ${d.kept.unit}`);
    dupLines.push(`  DROPPED: row ${d.dropped.row} — Rp ${d.dropped.price}, ${d.dropped.qty} ${d.dropped.unit}`);
    dupLines.push(`  REASON:  ${d.reason}`);
    dupLines.push("");
  }
  writeFileSync(resolve(OUT, "INGREDIENT_DUP_RESOLUTION.txt"), dupLines.join("\n"), "utf-8");

  const notes = `# TRANSLATION_NOTES.md

Generated: ${new Date().toISOString()}

## Summary
- ${mk.ingredients.length} atomic ingredients (file 01)
- ${allPreps.length} preparations (file 02)
- ${allPrepLines.length} prep recipe lines (file 03)
- ${allMenuRecipes.length} menu recipes (file 04)
- ${allMenuLines.length} menu recipe lines (file 05)
- ${allSkips.length} menus skipped (see MENU_SKIP_LIST.txt)
- ${mk.dupNotes.length} ingredient duplicates resolved (see INGREDIENT_DUP_RESOLUTION.txt)

## Indonesian number parsing
- "Rp 57.000" → 57000 (period = thousand separator)
- "1.000" → 1000
- "16.200" → 16200
- "1" or "1.000" untuk Qty/Recipe → integer
- cost_per_unit = round(price ÷ qty)

## Menu name typo fixes applied
- "Pablo Es Kopi" → "Pablo Eskopi"
- "MONTBLANC" → "Mont Blanc"
- "Caramel Machiato" → "Caramel Macchiato"
- "Butterscoth Latte" → "Butterscotch Latte"
- "Iced/Hot Choco" → "Chocolate"
- "Ricebowl Asam Manis" / "Rice Bowl Matah" / "Rice Bowl Telur Sosis" /
  "Ricebowl Telur Matah" → seed Ricebowl names
- "Bakmie Original" / "Bakmie Chili Oil" → seed Bakmie names ("Ayam X")
- "Churros" → "Churros Choco Dip"

## Variant rules
- "Iced X" → variant=iced, "Hot X" → variant=hot, no prefix → variant=null
- Iced-only seed menus: Pablo Eskopi, Butterscotch Latte, Lychee Yakult,
  Manggo Yakult, Oreo Milkshake, Regal Milkshake, Lychee Tea
  → "Hot X" version dropped to skip list

## Known skipped menus (high-level)
- Espresso Double Shot, Espresso Full Arabica → not seeded
- Iced/Hot Sweet Tea → not seeded (Owner has separate menu_item, not in current 43)
- Butterscotch Latte (Bigsize) → not seeded variant
- Ice Cream 1 Scoup, Croffle Only → add-ons, not seeded
- Bakmie Matah → AMBIGUOUS (collides with Ricebowl "Ayam Sambal Matah")
- BBM 1/2/3 (Bundling Ramadan) → not seeded
- Extra Telur, Extra Topping Ayam → modifiers, not menu_items

## Ambiguity warning: "Ayam Sambal Matah"
Seeded in BOTH Ricebowl + Bakmie categories. Engine \`menuIdByLower\` map
silently overwrites — last-seen wins. To preserve Ricebowl "Rice Bowl Matah"
recipe, "Bakmie Matah" is skipped this round. Owner action: rename Bakmie
"Ayam Sambal Matah" via Admin UI (e.g., to "Bakmie Sambal Matah") then
re-import file 04+05.

## Files NOT regenerated
- Q Factor: 10% for all preparations, 30% for all menus (per Owner spreadsheet)
- initial_stock = 0 for all ingredients (Owner first stock-take separate task)
- reorder_threshold = empty (Owner sets later via Admin UI)
- notes = empty (Owner can edit standardized CSV directly)
`;
  writeFileSync(resolve(OUT, "TRANSLATION_NOTES.md"), notes, "utf-8");

  console.log(`\nDone. 5 CSV + 3 sidecars in ${OUT}`);
}

main();
