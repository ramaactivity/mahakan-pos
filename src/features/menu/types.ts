import type { InferSelectModel } from "drizzle-orm";
import type { categories, menuItems, modifiers } from "@/db/schema";

export type Category = InferSelectModel<typeof categories>;
export type MenuItem = InferSelectModel<typeof menuItems>;
export type Modifier = InferSelectModel<typeof modifiers>;

export type PriceType = "fixed" | "variant" | "open";

/**
 * Mirror of the mock-services ApiResult envelope so consumers can swap
 * `from "@/mocks/services"` → `from "@/features/menu"` with no shape change.
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; field?: string } };

export interface Paginated<T> {
  items: T[];
  total: number;
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
