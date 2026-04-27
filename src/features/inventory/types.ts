import type { InferSelectModel } from "drizzle-orm";
import type { ingredients, inventoryMovements } from "@/db/schema";

export type Ingredient = InferSelectModel<typeof ingredients>;
export type InventoryMovement = InferSelectModel<typeof inventoryMovements>;

export type MovementKind = InventoryMovement["kind"];

export interface MovementWithIngredient extends InventoryMovement {
  ingredient: Pick<Ingredient, "id" | "name" | "unit">;
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

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
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
