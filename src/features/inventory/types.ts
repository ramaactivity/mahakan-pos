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
}

export interface UpdateIngredientInput {
  name?: string;
  unit?: string;
  costPerUnit?: number;
  reorderThreshold?: number | null;
  notes?: string | null;
  isActive?: boolean;
}

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
  menuItemId: string;
  variant?: RecipeVariant;
  notes?: string | null;
  ingredients: RecipeIngredientInput[];
}

export interface UpdateRecipeInput {
  variant?: RecipeVariant;
  notes?: string | null;
  ingredients?: RecipeIngredientInput[];
}
