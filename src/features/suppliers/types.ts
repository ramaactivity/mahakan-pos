import type { InferSelectModel } from "drizzle-orm";
import type { suppliers } from "@/db/schema";

export type Supplier = InferSelectModel<typeof suppliers>;

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export type ApiFailure = {
  success: false;
  error: { code: string; message: string; field?: string };
};

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

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

export interface CreateSupplierInput {
  name: string;
  contact?: string | null;
  category?: string | null;
  defaultPaymentTermDays?: number;
  notes?: string | null;
}

export interface UpdateSupplierInput {
  name?: string;
  contact?: string | null;
  category?: string | null;
  defaultPaymentTermDays?: number;
  notes?: string | null;
  isActive?: boolean;
}

export interface ListSuppliersOptions {
  activeOnly?: boolean;
  search?: string;
}
