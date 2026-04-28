// Server-side: pulls in @/db. CLI scripts (M23.4 importer) intentionally
// reuse this module to share cascade engine + cycle detect with the UI path.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  menuItems,
  recipeIngredients,
  recipes,
} from "@/db/schema";
import {
  buildPrepAdjacency,
  cascadeCostUpdate,
} from "./preparation-flow";
import { validateNoCycle } from "./preparation-flow-pure";
import {
  diffIngredient,
  diffPreparation,
  findDuplicateMenuRecipeLines,
  findDuplicateNames,
  findDuplicatePrepLines,
  menuRecipeKey,
  topologicalSortPreps,
  type ParsedIngredientRow,
  type ParsedMenuRecipeLineRow,
  type ParsedMenuRecipeRow,
  type ParsedPrepLineRow,
  type ParsedPreparationRow,
  type RowError,
} from "./import-engine-pure";

/**
 * M23.4 — Server-side orchestrator for the inventory CSV importer. Owns
 * reconcile (diff), cycle pre-flight, topo sort, and writes (apply mode).
 * Dry-run runs the same code path under `db.transaction` + sentinel rollback.
 */

export interface RunRow<T> {
  /** 1-indexed file row number for traceability. */
  row: number;
  data: T;
}

export interface ImportInput {
  ingredients: RunRow<ParsedIngredientRow>[];
  preparations: RunRow<ParsedPreparationRow>[];
  prepLines: RunRow<ParsedPrepLineRow>[];
  menuRecipes: RunRow<ParsedMenuRecipeRow>[];
  menuRecipeLines: RunRow<ParsedMenuRecipeLineRow>[];
}

export interface RowAction {
  row: number;
  action: "NEW" | "UPDATE" | "SKIP" | "ERROR";
  name: string;
  detail?: string;
}

export interface ImportReport {
  errors: Array<{ file: string; error: RowError }>;
  ingredients: RowAction[];
  preparations: RowAction[];
  prepLines: RowAction[];
  menuRecipes: RowAction[];
  menuRecipeLines: RowAction[];
  counts: {
    ingredients: { new: number; update: number; skip: number; error: number };
    preparations: { new: number; update: number; skip: number; error: number };
    prepLines: { new: number; error: number };
    menuRecipes: { new: number; update: number; skip: number; error: number };
    menuRecipeLines: { new: number; error: number };
  };
  hasErrors: boolean;
}

export interface RunOptions {
  outletId: string;
  userId: string | null;
  apply: boolean;
  runId: string;
}

const ROLLBACK_SENTINEL = Symbol("DRY_RUN_ROLLBACK");

/**
 * Top-level entry. Runs everything inside a single tx; commits on `apply` only.
 */
export async function runImport(
  input: ImportInput,
  opts: RunOptions,
): Promise<ImportReport> {
  const report: ImportReport = {
    errors: [],
    ingredients: [],
    preparations: [],
    prepLines: [],
    menuRecipes: [],
    menuRecipeLines: [],
    counts: {
      ingredients: { new: 0, update: 0, skip: 0, error: 0 },
      preparations: { new: 0, update: 0, skip: 0, error: 0 },
      prepLines: { new: 0, error: 0 },
      menuRecipes: { new: 0, update: 0, skip: 0, error: 0 },
      menuRecipeLines: { new: 0, error: 0 },
    },
    hasErrors: false,
  };

  // ---- Phase 1 — pre-flight (no DB writes; just validation) ----
  const dupIngErrors = findDuplicateNames(
    input.ingredients.map((r) => ({ row: r.row, data: { name: r.data.name } })),
  );
  for (const e of dupIngErrors) {
    report.errors.push({ file: "01-ingredients.csv", error: e });
  }
  const dupPrepErrors = findDuplicateNames(
    input.preparations.map((r) => ({ row: r.row, data: { name: r.data.name } })),
  );
  for (const e of dupPrepErrors) {
    report.errors.push({ file: "02-preparations.csv", error: e });
  }
  const dupPrepLineErrors = findDuplicatePrepLines(input.prepLines);
  for (const e of dupPrepLineErrors) {
    report.errors.push({ file: "03-preparation-lines.csv", error: e });
  }
  const dupMenuRecipeKeys = new Set<string>();
  for (const r of input.menuRecipes) {
    const k = menuRecipeKey(r.data.menuName, r.data.variant);
    if (dupMenuRecipeKeys.has(k)) {
      report.errors.push({
        file: "04-menu-recipes.csv",
        error: { row: r.row, message: `(menu_name, variant) duplikat` },
      });
    }
    dupMenuRecipeKeys.add(k);
  }
  const dupMenuLineErrors = findDuplicateMenuRecipeLines(input.menuRecipeLines);
  for (const e of dupMenuLineErrors) {
    report.errors.push({ file: "05-menu-recipe-lines.csv", error: e });
  }

  // Cross-file: ingredient + prep names must not collide.
  const ingNamesLower = new Set(input.ingredients.map((r) => r.data.name.toLowerCase()));
  const prepNamesLower = new Set(input.preparations.map((r) => r.data.name.toLowerCase()));
  for (const n of ingNamesLower) {
    if (prepNamesLower.has(n)) {
      report.errors.push({
        file: "01-ingredients.csv",
        error: {
          row: 0,
          message: `name "${n}" muncul di file 01 dan 02 — pilih salah satu`,
        },
      });
    }
  }

  // ---- Phase 2 — DB-bound work in a transaction ----
  // Wrap dry-run in tx + sentinel for consistent code path with apply.
  try {
    await db.transaction(async (tx) => {
      // Snapshot existing state.
      const existingIngs = await tx
        .select({
          id: ingredients.id,
          name: ingredients.name,
          unit: ingredients.unit,
          costPerUnit: ingredients.costPerUnit,
          reorderThreshold: ingredients.reorderThreshold,
          notes: ingredients.notes,
          isPreparation: ingredients.isPreparation,
          preparationYield: ingredients.preparationYield,
        })
        .from(ingredients)
        .where(
          and(
            eq(ingredients.outletId, opts.outletId),
            isNull(ingredients.deletedAt),
          ),
        );
      const existingByLower = new Map<string, (typeof existingIngs)[number]>();
      for (const r of existingIngs) existingByLower.set(r.name.trim().toLowerCase(), r);

      // ---- File 01 — atomic ingredients ----
      const newIngIds = new Map<string, string>(); // lowerName → id (post-insert)
      for (const { row, data } of input.ingredients) {
        const key = data.name.trim().toLowerCase();
        const existing = existingByLower.get(key);

        // Refuse if existing is preparation (clash).
        if (existing && existing.isPreparation) {
          report.ingredients.push({
            row,
            action: "ERROR",
            name: data.name,
            detail: "name bentrok dengan existing preparation",
          });
          report.counts.ingredients.error++;
          continue;
        }

        const diff = diffIngredient(
          existing
            ? {
                costPerUnit: existing.costPerUnit,
                unit: existing.unit,
                reorderThreshold: existing.reorderThreshold,
                notes: existing.notes,
              }
            : null,
          data,
        );

        if (diff.action === "NEW") {
          const [inserted] = await tx
            .insert(ingredients)
            .values({
              outletId: opts.outletId,
              name: data.name,
              unit: data.unit,
              costPerUnit: data.costPerUnit,
              currentStock: data.initialStock,
              reorderThreshold: data.reorderThreshold,
              notes: data.notes,
              isPreparation: false,
              createdBy: opts.userId,
              updatedBy: opts.userId,
            })
            .returning({ id: ingredients.id });
          newIngIds.set(key, inserted.id);

          if (data.initialStock > 0) {
            await tx.insert(inventoryMovements).values({
              outletId: opts.outletId,
              ingredientId: inserted.id,
              kind: "initial",
              qtyDelta: data.initialStock,
              unitCostAtMovement: data.costPerUnit,
              referenceType: "manual",
              reason: `Import run ${opts.runId}`,
              createdBy: opts.userId,
            });
          }
          report.ingredients.push({
            row,
            action: "NEW",
            name: data.name,
            detail: `${data.costPerUnit}/${data.unit}`,
          });
          report.counts.ingredients.new++;
        } else if (diff.action === "UPDATE" && existing) {
          await tx
            .update(ingredients)
            .set({
              unit: data.unit,
              costPerUnit: data.costPerUnit,
              reorderThreshold: data.reorderThreshold,
              notes: data.notes,
              updatedAt: new Date(),
              updatedBy: opts.userId,
              ...(diff.costChanged ? { costLastChangedAt: new Date() } : {}),
            })
            .where(eq(ingredients.id, existing.id));

          // Cascade if cost changed.
          if (diff.costChanged) {
            await cascadeCostUpdate(
              tx,
              opts.outletId,
              existing.id,
              opts.userId ?? "00000000-0000-0000-0000-000000000000",
            );
          }
          report.ingredients.push({
            row,
            action: "UPDATE",
            name: data.name,
            detail: diff.changedFields.join(", "),
          });
          report.counts.ingredients.update++;
        } else {
          report.ingredients.push({ row, action: "SKIP", name: data.name });
          report.counts.ingredients.skip++;
        }
      }

      // ---- File 02 — preparations ----
      const newPrepIds = new Map<string, string>();
      for (const { row, data } of input.preparations) {
        const key = data.name.trim().toLowerCase();
        const existing = existingByLower.get(key);

        if (existing && !existing.isPreparation) {
          report.preparations.push({
            row,
            action: "ERROR",
            name: data.name,
            detail: "name bentrok dengan existing atomic ingredient",
          });
          report.counts.preparations.error++;
          continue;
        }

        const diff = existing
          ? diffPreparation(
              {
                unit: existing.unit,
                yield: existing.preparationYield ?? 0,
                notes: existing.notes,
              },
              data,
            )
          : { action: "NEW" as const, changedFields: [], yieldChanged: false };

        if (diff.action === "NEW") {
          const [inserted] = await tx
            .insert(ingredients)
            .values({
              outletId: opts.outletId,
              name: data.name,
              unit: data.unit,
              costPerUnit: 0, // populated by cascade after recipe insert
              currentStock: 0,
              isPreparation: true,
              preparationYield: data.yield,
              notes: data.notes,
              createdBy: opts.userId,
              updatedBy: opts.userId,
            })
            .returning({ id: ingredients.id });
          newPrepIds.set(key, inserted.id);
          report.preparations.push({
            row,
            action: "NEW",
            name: data.name,
            detail: `yield ${data.yield} ${data.unit}, Q${data.wasteFactorPct}%`,
          });
          report.counts.preparations.new++;
        } else if (diff.action === "UPDATE" && existing) {
          await tx
            .update(ingredients)
            .set({
              unit: data.unit,
              preparationYield: data.yield,
              notes: data.notes,
              updatedAt: new Date(),
              updatedBy: opts.userId,
            })
            .where(eq(ingredients.id, existing.id));
          report.preparations.push({
            row,
            action: "UPDATE",
            name: data.name,
            detail: diff.changedFields.join(", "),
          });
          report.counts.preparations.update++;
        } else {
          report.preparations.push({ row, action: "SKIP", name: data.name });
          report.counts.preparations.skip++;
        }
      }

      // ---- File 03 — preparation recipe lines ----
      // Build prepName → prepId map (combine new + existing).
      const prepIdByLower = new Map<string, string>();
      for (const [k, v] of newPrepIds) prepIdByLower.set(k, v);
      for (const r of existingIngs) {
        if (r.isPreparation) prepIdByLower.set(r.name.trim().toLowerCase(), r.id);
      }
      // Build ingredientName → ingredientId map (atomic OR prep).
      const allIngIdByLower = new Map<string, string>();
      for (const [k, v] of newIngIds) allIngIdByLower.set(k, v);
      for (const [k, v] of newPrepIds) allIngIdByLower.set(k, v);
      for (const r of existingIngs) allIngIdByLower.set(r.name.trim().toLowerCase(), r.id);

      // Group prep lines by prep name.
      const linesByPrepLower = new Map<string, RunRow<ParsedPrepLineRow>[]>();
      for (const r of input.prepLines) {
        const k = r.data.prepName.trim().toLowerCase();
        const list = linesByPrepLower.get(k) ?? [];
        list.push(r);
        linesByPrepLower.set(k, list);
      }

      // Validate references + build proposed adjacency for cycle check.
      const proposedAdj = new Map<string, string[]>(); // prepId → ingredientIds
      const prepLineErrors = new Set<number>(); // row numbers that have errors
      for (const [prepLower, lines] of linesByPrepLower) {
        const prepId = prepIdByLower.get(prepLower);
        if (!prepId) {
          for (const l of lines) {
            report.prepLines.push({
              row: l.row,
              action: "ERROR",
              name: l.data.prepName,
              detail: "prep_name tidak ditemukan di file 02 atau DB existing",
            });
            prepLineErrors.add(l.row);
            report.counts.prepLines.error++;
          }
          continue;
        }
        const ingIds: string[] = [];
        for (const l of lines) {
          const ingLower = l.data.ingredientName.trim().toLowerCase();
          const ingId = allIngIdByLower.get(ingLower);
          if (!ingId) {
            report.prepLines.push({
              row: l.row,
              action: "ERROR",
              name: `${l.data.prepName} ← ${l.data.ingredientName}`,
              detail: "ingredient_name tidak ditemukan di file 01, 02, atau DB existing",
            });
            prepLineErrors.add(l.row);
            report.counts.prepLines.error++;
            continue;
          }
          ingIds.push(ingId);
        }
        proposedAdj.set(prepId, ingIds);
      }

      // Cycle pre-flight: merge with existing adjacency, check each proposed prep.
      const existingAdj = await buildPrepAdjacency(tx, opts.outletId);
      const mergedAdj = new Map<string, string[]>(existingAdj);
      for (const [prepId, ingIds] of proposedAdj) {
        mergedAdj.set(prepId, ingIds); // overwrite since we'll REPLACE
      }
      for (const [prepId, proposed] of proposedAdj) {
        if (validateNoCycle(mergedAdj, prepId, proposed)) {
          for (const l of input.prepLines) {
            const k = l.data.prepName.trim().toLowerCase();
            if (prepIdByLower.get(k) === prepId) {
              report.prepLines.push({
                row: l.row,
                action: "ERROR",
                name: l.data.prepName,
                detail: "akan membentuk siklus dependensi",
              });
              prepLineErrors.add(l.row);
              report.counts.prepLines.error++;
            }
          }
          proposedAdj.delete(prepId);
        }
      }

      // Topo-sort preps for insert order.
      // Build name-based deps from proposed lines (only including preps within proposed set).
      const prepNamesSet = new Set([...prepIdByLower.keys()]);
      const prepDepsByName = new Map<string, string[]>();
      for (const [prepLower, lines] of linesByPrepLower) {
        if (prepLineErrors.size > 0 && lines.some((l) => prepLineErrors.has(l.row))) {
          continue; // skip preps with errors
        }
        const deps = lines
          .map((l) => l.data.ingredientName.trim().toLowerCase())
          .filter((n) => prepNamesSet.has(n)); // only count prep deps
        prepDepsByName.set(prepLower, deps);
      }
      let prepOrder: string[];
      try {
        prepOrder = topologicalSortPreps(
          Array.from(prepDepsByName.keys()),
          prepDepsByName,
        );
      } catch {
        // Cycle detected at topo level — should have been caught above. Fallback:
        prepOrder = Array.from(prepDepsByName.keys());
      }

      // Apply: replace recipe lines per prep, then cascade.
      for (const prepLower of prepOrder) {
        const lines = linesByPrepLower.get(prepLower);
        if (!lines) continue;
        const prepId = prepIdByLower.get(prepLower);
        if (!prepId) continue;
        if (lines.some((l) => prepLineErrors.has(l.row))) continue;

        // Look up existing recipe for this prep, or create one.
        const [existingRecipe] = await tx
          .select({ id: recipes.id })
          .from(recipes)
          .where(
            and(
              eq(recipes.ingredientId, prepId),
              eq(recipes.outletId, opts.outletId),
              eq(recipes.isActive, true),
            ),
          )
          .limit(1);

        // Find the matching prep row to get wasteFactorPct.
        const prepRow = input.preparations.find(
          (p) => p.data.name.trim().toLowerCase() === prepLower,
        );
        const waste = prepRow?.data.wasteFactorPct ?? 10;

        let recipeId: string;
        if (existingRecipe) {
          await tx
            .update(recipes)
            .set({ wasteFactorPct: waste, updatedBy: opts.userId, updatedAt: new Date() })
            .where(eq(recipes.id, existingRecipe.id));
          await tx
            .delete(recipeIngredients)
            .where(eq(recipeIngredients.recipeId, existingRecipe.id));
          recipeId = existingRecipe.id;
        } else {
          const [inserted] = await tx
            .insert(recipes)
            .values({
              outletId: opts.outletId,
              ingredientId: prepId,
              wasteFactorPct: waste,
              createdBy: opts.userId,
              updatedBy: opts.userId,
            })
            .returning({ id: recipes.id });
          recipeId = inserted.id;
        }

        await tx.insert(recipeIngredients).values(
          lines.map((l) => ({
            recipeId,
            ingredientId: allIngIdByLower.get(l.data.ingredientName.trim().toLowerCase())!,
            qty: l.data.qty,
          })),
        );
        for (const l of lines) {
          report.prepLines.push({
            row: l.row,
            action: "NEW",
            name: `${l.data.prepName} ← ${l.data.ingredientName}`,
            detail: `qty ${l.data.qty}`,
          });
          report.counts.prepLines.new++;
        }

        // Cascade cost — recompute this prep + anything depending on it.
        await cascadeCostUpdate(
          tx,
          opts.outletId,
          prepId,
          opts.userId ?? "00000000-0000-0000-0000-000000000000",
        );
      }

      // ---- File 04 — menu recipes ----
      // Lookup menu_items by name within this outlet.
      const menuRows = await tx
        .select({ id: menuItems.id, name: menuItems.name })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.outletId, opts.outletId),
            isNull(menuItems.deletedAt),
          ),
        );
      // M23.6 fix: detect duplicate menu_item names across categories.
      // Without this, the map silently overwrites and recipes land on the
      // wrong menu_item (Mahakan: "Ayam Sambal Matah" exists di Ricebowl +
      // Bakmie). Track ambiguous names so we can ERROR on lookup instead.
      const menuIdByLower = new Map<string, string>();
      const ambiguousNames = new Set<string>();
      for (const m of menuRows) {
        const key = m.name.trim().toLowerCase();
        if (menuIdByLower.has(key)) {
          ambiguousNames.add(key);
        } else {
          menuIdByLower.set(key, m.id);
        }
      }

      // Resolve recipe_id per (menu, variant).
      const menuRecipeIdByKey = new Map<string, string>(); // key → recipe_id
      const menuRecipeErrors = new Set<string>(); // keys with error (to skip lines later)
      for (const { row, data } of input.menuRecipes) {
        const lowered = data.menuName.trim().toLowerCase();
        if (ambiguousNames.has(lowered)) {
          report.menuRecipes.push({
            row,
            action: "ERROR",
            name: data.menuName,
            detail: `menu_name "${data.menuName}" ada di lebih dari 1 kategori — rename salah satu via Admin UI dulu`,
          });
          menuRecipeErrors.add(menuRecipeKey(data.menuName, data.variant));
          report.counts.menuRecipes.error++;
          continue;
        }
        const menuId = menuIdByLower.get(lowered);
        if (!menuId) {
          report.menuRecipes.push({
            row,
            action: "ERROR",
            name: data.menuName,
            detail: `menu_name tidak ditemukan di outlet (tambah via UI dulu)`,
          });
          menuRecipeErrors.add(menuRecipeKey(data.menuName, data.variant));
          report.counts.menuRecipes.error++;
          continue;
        }

        // Match existing recipe by (menuItemId, variant).
        const existing = await tx
          .select({ id: recipes.id, wasteFactorPct: recipes.wasteFactorPct, notes: recipes.notes })
          .from(recipes)
          .where(
            and(
              eq(recipes.outletId, opts.outletId),
              eq(recipes.menuItemId, menuId),
              data.variant === null
                ? isNull(recipes.variant)
                : eq(recipes.variant, data.variant),
              eq(recipes.isActive, true),
            ),
          )
          .limit(1);

        if (existing.length === 0) {
          const [inserted] = await tx
            .insert(recipes)
            .values({
              outletId: opts.outletId,
              menuItemId: menuId,
              variant: data.variant,
              wasteFactorPct: data.wasteFactorPct,
              notes: data.notes,
              createdBy: opts.userId,
              updatedBy: opts.userId,
            })
            .returning({ id: recipes.id });
          menuRecipeIdByKey.set(menuRecipeKey(data.menuName, data.variant), inserted.id);
          report.menuRecipes.push({
            row,
            action: "NEW",
            name: `${data.menuName}${data.variant ? ` (${data.variant})` : ""}`,
            detail: `Q${data.wasteFactorPct}%`,
          });
          report.counts.menuRecipes.new++;
        } else {
          const e = existing[0];
          const changed: string[] = [];
          if (e.wasteFactorPct !== data.wasteFactorPct) changed.push("waste_factor_pct");
          if ((e.notes ?? null) !== (data.notes ?? null)) changed.push("notes");
          if (changed.length > 0) {
            await tx
              .update(recipes)
              .set({
                wasteFactorPct: data.wasteFactorPct,
                notes: data.notes,
                updatedBy: opts.userId,
                updatedAt: new Date(),
              })
              .where(eq(recipes.id, e.id));
            report.menuRecipes.push({
              row,
              action: "UPDATE",
              name: `${data.menuName}${data.variant ? ` (${data.variant})` : ""}`,
              detail: changed.join(", "),
            });
            report.counts.menuRecipes.update++;
          } else {
            report.menuRecipes.push({
              row,
              action: "SKIP",
              name: `${data.menuName}${data.variant ? ` (${data.variant})` : ""}`,
            });
            report.counts.menuRecipes.skip++;
          }
          menuRecipeIdByKey.set(menuRecipeKey(data.menuName, data.variant), e.id);
        }
      }

      // ---- File 05 — menu recipe lines (REPLACE per recipe) ----
      const linesByMenuRecipeKey = new Map<string, RunRow<ParsedMenuRecipeLineRow>[]>();
      for (const r of input.menuRecipeLines) {
        const k = menuRecipeKey(r.data.menuName, r.data.variant);
        const list = linesByMenuRecipeKey.get(k) ?? [];
        list.push(r);
        linesByMenuRecipeKey.set(k, list);
      }
      for (const [key, lines] of linesByMenuRecipeKey) {
        if (menuRecipeErrors.has(key)) {
          for (const l of lines) {
            report.menuRecipeLines.push({
              row: l.row,
              action: "ERROR",
              name: `${l.data.menuName} ← ${l.data.ingredientName}`,
              detail: "parent recipe error",
            });
            report.counts.menuRecipeLines.error++;
          }
          continue;
        }
        const recipeId = menuRecipeIdByKey.get(key);
        if (!recipeId) {
          // Lines exist tapi tidak ada parent menu_recipe — refuse.
          for (const l of lines) {
            report.menuRecipeLines.push({
              row: l.row,
              action: "ERROR",
              name: `${l.data.menuName} ← ${l.data.ingredientName}`,
              detail: "parent (menu_name, variant) tidak ada di file 04",
            });
            report.counts.menuRecipeLines.error++;
          }
          continue;
        }

        // Validate ingredient names.
        const validLines: typeof lines = [];
        for (const l of lines) {
          const ingId = allIngIdByLower.get(l.data.ingredientName.trim().toLowerCase());
          if (!ingId) {
            report.menuRecipeLines.push({
              row: l.row,
              action: "ERROR",
              name: `${l.data.menuName} ← ${l.data.ingredientName}`,
              detail: "ingredient tidak ditemukan",
            });
            report.counts.menuRecipeLines.error++;
            continue;
          }
          validLines.push(l);
        }
        if (validLines.length === 0) continue;

        // REPLACE: delete-by-recipe-id + insert.
        await tx
          .delete(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, recipeId));
        await tx.insert(recipeIngredients).values(
          validLines.map((l) => ({
            recipeId,
            ingredientId: allIngIdByLower.get(l.data.ingredientName.trim().toLowerCase())!,
            qty: l.data.qty,
          })),
        );
        for (const l of validLines) {
          report.menuRecipeLines.push({
            row: l.row,
            action: "NEW",
            name: `${l.data.menuName} ← ${l.data.ingredientName}`,
            detail: `qty ${l.data.qty}`,
          });
          report.counts.menuRecipeLines.new++;
        }
      }

      // Decide commit vs rollback.
      report.hasErrors =
        report.errors.length > 0 ||
        report.counts.ingredients.error > 0 ||
        report.counts.preparations.error > 0 ||
        report.counts.prepLines.error > 0 ||
        report.counts.menuRecipes.error > 0 ||
        report.counts.menuRecipeLines.error > 0;

      if (!opts.apply) {
        // Dry-run: roll back regardless of errors.
        throw ROLLBACK_SENTINEL;
      }
      if (report.hasErrors) {
        // Apply mode but errors found: refuse to commit.
        throw ROLLBACK_SENTINEL;
      }
      // Commit happens implicitly on tx end.
    });
  } catch (e) {
    if (e !== ROLLBACK_SENTINEL) throw e;
  }

  return report;
}

/** Simple file-name → audit hint map for caller usage. */
export const IMPORT_FILE_NAMES = {
  ingredients: "01-ingredients.csv",
  preparations: "02-preparations.csv",
  prepLines: "03-preparation-lines.csv",
  menuRecipes: "04-menu-recipes.csv",
  menuRecipeLines: "05-menu-recipe-lines.csv",
} as const;

// Allow callers to inspect which inputs went DB-only vs validated cleanly.
export { validateNoCycle };
