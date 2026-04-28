/**
 * Pure helpers for the M23.4 CSV importer. No DB, no `server-only` — testable
 * in isolation + reusable di browser/UI nanti kalau perlu.
 *
 * Owns:
 *   - Row validation + normalization (raw CSV → typed parsed row + error)
 *   - Action diff (existing DB state vs parsed row → NEW | UPDATE | SKIP)
 *   - Topological sort untuk preparation insert order
 *   - Error formatting (file, row index → human-readable message)
 */
import { parseRupiah } from "@/lib/money";

// ----------------------------------------------------------------------------
// Row types (parsed)
// ----------------------------------------------------------------------------

export interface ParsedIngredientRow {
  name: string;
  unit: string;
  costPerUnit: number;
  initialStock: number;
  reorderThreshold: number | null;
  notes: string | null;
}

export interface ParsedPreparationRow {
  name: string;
  unit: string;
  yield: number;
  wasteFactorPct: number;
  notes: string | null;
}

export interface ParsedPrepLineRow {
  prepName: string;
  ingredientName: string;
  qty: number;
}

export interface ParsedMenuRecipeRow {
  menuName: string;
  variant: "hot" | "iced" | null;
  wasteFactorPct: number;
  notes: string | null;
}

export interface ParsedMenuRecipeLineRow {
  menuName: string;
  variant: "hot" | "iced" | null;
  ingredientName: string;
  qty: number;
}

// ----------------------------------------------------------------------------
// Row error
// ----------------------------------------------------------------------------

export interface RowError {
  /** File row number (1-indexed; header = 1, first data = 2). */
  row: number;
  /** Column name in the source CSV. */
  field?: string;
  /** Human-readable error message. */
  message: string;
}

// ----------------------------------------------------------------------------
// Row normalizers
// ----------------------------------------------------------------------------

const EXAMPLE_NAME_PATTERN = /^EXAMPLE_DELETE_ME$/i;

function isEmptyRow(raw: Record<string, string>): boolean {
  return Object.values(raw).every((v) => v == null || v.trim() === "");
}

function isExampleRow(name: string | undefined): boolean {
  return !!name && EXAMPLE_NAME_PATTERN.test(name.trim());
}

function parseIntField(
  value: string | undefined,
  field: string,
  row: number,
  errors: RowError[],
  opts: { min?: number; max?: number; allowEmpty?: boolean; emptyAs?: number | null } = {},
): number | null {
  const raw = (value ?? "").trim();
  if (raw === "") {
    if (opts.allowEmpty) return opts.emptyAs ?? null;
    errors.push({ row, field, message: `${field} kosong` });
    return null;
  }
  // Forward-compat: accept "Rp 57.000" via parseRupiah, plus plain integer.
  let n: number;
  try {
    n = parseRupiah(raw);
  } catch {
    errors.push({ row, field, message: `${field} bukan angka valid: "${raw}"` });
    return null;
  }
  if (opts.min !== undefined && n < opts.min) {
    errors.push({ row, field, message: `${field}=${n} harus >= ${opts.min}` });
    return null;
  }
  if (opts.max !== undefined && n > opts.max) {
    errors.push({ row, field, message: `${field}=${n} harus <= ${opts.max}` });
    return null;
  }
  return n;
}

function parseStringField(
  value: string | undefined,
  field: string,
  row: number,
  errors: RowError[],
  opts: { required?: boolean; maxLen?: number } = {},
): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") {
    if (opts.required) {
      errors.push({ row, field, message: `${field} kosong` });
      return null;
    }
    return null;
  }
  if (opts.maxLen && raw.length > opts.maxLen) {
    errors.push({ row, field, message: `${field} terlalu panjang (max ${opts.maxLen})` });
    return null;
  }
  return raw;
}

function parseVariantField(
  value: string | undefined,
  row: number,
  errors: RowError[],
): "hot" | "iced" | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "") return null;
  if (raw === "hot") return "hot";
  if (raw === "iced") return "iced";
  errors.push({
    row,
    field: "variant",
    message: `variant harus 'hot', 'iced', atau kosong (got "${value}")`,
  });
  return null;
}

export function normalizeIngredientRow(
  raw: Record<string, string>,
  row: number,
): { row?: ParsedIngredientRow; errors: RowError[]; skipped?: "empty" | "example" } {
  if (isEmptyRow(raw)) return { errors: [], skipped: "empty" };
  if (isExampleRow(raw.name)) return { errors: [], skipped: "example" };

  const errors: RowError[] = [];
  const name = parseStringField(raw.name, "name", row, errors, { required: true, maxLen: 80 });
  const unit = parseStringField(raw.unit, "unit", row, errors, { required: true, maxLen: 16 });
  const costPerUnit = parseIntField(raw.cost_per_unit, "cost_per_unit", row, errors, { min: 0 });
  const initialStock = parseIntField(raw.initial_stock, "initial_stock", row, errors, {
    min: 0,
    allowEmpty: true,
    emptyAs: 0,
  });
  const reorderThreshold = parseIntField(raw.reorder_threshold, "reorder_threshold", row, errors, {
    min: 0,
    allowEmpty: true,
    emptyAs: null,
  });
  const notes = parseStringField(raw.notes, "notes", row, errors, { maxLen: 500 });

  if (errors.length > 0 || name === null || unit === null || costPerUnit === null) {
    return { errors };
  }
  return {
    row: {
      name,
      unit,
      costPerUnit,
      initialStock: initialStock ?? 0,
      reorderThreshold: reorderThreshold,
      notes,
    },
    errors: [],
  };
}

export function normalizePreparationRow(
  raw: Record<string, string>,
  row: number,
): { row?: ParsedPreparationRow; errors: RowError[]; skipped?: "empty" | "example" } {
  if (isEmptyRow(raw)) return { errors: [], skipped: "empty" };
  if (isExampleRow(raw.name)) return { errors: [], skipped: "example" };

  const errors: RowError[] = [];
  const name = parseStringField(raw.name, "name", row, errors, { required: true, maxLen: 80 });
  const unit = parseStringField(raw.unit, "unit", row, errors, { required: true, maxLen: 16 });
  const yieldVal = parseIntField(raw.yield, "yield", row, errors, { min: 1 });
  const wasteFactorPct = parseIntField(raw.waste_factor_pct, "waste_factor_pct", row, errors, {
    min: 0,
    max: 200,
  });
  const notes = parseStringField(raw.notes, "notes", row, errors, { maxLen: 500 });

  if (errors.length > 0 || name === null || unit === null || yieldVal === null || wasteFactorPct === null) {
    return { errors };
  }
  return {
    row: { name, unit, yield: yieldVal, wasteFactorPct, notes },
    errors: [],
  };
}

export function normalizePrepLineRow(
  raw: Record<string, string>,
  row: number,
): { row?: ParsedPrepLineRow; errors: RowError[]; skipped?: "empty" | "example" } {
  if (isEmptyRow(raw)) return { errors: [], skipped: "empty" };
  if (isExampleRow(raw.prep_name) || isExampleRow(raw.ingredient_name)) {
    return { errors: [], skipped: "example" };
  }

  const errors: RowError[] = [];
  const prepName = parseStringField(raw.prep_name, "prep_name", row, errors, { required: true });
  const ingredientName = parseStringField(raw.ingredient_name, "ingredient_name", row, errors, {
    required: true,
  });
  const qty = parseIntField(raw.qty, "qty", row, errors, { min: 1 });

  if (errors.length > 0 || prepName === null || ingredientName === null || qty === null) {
    return { errors };
  }
  return { row: { prepName, ingredientName, qty }, errors: [] };
}

export function normalizeMenuRecipeRow(
  raw: Record<string, string>,
  row: number,
): { row?: ParsedMenuRecipeRow; errors: RowError[]; skipped?: "empty" | "example" } {
  if (isEmptyRow(raw)) return { errors: [], skipped: "empty" };
  if (isExampleRow(raw.menu_name)) return { errors: [], skipped: "example" };

  const errors: RowError[] = [];
  const menuName = parseStringField(raw.menu_name, "menu_name", row, errors, { required: true, maxLen: 80 });
  const variant = parseVariantField(raw.variant, row, errors);
  const wasteFactorPct = parseIntField(raw.waste_factor_pct, "waste_factor_pct", row, errors, {
    min: 0,
    max: 200,
  });
  const notes = parseStringField(raw.notes, "notes", row, errors, { maxLen: 500 });

  if (errors.length > 0 || menuName === null || wasteFactorPct === null) {
    return { errors };
  }
  return { row: { menuName, variant, wasteFactorPct, notes }, errors: [] };
}

export function normalizeMenuRecipeLineRow(
  raw: Record<string, string>,
  row: number,
): { row?: ParsedMenuRecipeLineRow; errors: RowError[]; skipped?: "empty" | "example" } {
  if (isEmptyRow(raw)) return { errors: [], skipped: "empty" };
  if (isExampleRow(raw.menu_name) || isExampleRow(raw.ingredient_name)) {
    return { errors: [], skipped: "example" };
  }

  const errors: RowError[] = [];
  const menuName = parseStringField(raw.menu_name, "menu_name", row, errors, { required: true });
  const variant = parseVariantField(raw.variant, row, errors);
  const ingredientName = parseStringField(raw.ingredient_name, "ingredient_name", row, errors, {
    required: true,
  });
  const qty = parseIntField(raw.qty, "qty", row, errors, { min: 1 });

  if (errors.length > 0 || menuName === null || ingredientName === null || qty === null) {
    return { errors };
  }
  return { row: { menuName, variant, ingredientName, qty }, errors: [] };
}

// ----------------------------------------------------------------------------
// Diff helpers
// ----------------------------------------------------------------------------

export type DiffAction = "NEW" | "UPDATE" | "SKIP";

export interface IngredientDiff {
  action: DiffAction;
  changedFields: string[];
  costChanged: boolean;
}

interface ExistingIngredient {
  costPerUnit: number;
  unit: string;
  reorderThreshold: number | null;
  notes: string | null;
}

export function diffIngredient(
  existing: ExistingIngredient | null,
  parsed: ParsedIngredientRow,
): IngredientDiff {
  if (existing === null) {
    return { action: "NEW", changedFields: [], costChanged: false };
  }
  const changes: string[] = [];
  if (existing.costPerUnit !== parsed.costPerUnit) changes.push("cost_per_unit");
  if (existing.unit !== parsed.unit) changes.push("unit");
  if ((existing.reorderThreshold ?? null) !== (parsed.reorderThreshold ?? null)) {
    changes.push("reorder_threshold");
  }
  if ((existing.notes ?? null) !== (parsed.notes ?? null)) changes.push("notes");
  if (changes.length === 0) return { action: "SKIP", changedFields: [], costChanged: false };
  return {
    action: "UPDATE",
    changedFields: changes,
    costChanged: changes.includes("cost_per_unit"),
  };
}

export interface PreparationDiff {
  action: DiffAction;
  changedFields: string[];
  yieldChanged: boolean;
}

interface ExistingPreparation {
  unit: string;
  yield: number;
  notes: string | null;
}

export function diffPreparation(
  existing: ExistingPreparation | null,
  parsed: ParsedPreparationRow,
): PreparationDiff {
  if (existing === null) {
    return { action: "NEW", changedFields: [], yieldChanged: false };
  }
  const changes: string[] = [];
  if (existing.unit !== parsed.unit) changes.push("unit");
  if (existing.yield !== parsed.yield) changes.push("yield");
  if ((existing.notes ?? null) !== (parsed.notes ?? null)) changes.push("notes");
  if (changes.length === 0) return { action: "SKIP", changedFields: [], yieldChanged: false };
  return { action: "UPDATE", changedFields: changes, yieldChanged: changes.includes("yield") };
}

// ----------------------------------------------------------------------------
// Duplicate detection within a single file
// ----------------------------------------------------------------------------

export function findDuplicateNames<T extends { name: string }>(
  rows: ReadonlyArray<{ row: number; data: T }>,
): RowError[] {
  const seen = new Map<string, number>();
  const errors: RowError[] = [];
  for (const { row, data } of rows) {
    const key = data.name.trim().toLowerCase();
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      errors.push({
        row,
        field: "name",
        message: `name duplikat dengan baris ${firstSeen} ("${data.name}")`,
      });
    } else {
      seen.set(key, row);
    }
  }
  return errors;
}

export function findDuplicatePrepLines(
  rows: ReadonlyArray<{ row: number; data: ParsedPrepLineRow }>,
): RowError[] {
  const seen = new Map<string, number>();
  const errors: RowError[] = [];
  for (const { row, data } of rows) {
    const key = `${data.prepName.toLowerCase()}|${data.ingredientName.toLowerCase()}`;
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      errors.push({
        row,
        message: `kombinasi (prep_name, ingredient_name) duplikat dengan baris ${firstSeen}`,
      });
    } else {
      seen.set(key, row);
    }
  }
  return errors;
}

export function findDuplicateMenuRecipeLines(
  rows: ReadonlyArray<{ row: number; data: ParsedMenuRecipeLineRow }>,
): RowError[] {
  const seen = new Map<string, number>();
  const errors: RowError[] = [];
  for (const { row, data } of rows) {
    const key = `${data.menuName.toLowerCase()}|${data.variant ?? ""}|${data.ingredientName.toLowerCase()}`;
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      errors.push({
        row,
        message: `kombinasi (menu_name, variant, ingredient_name) duplikat dengan baris ${firstSeen}`,
      });
    } else {
      seen.set(key, row);
    }
  }
  return errors;
}

// ----------------------------------------------------------------------------
// Topological sort untuk prep insert order (Kahn's algorithm)
// ----------------------------------------------------------------------------

/**
 * Returns prep names in dependency-safe order (deps come first).
 * Throws if cycle detected (defense; pre-flight cycle check catches earlier).
 */
export function topologicalSortPreps(
  prepNames: ReadonlyArray<string>,
  prepDeps: ReadonlyMap<string, ReadonlyArray<string>>,
): string[] {
  const inDegree = new Map<string, number>();
  const reverseDeps = new Map<string, string[]>(); // dep → [preps that depend on it]
  for (const name of prepNames) {
    inDegree.set(name, 0);
    reverseDeps.set(name, []);
  }
  for (const [prep, deps] of prepDeps) {
    for (const dep of deps) {
      if (prepNames.includes(dep)) {
        // Only count deps that are themselves in our prep set (atomic deps don't count).
        inDegree.set(prep, (inDegree.get(prep) ?? 0) + 1);
        reverseDeps.get(dep)!.push(prep);
      }
    }
  }
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }
  const result: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    result.push(cur);
    for (const dependent of reverseDeps.get(cur) ?? []) {
      const d = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, d);
      if (d === 0) queue.push(dependent);
    }
  }
  if (result.length !== prepNames.length) {
    const remaining = prepNames.filter((n) => !result.includes(n));
    throw new Error(`CYCLE_IN_PREP_GRAPH: ${remaining.join(", ")}`);
  }
  return result;
}

// ----------------------------------------------------------------------------
// Variant key utility
// ----------------------------------------------------------------------------

export function menuRecipeKey(menuName: string, variant: "hot" | "iced" | null): string {
  return `${menuName.trim().toLowerCase()}|${variant ?? ""}`;
}
