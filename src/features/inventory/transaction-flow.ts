import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  menuItems,
  recipeIngredients,
  recipes,
} from "@/db/schema";

/**
 * Internal helper module that links transactions ↔ inventory.
 *
 * Owns the math + DB writes that turn a paid transaction into:
 *   - per-item + per-transaction COGS snapshot
 *   - inventory_movements rows (kind=sale_deduct / void_restore /
 *     refund_restore)
 *   - atomic ingredient.current_stock updates
 *
 * Designed to be called inside the same DB transaction that inserts
 * the order so failures roll back atomically.
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
  /** key = ingredientId, value = qty to deduct (positive) */
  deductionsByIngredient: Map<string, number>;
  /** key = ingredientId, value = unit cost snapshot at sale time */
  ingredientCostSnapshot: Map<string, number>;
  /** All menu_items touched — used by sold-out re-eval */
  affectedMenuItemIds: Set<string>;
  /** Items whose menu_item didn't have a matching recipe (priceType=open or unconfigured) */
  itemsWithoutRecipe: string[];
}

/**
 * Looks up recipes for every (menuItemId, variant) tuple in the order
 * and aggregates per-ingredient deductions + per-item COGS.
 *
 * Items without a matching recipe (open-price, unconfigured) get
 * cogs=0 and contribute no deductions. They're returned in
 * `itemsWithoutRecipe` for caller-side observability.
 */
export async function computeStockFlowForOrder(
  tx: DbTx,
  items: OrderItemContext[],
): Promise<StockFlow> {
  const flow: StockFlow = {
    totalCogs: 0,
    itemCogsByTrxItemId: new Map(),
    deductionsByIngredient: new Map(),
    ingredientCostSnapshot: new Map(),
    affectedMenuItemIds: new Set(items.map((i) => i.menuItemId)),
    itemsWithoutRecipe: [],
  };

  if (items.length === 0) return flow;

  const menuItemIds = Array.from(
    new Set(items.map((i) => i.menuItemId)),
  );

  const recipeRows = await tx
    .select({
      id: recipes.id,
      menuItemId: recipes.menuItemId,
      variant: recipes.variant,
    })
    .from(recipes)
    .where(inArray(recipes.menuItemId, menuItemIds));

  if (recipeRows.length === 0) {
    flow.itemsWithoutRecipe = items.map((i) => i.transactionItemId);
    return flow;
  }

  const recipeIds = recipeRows.map((r) => r.id);
  const lineRows = await tx
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      qty: recipeIngredients.qty,
      costPerUnit: ingredients.costPerUnit,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(inArray(recipeIngredients.recipeId, recipeIds));

  // Build lookup: (menuItemId|variant) → ingredient lines[]
  const recipeKeyToLines = new Map<
    string,
    Array<{ ingredientId: string; qty: number; costPerUnit: number }>
  >();
  for (const r of recipeRows) {
    const key = `${r.menuItemId}|${r.variant ?? ""}`;
    const lines = lineRows
      .filter((l) => l.recipeId === r.id)
      .map((l) => ({
        ingredientId: l.ingredientId,
        qty: l.qty,
        costPerUnit: l.costPerUnit,
      }));
    recipeKeyToLines.set(key, lines);
  }

  for (const item of items) {
    const key = `${item.menuItemId}|${item.variant ?? ""}`;
    const lines = recipeKeyToLines.get(key);
    if (!lines || lines.length === 0) {
      flow.itemsWithoutRecipe.push(item.transactionItemId);
      flow.itemCogsByTrxItemId.set(item.transactionItemId, 0);
      continue;
    }

    let lineCogs = 0;
    for (const l of lines) {
      const totalQtyForLine = l.qty * item.quantity;
      flow.deductionsByIngredient.set(
        l.ingredientId,
        (flow.deductionsByIngredient.get(l.ingredientId) ?? 0) +
          totalQtyForLine,
      );
      flow.ingredientCostSnapshot.set(l.ingredientId, l.costPerUnit);
      lineCogs += l.qty * l.costPerUnit;
    }
    const totalLineCogs = lineCogs * item.quantity;
    flow.itemCogsByTrxItemId.set(item.transactionItemId, totalLineCogs);
    flow.totalCogs += totalLineCogs;
  }

  return flow;
}

/**
 * UPDATE current_stock atomically + INSERT inventory_movements rows
 * (kind=sale_deduct) referencing the transaction. Caller must run
 * inside a DB transaction.
 */
export async function applyStockDeductions(
  tx: DbTx,
  outletId: string,
  userId: string,
  transactionId: string,
  flow: StockFlow,
): Promise<void> {
  for (const [ingredientId, qty] of flow.deductionsByIngredient) {
    if (qty === 0) continue;
    await tx
      .update(ingredients)
      .set({
        currentStock: sql`${ingredients.currentStock} - ${qty}`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(ingredients.id, ingredientId));

    await tx.insert(inventoryMovements).values({
      outletId,
      ingredientId,
      kind: "sale_deduct",
      qtyDelta: -qty,
      unitCostAtMovement: flow.ingredientCostSnapshot.get(ingredientId) ?? null,
      referenceType: "transaction",
      referenceId: transactionId,
      reason: null,
      createdBy: userId,
    });
  }
}

/**
 * Reverses every sale_deduct movement attached to the given transaction
 * by inserting matching positive-delta movements (kind=void_restore or
 * refund_restore) and bumping ingredient.current_stock back up.
 *
 * Returns the list of ingredient ids that were affected so the caller
 * can trigger sold-out re-evaluation.
 */
export async function restoreStockForTransaction(
  tx: DbTx,
  outletId: string,
  userId: string,
  transactionId: string,
  kind: "void_restore" | "refund_restore",
): Promise<string[]> {
  const saleMovements = await tx
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.referenceId, transactionId),
        eq(inventoryMovements.referenceType, "transaction"),
        eq(inventoryMovements.kind, "sale_deduct"),
      ),
    );

  if (saleMovements.length === 0) return [];

  const affectedIngredients: string[] = [];
  const reason =
    kind === "void_restore" ? "Auto-restore void" : "Auto-restore refund";

  for (const m of saleMovements) {
    const restoreQty = -m.qtyDelta; // saleMovements have negative qty_delta
    if (restoreQty <= 0) continue;

    await tx
      .update(ingredients)
      .set({
        currentStock: sql`${ingredients.currentStock} + ${restoreQty}`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(ingredients.id, m.ingredientId));

    await tx.insert(inventoryMovements).values({
      outletId,
      ingredientId: m.ingredientId,
      kind,
      qtyDelta: restoreQty,
      unitCostAtMovement: m.unitCostAtMovement,
      referenceType: "transaction",
      referenceId: transactionId,
      reason,
      createdBy: userId,
    });

    affectedIngredients.push(m.ingredientId);
  }

  return Array.from(new Set(affectedIngredients));
}

/**
 * After a stock change, scan menu items whose recipes reference the
 * given ingredient ids and flip is_sold_out=true if any variant can no
 * longer be fulfilled with current stock. Best-effort — runs after the
 * main DB transaction commits so its failure can't roll the sale back.
 *
 * NOTE: this only auto-flips TO sold-out. Owner manually flips back to
 * available after restocking — preserves intent visibility.
 */
export async function reevaluateSoldOutForIngredients(
  affectedIngredientIds: string[],
): Promise<void> {
  if (affectedIngredientIds.length === 0) return;

  // 1. Find all menu_items whose recipes reference any affected ingredient.
  const menuRows = await db
    .selectDistinct({ menuItemId: recipes.menuItemId })
    .from(recipes)
    .innerJoin(
      recipeIngredients,
      eq(recipeIngredients.recipeId, recipes.id),
    )
    .where(inArray(recipeIngredients.ingredientId, affectedIngredientIds));

  const menuItemIds = menuRows.map((r) => r.menuItemId);
  if (menuItemIds.length === 0) return;

  // 2. For each menu_item, evaluate all of its recipes.
  for (const menuItemId of menuItemIds) {
    const menuRecipes = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.menuItemId, menuItemId));

    if (menuRecipes.length === 0) continue;

    let anyInfeasible = false;
    for (const r of menuRecipes) {
      const lines = await db
        .select({
          qty: recipeIngredients.qty,
          currentStock: ingredients.currentStock,
        })
        .from(recipeIngredients)
        .innerJoin(
          ingredients,
          eq(ingredients.id, recipeIngredients.ingredientId),
        )
        .where(eq(recipeIngredients.recipeId, r.id));

      for (const l of lines) {
        if (l.currentStock < l.qty) {
          anyInfeasible = true;
          break;
        }
      }
      if (anyInfeasible) break;
    }

    if (anyInfeasible) {
      // Only flip if currently false to avoid spurious updates.
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
