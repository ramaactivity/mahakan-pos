"use server";

/**
 * Sesi AE-139 — Server actions untuk Excel (xlsx) bulk operations
 * Preparation + Recipe. Owner workflow:
 *
 *   1. Download xlsx → snapshot semua prep + recipe
 *   2. Edit di Excel (auto detect format, no CSV pain)
 *   3. Upload xlsx → preview diff → apply
 *
 * Pattern mirror dengan csv-actions.ts. Auto-mapping ingredient_name →
 * ingredient_id case-insensitive saat import.
 *
 * RBAC: inventory.recipe.create (owner only) untuk semua action.
 * Atomic transaction supaya all-or-nothing.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  menuItems,
  outlets,
  recipeIngredients,
  recipes,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { cascadeCostUpdate } from "./preparation-flow";
import {
  parsePreparationsXlsx,
  parseRecipesXlsx,
  serializePreparationsXlsx,
  serializeRecipesXlsx,
  type PreparationForExport,
  type RecipeForExport,
} from "./xlsx-io";
import { fail, ok, type ApiResult } from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/* ============================================================
 * EXPORT
 * ============================================================ */

export async function exportPreparationsXlsx(): Promise<
  ApiResult<{ base64: string; filename: string; rowCount: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.create")) {
    return fail("FORBIDDEN", "Tidak punya hak export preparations");
  }

  const [outlet] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);

  const prepRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      preparationYield: ingredients.preparationYield,
      notes: ingredients.notes,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        eq(ingredients.isPreparation, true),
        isNull(ingredients.deletedAt),
      ),
    )
    .orderBy(asc(ingredients.name));

  /* Load recipes + lines untuk semua prep. */
  const recipeRows = await db
    .select({
      id: recipes.id,
      ingredientId: recipes.ingredientId,
      wasteFactorPct: recipes.wasteFactorPct,
    })
    .from(recipes)
    .where(eq(recipes.outletId, session.user.outletId));

  const lineRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      qty: recipeIngredients.qty,
      ingredientName: ingredients.name,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId));

  /* Build prep-id → recipe + lines map. */
  const recipeByPrepId = new Map<
    string,
    { recipeId: string; wasteFactorPct: number }
  >();
  for (const r of recipeRows) {
    if (r.ingredientId) {
      recipeByPrepId.set(r.ingredientId, {
        recipeId: r.id,
        wasteFactorPct: r.wasteFactorPct,
      });
    }
  }
  const linesByRecipeId = new Map<
    string,
    Array<{ ingredientName: string; qty: number }>
  >();
  for (const ln of lineRows) {
    const list = linesByRecipeId.get(ln.recipeId) ?? [];
    list.push({ ingredientName: ln.ingredientName, qty: ln.qty });
    linesByRecipeId.set(ln.recipeId, list);
  }

  const preps: PreparationForExport[] = prepRows.map((p) => {
    const r = recipeByPrepId.get(p.id);
    const lines = r ? (linesByRecipeId.get(r.recipeId) ?? []) : [];
    return {
      id: p.id,
      name: p.name,
      recipeUnit: p.unit,
      yield: p.preparationYield ?? 0,
      qFactor: r?.wasteFactorPct ?? 10,
      notes: p.notes,
      lines,
    };
  });

  const buf = serializePreparationsXlsx(preps, {
    generatedAt: new Date(),
    outletName: outlet?.name ?? "Mahakan",
  });

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const filename = `mahakan-preparations-${ts}.xlsx`;
  return ok({ base64: buf.toString("base64"), filename, rowCount: preps.length });
}

export async function exportRecipesXlsx(): Promise<
  ApiResult<{ base64: string; filename: string; rowCount: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.create")) {
    return fail("FORBIDDEN", "Tidak punya hak export recipes");
  }

  const [outlet] = await db
    .select({ name: outlets.name })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);

  /* Recipes untuk MENU only (bukan prep). menuItemId IS NOT NULL. */
  const recipeRows = await db
    .select({
      id: recipes.id,
      menuItemId: recipes.menuItemId,
      variant: recipes.variant,
      wasteFactorPct: recipes.wasteFactorPct,
      notes: recipes.notes,
      menuName: menuItems.name,
    })
    .from(recipes)
    .innerJoin(menuItems, eq(menuItems.id, recipes.menuItemId))
    .where(
      and(
        eq(recipes.outletId, session.user.outletId),
        isNull(menuItems.deletedAt),
      ),
    )
    .orderBy(asc(menuItems.name));

  const lineRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      qty: recipeIngredients.qty,
      ingredientName: ingredients.name,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId));
  const linesByRecipeId = new Map<
    string,
    Array<{ ingredientName: string; qty: number }>
  >();
  for (const ln of lineRows) {
    const list = linesByRecipeId.get(ln.recipeId) ?? [];
    list.push({ ingredientName: ln.ingredientName, qty: ln.qty });
    linesByRecipeId.set(ln.recipeId, list);
  }

  const out: RecipeForExport[] = recipeRows
    .filter((r) => r.menuItemId !== null)
    .map((r) => ({
      menuItemId: r.menuItemId!,
      menuName: r.menuName,
      variant: r.variant as "hot" | "iced" | null,
      qFactor: r.wasteFactorPct,
      notes: r.notes,
      lines: linesByRecipeId.get(r.id) ?? [],
    }));

  const buf = serializeRecipesXlsx(out, {
    generatedAt: new Date(),
    outletName: outlet?.name ?? "Mahakan",
  });

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const filename = `mahakan-recipes-${ts}.xlsx`;
  return ok({ base64: buf.toString("base64"), filename, rowCount: out.length });
}

/* ============================================================
 * IMPORT — Preview (parse + diff, no DB write)
 * ============================================================ */

export interface PreparationImportRowDiff {
  rowNumber: number;
  action: "create" | "update" | "unchanged" | "error";
  name: string;
  errors: string[];
  /** Resolved ingredient ids per line (null = lookup failed). */
  resolvedLines: Array<{
    ingredientName: string;
    ingredientId: string | null;
    qty: number;
  }>;
  changedFields: string[];
}

export interface PreparationImportPreview {
  rows: PreparationImportRowDiff[];
  summary: {
    create: number;
    update: number;
    unchanged: number;
    error: number;
    total: number;
  };
}

export async function previewPreparationsImport(
  base64: string,
): Promise<ApiResult<PreparationImportPreview>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.create")) {
    return fail("FORBIDDEN", "Tidak punya hak preview import");
  }
  if (!base64 || base64.length === 0) {
    return fail("VALIDATION_ERROR", "File kosong");
  }
  const buf = Buffer.from(base64, "base64");
  if (buf.length > 5_000_000) {
    return fail("FILE_TOO_LARGE", "File >5MB. Split file dulu.");
  }
  const parsed = parsePreparationsXlsx(buf);

  /* Lookup ingredient name → id (case-insensitive) untuk outlet ini. */
  const allIngredients = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      isPreparation: ingredients.isPreparation,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );
  const nameToId = new Map<string, string>();
  for (const ing of allIngredients) {
    nameToId.set(ing.name.toLowerCase().trim(), ing.id);
  }

  /* Existing preparations (by name lowercase) untuk diff. */
  const existingPreps = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      preparationYield: ingredients.preparationYield,
      notes: ingredients.notes,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        eq(ingredients.isPreparation, true),
        isNull(ingredients.deletedAt),
      ),
    );
  const prepNameToRow = new Map(
    existingPreps.map((p) => [p.name.toLowerCase().trim(), p]),
  );

  const result: PreparationImportRowDiff[] = [];
  let create = 0;
  let update = 0;
  const unchanged = 0;
  let error = 0;

  for (const r of parsed.rows) {
    const errors = [...r.errors];
    const resolvedLines = r.lines.map((ln) => {
      const id = nameToId.get(ln.ingredientName.toLowerCase().trim()) ?? null;
      if (id === null) {
        errors.push(`Ingredient "${ln.ingredientName}" tidak ada di DB`);
      }
      return { ingredientName: ln.ingredientName, ingredientId: id, qty: ln.qty };
    });

    if (errors.length > 0 || r.name.length === 0) {
      result.push({
        rowNumber: r.rowNumber,
        action: "error",
        name: r.name,
        errors,
        resolvedLines,
        changedFields: [],
      });
      error++;
      continue;
    }

    /* Match by id → fallback name. */
    const existing =
      (r.id
        ? existingPreps.find((p) => p.id === r.id)
        : prepNameToRow.get(r.name.toLowerCase().trim())) ?? null;

    if (!existing) {
      result.push({
        rowNumber: r.rowNumber,
        action: "create",
        name: r.name,
        errors: [],
        resolvedLines,
        changedFields: [],
      });
      create++;
      continue;
    }

    const changedFields: string[] = [];
    if (existing.name !== r.name) changedFields.push("name");
    if (existing.unit !== r.recipeUnit) changedFields.push("recipe_unit");
    if ((existing.preparationYield ?? 0) !== r.yield) changedFields.push("yield");
    if ((existing.notes ?? null) !== r.notes) changedFields.push("notes");
    /* TODO: detect line changes — skip for now, treat as always changed
     * kalau ada line. Owner bisa lihat preview. */
    changedFields.push("lines");

    result.push({
      rowNumber: r.rowNumber,
      action: changedFields.length === 1 && changedFields[0] === "lines"
        ? "update"
        : "update",
      name: r.name,
      errors: [],
      resolvedLines,
      changedFields,
    });
    update++;
  }

  void unchanged;
  return ok({
    rows: result,
    summary: { create, update, unchanged: 0, error, total: parsed.rows.length },
  });
}

/* ============================================================
 * IMPORT — Apply (commit changes in transaction)
 * ============================================================ */

export interface PreparationImportApplyResult {
  createdCount: number;
  updatedCount: number;
  cascadedRecipes: number;
  skippedErrorCount: number;
}

export async function applyPreparationsImport(
  base64: string,
): Promise<ApiResult<PreparationImportApplyResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.create")) {
    return fail("FORBIDDEN", "Tidak punya hak apply import");
  }
  const previewRes = await previewPreparationsImport(base64);
  if (!previewRes.success) return previewRes;
  if (previewRes.data.summary.error > 0) {
    return fail(
      "HAS_ERRORS",
      `${previewRes.data.summary.error} row(s) error. Fix dulu sebelum apply.`,
    );
  }
  const buf = Buffer.from(base64, "base64");
  const parsed = parsePreparationsXlsx(buf);

  /* Re-fetch ingredient lookup di dalam transaction supaya fresh. */
  const allIngredients = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      isPreparation: ingredients.isPreparation,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );
  const nameToId = new Map<string, string>();
  for (const ing of allIngredients) {
    nameToId.set(ing.name.toLowerCase().trim(), ing.id);
  }

  let createdCount = 0;
  let updatedCount = 0;
  let cascadedRecipes = 0;
  const cascadeTargetIds: string[] = [];

  try {
    await db.transaction(async (tx) => {
      for (const r of parsed.rows) {
        if (r.errors.length > 0 || r.name.length === 0) continue;

        /* Find or create prep ingredient. */
        let prepId: string;
        if (r.id) {
          prepId = r.id;
          await tx
            .update(ingredients)
            .set({
              name: r.name,
              unit: r.recipeUnit,
              preparationYield: r.yield,
              notes: r.notes,
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(ingredients.id, prepId));
          updatedCount++;
        } else {
          const existing = nameToId.get(r.name.toLowerCase().trim());
          if (existing) {
            prepId = existing;
            await tx
              .update(ingredients)
              .set({
                unit: r.recipeUnit,
                preparationYield: r.yield,
                notes: r.notes,
                updatedAt: new Date(),
                updatedBy: session.user.id,
              })
              .where(eq(ingredients.id, prepId));
            updatedCount++;
          } else {
            const [created] = await tx
              .insert(ingredients)
              .values({
                outletId: session.user.outletId,
                name: r.name,
                unit: r.recipeUnit,
                costPerUnit: 0, // populated by cascade
                currentStock: 0,
                currentStockDecimal: "0.0000",
                isPreparation: true,
                preparationYield: r.yield,
                notes: r.notes,
                createdBy: session.user.id,
                updatedBy: session.user.id,
              })
              .returning({ id: ingredients.id });
            prepId = created.id;
            nameToId.set(r.name.toLowerCase().trim(), prepId);
            createdCount++;
          }
        }

        /* Upsert recipe + replace ingredient lines. */
        const [existingRecipe] = await tx
          .select({ id: recipes.id })
          .from(recipes)
          .where(eq(recipes.ingredientId, prepId))
          .limit(1);

        let recipeId: string;
        if (existingRecipe) {
          recipeId = existingRecipe.id;
          await tx
            .update(recipes)
            .set({
              wasteFactorPct: r.qFactor,
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(recipes.id, recipeId));
          /* Replace lines: delete all + re-insert. */
          await tx
            .delete(recipeIngredients)
            .where(eq(recipeIngredients.recipeId, recipeId));
        } else {
          const [createdRecipe] = await tx
            .insert(recipes)
            .values({
              outletId: session.user.outletId,
              ingredientId: prepId,
              menuItemId: null,
              variant: null,
              notes: null,
              wasteFactorPct: r.qFactor,
              createdBy: session.user.id,
              updatedBy: session.user.id,
            })
            .returning({ id: recipes.id });
          recipeId = createdRecipe.id;
        }

        /* Insert lines (auto-mapped via nameToId). */
        for (const ln of r.lines) {
          const ingId = nameToId.get(
            ln.ingredientName.toLowerCase().trim(),
          );
          if (!ingId) {
            throw new Error(
              `Ingredient "${ln.ingredientName}" tidak ada (re-fetch race?)`,
            );
          }
          await tx.insert(recipeIngredients).values({
            recipeId,
            ingredientId: ingId,
            qty: ln.qty,
          });
        }

        cascadeTargetIds.push(prepId);
      }

      /* Cascade cost recomputation untuk semua prep yang berubah. */
      for (const id of cascadeTargetIds) {
        try {
          const r = await cascadeCostUpdate(
            tx,
            session.user.outletId,
            id,
            session.user.id,
          );
          cascadedRecipes += r.recomputedPrepIds.length;
        } catch {
          throw new Error("CASCADE_FAILED");
        }
      }
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error — rolled back",
    );
  }

  await logAudit({
    eventType: "inventory.recipe.bulk_import",
    userId: session.user.id,
    entityType: "ingredient",
    entityId: "bulk-prep",
    payload: {
      summary: `Bulk xlsx prep import: ${createdCount} created, ${updatedCount} updated, ${cascadedRecipes} cascade recomputed`,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({
    createdCount,
    updatedCount,
    cascadedRecipes,
    skippedErrorCount: 0,
  });
}

/* ============================================================
 * RECIPE IMPORT — Preview + Apply
 * ============================================================ */

export interface RecipeImportRowDiff {
  rowNumber: number;
  action: "create" | "update" | "error";
  menuName: string;
  variant: string | null;
  errors: string[];
  resolvedLines: Array<{
    ingredientName: string;
    ingredientId: string | null;
    qty: number;
  }>;
  changedFields: string[];
}

export interface RecipeImportPreview {
  rows: RecipeImportRowDiff[];
  summary: {
    create: number;
    update: number;
    error: number;
    total: number;
  };
}

export async function previewRecipesImport(
  base64: string,
): Promise<ApiResult<RecipeImportPreview>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.create")) {
    return fail("FORBIDDEN", "Tidak punya hak preview import");
  }
  if (!base64 || base64.length === 0) {
    return fail("VALIDATION_ERROR", "File kosong");
  }
  const buf = Buffer.from(base64, "base64");
  if (buf.length > 5_000_000) {
    return fail("FILE_TOO_LARGE", "File >5MB. Split file dulu.");
  }
  const parsed = parseRecipesXlsx(buf);

  /* Lookups. */
  const allIngredients = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );
  const nameToIngId = new Map<string, string>();
  for (const ing of allIngredients) {
    nameToIngId.set(ing.name.toLowerCase().trim(), ing.id);
  }

  const allMenus = await db
    .select({ id: menuItems.id, name: menuItems.name })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.outletId, session.user.outletId),
        isNull(menuItems.deletedAt),
      ),
    );
  const nameToMenuId = new Map<string, string>();
  for (const m of allMenus) {
    nameToMenuId.set(m.name.toLowerCase().trim(), m.id);
  }

  /* Existing recipes for diff. */
  const existingRecipes = await db
    .select({
      id: recipes.id,
      menuItemId: recipes.menuItemId,
      variant: recipes.variant,
    })
    .from(recipes)
    .where(eq(recipes.outletId, session.user.outletId));
  const recipeKey = (menuId: string, variant: string | null) =>
    `${menuId}|${variant ?? ""}`;
  const existingRecipeMap = new Map<
    string,
    { id: string; menuItemId: string; variant: string | null }
  >();
  for (const r of existingRecipes) {
    if (r.menuItemId) {
      existingRecipeMap.set(recipeKey(r.menuItemId, r.variant), {
        id: r.id,
        menuItemId: r.menuItemId,
        variant: r.variant,
      });
    }
  }

  const result: RecipeImportRowDiff[] = [];
  let create = 0;
  let update = 0;
  let error = 0;

  for (const r of parsed.rows) {
    const errors = [...r.errors];

    const menuId = r.menuItemId
      ? r.menuItemId
      : nameToMenuId.get(r.menuName.toLowerCase().trim()) ?? null;
    if (!menuId) {
      errors.push(`Menu "${r.menuName}" tidak ada di DB`);
    }

    const resolvedLines = r.lines.map((ln) => {
      const id = nameToIngId.get(ln.ingredientName.toLowerCase().trim()) ?? null;
      if (id === null) {
        errors.push(`Ingredient "${ln.ingredientName}" tidak ada di DB`);
      }
      return { ingredientName: ln.ingredientName, ingredientId: id, qty: ln.qty };
    });

    if (errors.length > 0 || r.menuName.length === 0) {
      result.push({
        rowNumber: r.rowNumber,
        action: "error",
        menuName: r.menuName,
        variant: r.variant,
        errors,
        resolvedLines,
        changedFields: [],
      });
      error++;
      continue;
    }

    const isUpdate = menuId
      ? existingRecipeMap.has(recipeKey(menuId, r.variant))
      : false;

    if (isUpdate) {
      update++;
      result.push({
        rowNumber: r.rowNumber,
        action: "update",
        menuName: r.menuName,
        variant: r.variant,
        errors: [],
        resolvedLines,
        changedFields: ["lines", "q_factor", "notes"],
      });
    } else {
      create++;
      result.push({
        rowNumber: r.rowNumber,
        action: "create",
        menuName: r.menuName,
        variant: r.variant,
        errors: [],
        resolvedLines,
        changedFields: [],
      });
    }
  }

  return ok({
    rows: result,
    summary: { create, update, error, total: parsed.rows.length },
  });
}

export interface RecipeImportApplyResult {
  createdCount: number;
  updatedCount: number;
  skippedErrorCount: number;
}

export async function applyRecipesImport(
  base64: string,
): Promise<ApiResult<RecipeImportApplyResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.create")) {
    return fail("FORBIDDEN", "Tidak punya hak apply import");
  }
  const previewRes = await previewRecipesImport(base64);
  if (!previewRes.success) return previewRes;
  if (previewRes.data.summary.error > 0) {
    return fail(
      "HAS_ERRORS",
      `${previewRes.data.summary.error} row(s) error. Fix dulu sebelum apply.`,
    );
  }
  const buf = Buffer.from(base64, "base64");
  const parsed = parseRecipesXlsx(buf);

  const allIngredients = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );
  const nameToIngId = new Map<string, string>();
  for (const ing of allIngredients) {
    nameToIngId.set(ing.name.toLowerCase().trim(), ing.id);
  }

  const allMenus = await db
    .select({ id: menuItems.id, name: menuItems.name })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.outletId, session.user.outletId),
        isNull(menuItems.deletedAt),
      ),
    );
  const nameToMenuId = new Map<string, string>();
  for (const m of allMenus) {
    nameToMenuId.set(m.name.toLowerCase().trim(), m.id);
  }

  let createdCount = 0;
  let updatedCount = 0;

  try {
    await db.transaction(async (tx) => {
      for (const r of parsed.rows) {
        if (r.errors.length > 0 || r.menuName.length === 0) continue;
        const menuId =
          r.menuItemId ??
          nameToMenuId.get(r.menuName.toLowerCase().trim()) ??
          null;
        if (!menuId) continue;

        /* Upsert recipe by (menuItemId, variant). */
        const [existing] = await tx
          .select({ id: recipes.id })
          .from(recipes)
          .where(
            and(
              eq(recipes.menuItemId, menuId),
              r.variant === null
                ? isNull(recipes.variant)
                : eq(recipes.variant, r.variant),
            ),
          )
          .limit(1);

        let recipeId: string;
        if (existing) {
          recipeId = existing.id;
          await tx
            .update(recipes)
            .set({
              wasteFactorPct: r.qFactor,
              notes: r.notes,
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(recipes.id, recipeId));
          await tx
            .delete(recipeIngredients)
            .where(eq(recipeIngredients.recipeId, recipeId));
          updatedCount++;
        } else {
          const [created] = await tx
            .insert(recipes)
            .values({
              outletId: session.user.outletId,
              menuItemId: menuId,
              ingredientId: null,
              variant: r.variant,
              notes: r.notes,
              wasteFactorPct: r.qFactor,
              createdBy: session.user.id,
              updatedBy: session.user.id,
            })
            .returning({ id: recipes.id });
          recipeId = created.id;
          createdCount++;
        }

        for (const ln of r.lines) {
          const ingId = nameToIngId.get(ln.ingredientName.toLowerCase().trim());
          if (!ingId) {
            throw new Error(
              `Ingredient "${ln.ingredientName}" tidak ada (race?)`,
            );
          }
          await tx.insert(recipeIngredients).values({
            recipeId,
            ingredientId: ingId,
            qty: ln.qty,
          });
        }
      }
    });
  } catch (e) {
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error — rolled back",
    );
  }

  await logAudit({
    eventType: "inventory.recipe.bulk_import",
    userId: session.user.id,
    entityType: "recipe",
    entityId: "bulk-menu-recipe",
    payload: {
      summary: `Bulk xlsx menu-recipe import: ${createdCount} created, ${updatedCount} updated`,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ createdCount, updatedCount, skippedErrorCount: 0 });
}

