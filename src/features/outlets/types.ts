import type { InferSelectModel } from "drizzle-orm";
import type { outlets } from "@/db/schema";

export type Outlet = InferSelectModel<typeof outlets>;

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}
