import type { InferSelectModel } from "drizzle-orm";
import type {
  ingredients,
  inventoryMovements,
  recipeIngredients,
  recipes,
} from "@/db/schema";

export type Ingredient = InferSelectModel<typeof ingredients>;
export type InventoryMovement = InferSelectModel<typeof inventoryMovements>;
export type Recipe = InferSelectModel<typeof recipes>;
export type RecipeIngredient = InferSelectModel<typeof recipeIngredients>;

export type MovementKind = InventoryMovement["kind"];
export type RecipeVariant = Recipe["variant"];

export interface MovementWithIngredient extends InventoryMovement {
  ingredient: Pick<Ingredient, "id" | "name" | "unit">;
}

export interface RecipeIngredientLine extends RecipeIngredient {
  ingredient: Pick<Ingredient, "id" | "name" | "unit" | "costPerUnit">;
}

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredientLine[];
}

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export interface Paginated<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export type ApiFailure = {
  success: false;
  error: { code: string; message: string; field?: string };
};

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiFailure {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface CreateIngredientInput {
  name: string;
  unit: string;
  costPerUnit: number;
  initialStock: number;
  reorderThreshold?: number | null;
  notes?: string | null;
  isPreparation?: boolean;
  preparationYield?: number | null;
}

export interface UpdateIngredientInput {
  name?: string;
  unit?: string;
  costPerUnit?: number;
  reorderThreshold?: number | null;
  notes?: string | null;
  isActive?: boolean;
  preparationYield?: number | null;
}

/** Narrowed view of an ingredient that is acting as a preparation. */
export type Preparation = Ingredient & {
  isPreparation: true;
  preparationYield: number;
};

/** Recipe target — exactly one of menu vs prep is set (XOR enforced by DB). */
export type RecipeTarget =
  | { kind: "menu"; menuItemId: string; variant: RecipeVariant }
  | { kind: "prep"; ingredientId: string };

/**
 * Resolved snapshot of one recipe used by the cascade + transaction-flow
 * engines. Lines carry the `isPreparation` flag so callers can decide
 * whether to recurse.
 */
export interface RecipeNode {
  recipeId: string;
  outletId: string;
  target: RecipeTarget;
  wasteFactorPct: number;
  preparationYield: number | null;
  lines: Array<{
    ingredientId: string;
    qty: number;
    isPreparation: boolean;
    costPerUnit: number;
  }>;
}

/** Ingredient → atomic qty, post-rounding (Math.round per leaf). */
export type LeafExpansion = Map<string, number>;

export interface ReceiveStockInput {
  ingredientId: string;
  qty: number;
  unitCost: number;
  updateCost?: boolean;
  note?: string | null;
}

export interface AdjustStockInput {
  ingredientId: string;
  delta: number;
  reason: string;
}

export interface RecordWasteInput {
  ingredientId: string;
  qty: number;
  reason: string;
}

export interface ListMovementsOptions {
  ingredientId?: string;
  kind?: MovementKind;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

export interface RecipeIngredientInput {
  ingredientId: string;
  qty: number;
}

export interface CreateRecipeInput {
  /** Set when targeting a menu item. Mutually exclusive with ingredientId. */
  menuItemId?: string | null;
  /** Set when targeting a preparation ingredient. */
  ingredientId?: string | null;
  variant?: RecipeVariant;
  notes?: string | null;
  /** Defaults: 30 for menu recipes, 10 for prep recipes. */
  wasteFactorPct?: number;
  ingredients: RecipeIngredientInput[];
}

export interface UpdateRecipeInput {
  variant?: RecipeVariant;
  notes?: string | null;
  wasteFactorPct?: number;
  ingredients?: RecipeIngredientInput[];
}
