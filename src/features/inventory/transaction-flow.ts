import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  menuItems,
  recipeIngredients,
  recipes,
} from "@/db/schema";
import { expandRecipeToAtomicLeaves } from "./preparation-flow";
import { splitLineForMovement } from "./preparation-flow-pure";

/**
 * Internal helper module that links transactions ↔ inventory.
 *
 * Owns the math + DB writes that turn a paid transaction into:
 *   - per-item + per-transaction COGS snapshot (waste factor included)
 *   - inventory_movements rows split into kind=sale_deduct (lean) +
 *     kind=waste (Q Factor buffer) per atomic ingredient
 *   - atomic ingredient.current_stock updates
 *   - kind=void_restore / refund_restore as 1 combined row per ingredient
 *     (qty = lean + waste) for transaction reversals
 *
 * M23.2 changes (vs M22.5):
 *   - Recursive recipe expansion: preparation ingredients are replaced with
 *     their atomic leaves at sale time, scaled by `preparation_yield`.
 *   - Waste factor (recipe.waste_factor_pct) applied to both COGS and stock.
 *   - Movement audit splits into 2 rows per atomic ingredient at deduct time.
 *
 * Designed to be called inside the same DB transaction that inserts the order
 * so failures roll back atomically.
 */

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OrderItemContext {
  /** Post-insert transaction_item id */
  transactionItemId: string;
  menuItemId: string;
  variant: "hot" | "iced" | null;
  quantity: number;
}

export interface StockFlow {
  totalCogs: number;
  /** key = transactionItemId, value = cogs (rupiah) for that whole line */
  itemCogsByTrxItemId: Map<string, number>;
  /** key = ingredientId, value = lean qty to deduct (positive) */
  deductionsByIngredient: Map<string, number>;
  /** key = ingredientId, value = waste-buffer qty to deduct (positive) */
  wasteByIngredient: Map<string, number>;
  /** key = ingredientId, value = unit cost snapshot at sale time */
  ingredientCostSnapshot: Map<string, number>;
  /** All menu_items touched — used by sold-out re-eval */
  affectedMenuItemIds: Set<string>;
  /** Items whose menu_item didn't have a matching recipe (priceType=open or unconfigured) */
  itemsWithoutRecipe: string[];
}

/**
 * Looks up recipes for every (menuItemId, variant) tuple in the order, expands
 * each to atomic leaves (recursive CTE), applies the waste factor, and
 * aggregates per-ingredient deductions + per-item COGS.
 *
 * Items without a matching recipe (open-price, unconfigured) get cogs=0 and
 * contribute no deductions. They're returned in `itemsWithoutRecipe` for
 * caller-side observability.
 */
export async function computeStockFlowForOrder(
  tx: DbTx,
  outletId: string,
  items: OrderItemContext[],
): Promise<StockFlow> {
  const flow: StockFlow = {
    totalCogs: 0,
    itemCogsByTrxItemId: new Map(),
    deductionsByIngredient: new Map(),
    wasteByIngredient: new Map(),
    ingredientCostSnapshot: new Map(),
    affectedMenuItemIds: new Set(items.map((i) => i.menuItemId)),
    itemsWithoutRecipe: [],
  };

  if (items.length === 0) return flow;

  const menuItemIds = Array.from(new Set(items.map((i) => i.menuItemId)));

  const recipeRows = await tx
    .select({
      id: recipes.id,
      menuItemId: recipes.menuItemId,
      variant: recipes.variant,
      wasteFactorPct: recipes.wasteFactorPct,
    })
    .from(recipes)
    .where(
      and(
        inArray(recipes.menuItemId, menuItemIds),
        eq(recipes.isActive, true),
      ),
    );

  if (recipeRows.length === 0) {
    flow.itemsWithoutRecipe = items.map((i) => i.transactionItemId);
    return flow;
  }

  // Expand each unique recipe to atomic leaves once + load atomic costs.
  const recipeKeyToRecipeId = new Map<string, string>();
  const recipeIdToWaste = new Map<string, number>();
  const recipeIdToLeaves = new Map<string, Map<string, number>>();
  for (const r of recipeRows) {
    if (!r.menuItemId) continue;
    const key = `${r.menuItemId}|${r.variant ?? ""}`;
    recipeKeyToRecipeId.set(key, r.id);
    recipeIdToWaste.set(r.id, r.wasteFactorPct);
    recipeIdToLeaves.set(r.id, await expandRecipeToAtomicLeaves(tx, r.id, outletId));
  }

  // Collect all atomic ingredient ids touched + load their cost_per_unit.
  const allLeafIds = new Set<string>();
  for (const leaves of recipeIdToLeaves.values()) {
    for (const id of leaves.keys()) allLeafIds.add(id);
  }
  if (allLeafIds.size > 0) {
    const costRows = await tx
      .select({ id: ingredients.id, costPerUnit: ingredients.costPerUnit })
      .from(ingredients)
      .where(inArray(ingredients.id, Array.from(allLeafIds)));
    for (const r of costRows) {
      flow.ingredientCostSnapshot.set(r.id, r.costPerUnit);
    }
  }

  // Per-item: scale leaves × quantity, accumulate deductions + COGS.
  for (const item of items) {
    const key = `${item.menuItemId}|${item.variant ?? ""}`;
    const recipeId = recipeKeyToRecipeId.get(key);
    if (!recipeId) {
      flow.itemsWithoutRecipe.push(item.transactionItemId);
      flow.itemCogsByTrxItemId.set(item.transactionItemId, 0);
      continue;
    }
    const leaves = recipeIdToLeaves.get(recipeId);
    const wasteFactor = recipeIdToWaste.get(recipeId) ?? 30;
    if (!leaves || leaves.size === 0) {
      flow.itemsWithoutRecipe.push(item.transactionItemId);
      flow.itemCogsByTrxItemId.set(item.transactionItemId, 0);
      continue;
    }

    let lineCogsRaw = 0;
    for (const [ingredientId, perOrderQty] of leaves) {
      const cost = flow.ingredientCostSnapshot.get(ingredientId) ?? 0;
      const totalRawQty = perOrderQty * item.quantity;

      const split = splitLineForMovement(totalRawQty, wasteFactor);
      flow.deductionsByIngredient.set(
        ingredientId,
        (flow.deductionsByIngredient.get(ingredientId) ?? 0) + split.leanQty,
      );
      if (split.wasteQty > 0) {
        flow.wasteByIngredient.set(
          ingredientId,
          (flow.wasteByIngredient.get(ingredientId) ?? 0) + split.wasteQty,
        );
      }

      lineCogsRaw += perOrderQty * cost;
    }
    // Apply waste to COGS once per item, then scale by quantity, round once.
    const totalLineCogs = Math.round(
      lineCogsRaw * (1 + wasteFactor / 100) * item.quantity,
    );
    flow.itemCogsByTrxItemId.set(item.transactionItemId, totalLineCogs);
    flow.totalCogs += totalLineCogs;
  }

  return flow;
}

/**
 * UPDATE current_stock atomically + INSERT inventory_movements rows split into
 * kind=sale_deduct (lean) + kind=waste (Q Factor buffer) per ingredient.
 * Caller must run inside a DB transaction.
 */
export async function applyStockDeductions(
  tx: DbTx,
  outletId: string,
  userId: string,
  transactionId: string,
  flow: StockFlow,
): Promise<void> {
  // Union of ingredient ids that have lean and/or waste qty.
  const allIds = new Set<string>([
    ...flow.deductionsByIngredient.keys(),
    ...flow.wasteByIngredient.keys(),
  ]);

  for (const ingredientId of allIds) {
    const lean = flow.deductionsByIngredient.get(ingredientId) ?? 0;
    const waste = flow.wasteByIngredient.get(ingredientId) ?? 0;
    const total = lean + waste;
    if (total === 0) continue;

    await tx
      .update(ingredients)
      .set({
        currentStock: sql`${ingredients.currentStock} - ${total}`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(ingredients.id, ingredientId));

    const unitCost = flow.ingredientCostSnapshot.get(ingredientId) ?? null;

    if (lean > 0) {
      await tx.insert(inventoryMovements).values({
        outletId,
        ingredientId,
        kind: "sale_deduct",
        qtyDelta: -lean,
        unitCostAtMovement: unitCost,
        referenceType: "transaction",
        referenceId: transactionId,
        reason: null,
        createdBy: userId,
      });
    }

    if (waste > 0) {
      await tx.insert(inventoryMovements).values({
        outletId,
        ingredientId,
        kind: "waste",
        qtyDelta: -waste,
        unitCostAtMovement: unitCost,
        referenceType: "transaction",
        referenceId: transactionId,
        reason: "Recipe waste buffer",
        createdBy: userId,
      });
    }
  }
}

/**
 * Reverses every sale_deduct + waste movement attached to the given transaction
 * by inserting one combined positive-delta movement per ingredient (qty =
 * lean + waste) with kind=void_restore or refund_restore, and bumping
 * ingredient.current_stock back up.
 *
 * Returns the list of ingredient ids that were affected so the caller can
 * trigger sold-out re-evaluation.
 */
export async function restoreStockForTransaction(
  tx: DbTx,
  outletId: string,
  userId: string,
  transactionId: string,
  kind: "void_restore" | "refund_restore" | "edit_restore",
): Promise<string[]> {
  const sourceMovements = await tx
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.referenceId, transactionId),
        eq(inventoryMovements.referenceType, "transaction"),
        inArray(inventoryMovements.kind, ["sale_deduct", "waste"]),
      ),
    );

  if (sourceMovements.length === 0) return [];

  // Aggregate by ingredient: sum absolute qtyDelta, capture cost snapshot.
  const restoreByIngredient = new Map<
    string,
    { totalQty: number; unitCost: number | null }
  >();
  for (const m of sourceMovements) {
    const restoreQty = -m.qtyDelta;
    if (restoreQty <= 0) continue;
    const prev = restoreByIngredient.get(m.ingredientId);
    restoreByIngredient.set(m.ingredientId, {
      totalQty: (prev?.totalQty ?? 0) + restoreQty,
      unitCost: prev?.unitCost ?? m.unitCostAtMovement,
    });
  }

  const reason =
    kind === "void_restore"
      ? "Auto-restore void incl. waste buffer"
      : kind === "refund_restore"
        ? "Auto-restore refund incl. waste buffer"
        : "Auto-restore for open bill edit incl. waste buffer";

  const affected: string[] = [];
  for (const [ingredientId, { totalQty, unitCost }] of restoreByIngredient) {
    await tx
      .update(ingredients)
      .set({
        currentStock: sql`${ingredients.currentStock} + ${totalQty}`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(ingredients.id, ingredientId));

    await tx.insert(inventoryMovements).values({
      outletId,
      ingredientId,
      kind,
      qtyDelta: totalQty,
      unitCostAtMovement: unitCost,
      referenceType: "transaction",
      referenceId: transactionId,
      reason,
      createdBy: userId,
    });

    affected.push(ingredientId);
  }

  return Array.from(new Set(affected));
}

/**
 * After a stock change, scan menu items whose recipes reference (transitively)
 * the given ingredient ids and flip is_sold_out=true if any variant can no
 * longer be fulfilled with current atomic stock. Best-effort — runs after the
 * main DB transaction commits so its failure can't roll the sale back.
 *
 * NOTE: this only auto-flips TO sold-out. Owner manually flips back to
 * available after restocking — preserves intent visibility.
 */
export async function reevaluateSoldOutForIngredients(
  affectedIngredientIds: string[],
): Promise<void> {
  if (affectedIngredientIds.length === 0) return;

  // Step 1: find menu items whose recipe directly OR transitively references
  // any affected atomic ingredient. We walk via recipe_ingredients twice (once
  // direct, once via prep level) since Mahakan ≤ depth 2 in real data.
  // Excludes preparation recipes from the menu candidate set.
  const directMenuRows = await db
    .selectDistinct({ menuItemId: recipes.menuItemId })
    .from(recipes)
    .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
    .where(
      and(
        inArray(recipeIngredients.ingredientId, affectedIngredientIds),
        isNotNull(recipes.menuItemId),
      ),
    );

  // Find prep ingredients that include any affected atomic — those preps may
  // be referenced by menu recipes too.
  const dependentPrepIds = await db
    .selectDistinct({ prepId: recipes.ingredientId })
    .from(recipes)
    .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
    .where(
      and(
        inArray(recipeIngredients.ingredientId, affectedIngredientIds),
        isNotNull(recipes.ingredientId),
      ),
    );
  const prepIds = dependentPrepIds.map((r) => r.prepId).filter(
    (id): id is string => id !== null,
  );

  let viaPrepMenuRows: Array<{ menuItemId: string | null }> = [];
  if (prepIds.length > 0) {
    viaPrepMenuRows = await db
      .selectDistinct({ menuItemId: recipes.menuItemId })
      .from(recipes)
      .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
      .where(
        and(
          inArray(recipeIngredients.ingredientId, prepIds),
          isNotNull(recipes.menuItemId),
        ),
      );
  }

  const menuItemIds = Array.from(
    new Set(
      [...directMenuRows, ...viaPrepMenuRows]
        .map((r) => r.menuItemId)
        .filter((id): id is string => id !== null),
    ),
  );
  if (menuItemIds.length === 0) return;

  // Step 2: for each menu item, expand each of its recipes to atomic leaves
  // and check feasibility.
  for (const menuItemId of menuItemIds) {
    const menuRecipes = await db
      .select({ id: recipes.id, outletId: recipes.outletId })
      .from(recipes)
      .where(
        and(
          eq(recipes.menuItemId, menuItemId),
          eq(recipes.isActive, true),
        ),
      );

    if (menuRecipes.length === 0) continue;

    let anyInfeasible = false;
    for (const r of menuRecipes) {
      const leaves = await expandRecipeToAtomicLeaves(db, r.id, r.outletId);
      if (leaves.size === 0) continue;

      const leafIds = Array.from(leaves.keys());
      const stockRows = await db
        .select({ id: ingredients.id, currentStock: ingredients.currentStock })
        .from(ingredients)
        .where(inArray(ingredients.id, leafIds));
      const stockById = new Map(
        stockRows.map((s) => [s.id, s.currentStock] as const),
      );

      for (const [leafId, requiredQty] of leaves) {
        const have = stockById.get(leafId) ?? 0;
        if (have < requiredQty) {
          anyInfeasible = true;
          break;
        }
      }
      if (anyInfeasible) break;
    }

    if (anyInfeasible) {
      await db
        .update(menuItems)
        .set({ isSoldOut: true, updatedAt: new Date() })
        .where(
          and(
            eq(menuItems.id, menuItemId),
            eq(menuItems.isSoldOut, false),
            isNull(menuItems.deletedAt),
          ),
        );
    }
  }
}
