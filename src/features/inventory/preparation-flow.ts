import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  recipeIngredients,
  recipes,
} from "@/db/schema";
import { logAudit } from "@/lib/audit/logger";
import {
  aggregateExpansion,
  computePrepCostFromLines,
  type RecipeLineInput,
} from "./preparation-flow-pure";

// Re-export pure helpers for callers that already use this barrel.
export {
  aggregateExpansion,
  computePrepCostFromLines,
  splitLineForMovement,
  validateNoCycle,
} from "./preparation-flow-pure";
export type {
  MovementSplit,
  RecipeLineInput,
} from "./preparation-flow-pure";

/**
 * M23.2 — DB-touching helpers for the cost cascade + recursive expansion
 * engine. Run raw recursive CTEs via Drizzle `tx.execute(sql\`...\`)`.
 *
 * Decisions (full plan: ~/.claude/plans/halo-gua-mau-lanjut-gleaming-fern.md):
 *   - D4 cascade: dual visited (`inProgress` cycle defense + `computed` memoize).
 *   - CTE depth guard: 10 (Mahakan ≤ 2 actual depth in real data).
 *   - Outlet + soft-delete scoping in every CTE.
 *   - Advisory lock keyed `cost-cascade-{outletId}`, tx-scoped (auto-release).
 */

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Either a transaction context or the top-level db handle. */
type DbOrTx = DbTx | typeof db;

/**
 * Expands a recipe to atomic-only leaves, recursively replacing any
 * preparation ingredient with its sub-recipe (scaled by `preparation_yield`).
 * Returns ingredient_id → atomic qty (Math.round per leaf, sum-then-round).
 */
export async function expandRecipeToAtomicLeaves(
  tx: DbOrTx,
  recipeId: string,
  outletId: string,
): Promise<Map<string, number>> {
  const result = await tx.execute(sql`
    WITH RECURSIVE expanded(ingredient_id, qty_scaled, is_preparation, preparation_yield, depth) AS (
      SELECT ri.ingredient_id, ri.qty::numeric, i.is_preparation, i.preparation_yield, 0
      FROM recipe_ingredients ri
      JOIN ingredients i
        ON i.id = ri.ingredient_id
       AND i.deleted_at IS NULL
      WHERE ri.recipe_id = ${recipeId}::uuid
      UNION ALL
      SELECT ri2.ingredient_id,
             e.qty_scaled * ri2.qty::numeric / NULLIF(e.preparation_yield, 0)::numeric,
             i2.is_preparation,
             i2.preparation_yield,
             e.depth + 1
      FROM expanded e
      JOIN recipes r
        ON r.ingredient_id = e.ingredient_id
       AND r.outlet_id = ${outletId}::uuid
       AND r.is_active = true
      JOIN recipe_ingredients ri2 ON ri2.recipe_id = r.id
      JOIN ingredients i2
        ON i2.id = ri2.ingredient_id
       AND i2.deleted_at IS NULL
      WHERE e.is_preparation = true
        AND e.preparation_yield IS NOT NULL
        AND e.preparation_yield > 0
        AND e.depth < 10
    )
    SELECT ingredient_id, SUM(qty_scaled)::numeric AS total_qty
    FROM expanded
    WHERE is_preparation = false
    GROUP BY ingredient_id
  `);

  const rows = (result as unknown as { rows: Array<{ ingredient_id: string; total_qty: string }> }).rows
    ?? (result as unknown as Array<{ ingredient_id: string; total_qty: string }>);

  return aggregateExpansion(
    rows.map((r) => ({
      ingredientId: r.ingredient_id,
      qtyScaled: Number(r.total_qty),
    })),
  );
}

/**
 * Cycle detection — returns true if applying `proposedIngredientIds` as the
 * recipe lines for preparation `targetPrepId` would create a cycle.
 *
 * `recipeIdBeingEdited` excludes that recipe's old ingredient lines from the
 * graph traversal (they're being replaced). Pass `null` when creating.
 */
export async function detectCycleForRecipeUpsert(
  tx: DbTx,
  outletId: string,
  targetPrepId: string,
  proposedIngredientIds: ReadonlyArray<string>,
  recipeIdBeingEdited: string | null,
): Promise<boolean> {
  if (proposedIngredientIds.length === 0) return false;
  // Self-reference is the simplest cycle and isn't reachable via DB walk
  // (target is the seed, not visited via graph). Short-circuit.
  if (proposedIngredientIds.includes(targetPrepId)) return true;

  // Build the array literal as parameterized values via sql.join.
  const idArrayFragments = proposedIngredientIds.map((id) => sql`${id}::uuid`);
  const idArray = sql`ARRAY[${sql.join(idArrayFragments, sql`, `)}]::uuid[]`;

  const result = await tx.execute(sql`
    WITH RECURSIVE downward(ing_id, depth) AS (
      SELECT id, 0
      FROM ingredients
      WHERE id = ANY(${idArray})
        AND deleted_at IS NULL
      UNION
      SELECT ri.ingredient_id, d.depth + 1
      FROM downward d
      JOIN ingredients parent
        ON parent.id = d.ing_id
       AND parent.is_preparation = true
      JOIN recipes r
        ON r.ingredient_id = d.ing_id
       AND r.outlet_id = ${outletId}::uuid
       AND r.is_active = true
       AND (${recipeIdBeingEdited}::uuid IS NULL OR r.id != ${recipeIdBeingEdited}::uuid)
      JOIN recipe_ingredients ri ON ri.recipe_id = r.id
      WHERE d.depth < 10
    )
    SELECT EXISTS(SELECT 1 FROM downward WHERE ing_id = ${targetPrepId}::uuid) AS has_cycle
  `);

  const rows = (result as unknown as { rows: Array<{ has_cycle: boolean }> }).rows
    ?? (result as unknown as Array<{ has_cycle: boolean }>);
  return rows[0]?.has_cycle === true;
}

/**
 * Finds preparations that transitively depend on the changed ingredient
 * (upward CTE: who has the changed ingredient anywhere in their recipe tree?).
 * Result feeds `cascadeCostUpdate`'s recompute loop.
 */
async function findDependentPreps(
  tx: DbTx,
  outletId: string,
  changedIngredientId: string,
): Promise<string[]> {
  const result = await tx.execute(sql`
    WITH RECURSIVE upward(prep_id, depth) AS (
      SELECT DISTINCT r.ingredient_id, 0
      FROM recipes r
      JOIN recipe_ingredients ri ON ri.recipe_id = r.id
      WHERE r.ingredient_id IS NOT NULL
        AND r.outlet_id = ${outletId}::uuid
        AND r.is_active = true
        AND ri.ingredient_id = ${changedIngredientId}::uuid
      UNION
      SELECT DISTINCT r.ingredient_id, u.depth + 1
      FROM upward u
      JOIN recipe_ingredients ri ON ri.ingredient_id = u.prep_id
      JOIN recipes r
        ON r.id = ri.recipe_id
       AND r.ingredient_id IS NOT NULL
       AND r.outlet_id = ${outletId}::uuid
       AND r.is_active = true
      WHERE u.depth < 10
    )
    SELECT prep_id FROM upward WHERE prep_id IS NOT NULL
  `);

  const rows = (result as unknown as { rows: Array<{ prep_id: string }> }).rows
    ?? (result as unknown as Array<{ prep_id: string }>);
  return rows.map((r) => r.prep_id);
}

/**
 * Recomputes the cost-per-unit of a single preparation. Recursive: if any of
 * its ingredient lines is itself a prep, recompute that first (post-order
 * DFS). Memoizes via `computed` to avoid redundant work in diamond deps.
 *
 * `inProgress` is a separate Set used for cycle defense — should be
 * impossible at runtime if cycle detection at upsert is honored, but defended
 * here to avoid stack overflow in case of corrupt state.
 */
export async function computePrepCost(
  tx: DbTx,
  outletId: string,
  prepId: string,
  userId: string,
  inProgress: Set<string>,
  computed: Map<string, number>,
): Promise<number> {
  const cached = computed.get(prepId);
  if (cached !== undefined) return cached;
  if (inProgress.has(prepId)) {
    throw new Error("CYCLE_DURING_CASCADE");
  }
  inProgress.add(prepId);

  const [recipeRow] = await tx
    .select({
      id: recipes.id,
      wasteFactorPct: recipes.wasteFactorPct,
    })
    .from(recipes)
    .where(
      and(
        eq(recipes.ingredientId, prepId),
        eq(recipes.outletId, outletId),
        eq(recipes.isActive, true),
      ),
    )
    .limit(1);

  if (!recipeRow) {
    // No recipe for this prep yet — leave cost at current value (likely 0
    // initial). Stamp nothing.
    inProgress.delete(prepId);
    const current = await tx
      .select({ costPerUnit: ingredients.costPerUnit })
      .from(ingredients)
      .where(eq(ingredients.id, prepId))
      .limit(1);
    const v = current[0]?.costPerUnit ?? 0;
    computed.set(prepId, v);
    return v;
  }

  const lineRows = await tx
    .select({
      ingredientId: recipeIngredients.ingredientId,
      qty: recipeIngredients.qty,
      costPerUnit: ingredients.costPerUnit,
      isPreparation: ingredients.isPreparation,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(eq(recipeIngredients.recipeId, recipeRow.id));

  const [prepRow] = await tx
    .select({
      preparationYield: ingredients.preparationYield,
      costPerUnit: ingredients.costPerUnit,
    })
    .from(ingredients)
    .where(eq(ingredients.id, prepId))
    .limit(1);

  if (!prepRow || prepRow.preparationYield == null) {
    throw new Error("PREP_YIELD_MISSING");
  }

  // Resolve each line's effective cost (recurse if line is itself a prep).
  const resolvedLines: RecipeLineInput[] = [];
  for (const l of lineRows) {
    let cost = l.costPerUnit;
    if (l.isPreparation) {
      cost = await computePrepCost(tx, outletId, l.ingredientId, userId, inProgress, computed);
    }
    resolvedLines.push({ qty: l.qty, costPerUnit: cost });
  }

  const newCost = computePrepCostFromLines(
    resolvedLines,
    recipeRow.wasteFactorPct,
    prepRow.preparationYield,
  );

  if (newCost !== prepRow.costPerUnit) {
    await tx
      .update(ingredients)
      .set({
        costPerUnit: newCost,
        costLastChangedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(ingredients.id, prepId));

    void logAudit({
      eventType: "inventory.preparation.recompute",
      userId,
      entityType: "ingredient",
      entityId: prepId,
      payload: {
        summary: `Recompute cost preparation ${prepId.slice(0, 8)}…: ${prepRow.costPerUnit} → ${newCost}`,
        before: { costPerUnit: prepRow.costPerUnit },
        after: { costPerUnit: newCost },
      },
      metadata: { outletId },
    });
  }

  inProgress.delete(prepId);
  computed.set(prepId, newCost);
  return newCost;
}

/**
 * Cascades a cost change starting from `changedIngredientId`. Acquires a
 * per-outlet advisory lock so concurrent cost edits don't clobber each other.
 *
 * Caller must already be inside a `db.transaction` — lock auto-releases on
 * commit/rollback.
 */
export async function cascadeCostUpdate(
  tx: DbTx,
  outletId: string,
  changedIngredientId: string,
  userId: string,
): Promise<{ recomputedPrepIds: string[] }> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`cost-cascade-${outletId}`}))`,
  );

  const dependentPrepIds = await findDependentPreps(tx, outletId, changedIngredientId);
  if (dependentPrepIds.length === 0) {
    return { recomputedPrepIds: [] };
  }

  const inProgress = new Set<string>();
  const computed = new Map<string, number>();

  // Snapshot pre-cascade costs so we can detect what actually changed.
  const before = new Map<string, number>();
  const beforeRows = await tx
    .select({ id: ingredients.id, costPerUnit: ingredients.costPerUnit })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outletId),
        eq(ingredients.isPreparation, true),
      ),
    );
  for (const r of beforeRows) before.set(r.id, r.costPerUnit);

  for (const prepId of dependentPrepIds) {
    await computePrepCost(tx, outletId, prepId, userId, inProgress, computed);
  }

  const recomputed: string[] = [];
  for (const [prepId, newCost] of computed) {
    if (before.get(prepId) !== newCost) recomputed.push(prepId);
  }

  void logAudit({
    eventType: "inventory.cost.cascade",
    userId,
    entityType: "ingredient",
    entityId: changedIngredientId,
    payload: {
      summary: `Cascade cost ${recomputed.length} preparation(s) terdampak`,
      after: {
        recomputedPrepIds: recomputed,
        triggeredBy: changedIngredientId,
      },
    },
    metadata: { outletId },
  });

  return { recomputedPrepIds: recomputed };
}

/**
 * Builds the prep-dependency adjacency map for an outlet (prep id → ingredient
 * ids it currently uses). Used by callers that want to run `validateNoCycle`
 * in-memory (e.g., importer dry-run mode).
 */
export async function buildPrepAdjacency(
  tx: DbTx,
  outletId: string,
): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({
      prepId: recipes.ingredientId,
      lineIngredientId: recipeIngredients.ingredientId,
    })
    .from(recipes)
    .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
    .where(
      and(
        eq(recipes.outletId, outletId),
        eq(recipes.isActive, true),
        isNotNull(recipes.ingredientId),
      ),
    );

  const adjacency = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.prepId) continue;
    const list = adjacency.get(r.prepId) ?? [];
    list.push(r.lineIngredientId);
    adjacency.set(r.prepId, list);
  }
  return adjacency;
}
