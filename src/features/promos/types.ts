import type { InferSelectModel } from "drizzle-orm";
import type { promos, promoUsages } from "@/db/schema";

export type Promo = InferSelectModel<typeof promos>;
export type PromoUsage = InferSelectModel<typeof promoUsages>;

export type PromoStatus = "draft" | "active" | "paused" | "archived";
export type PromoDiscountType = "percent" | "fixed";
export type PromoScope = "whole_bill" | "category";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
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
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface PromoWithStats extends Promo {
  /** Aggregated from promo_usages joined to non-voided transactions. */
  totalDiscountGiven: number;
}

export interface CreatePromoInput {
  name: string;
  description?: string | null;
  discountType: PromoDiscountType;
  discountValue: number;
  maxDiscountAmount?: number | null;
  scope: PromoScope;
  scopeCategoryIds?: string[] | null;
  minSubtotal?: number | null;
  applicableOrderTypes?: Array<"dine_in" | "takeaway"> | null;
  applicablePaymentMethods?: Array<"cash" | "qris" | "card_bca" | "split"> | null;
  startDate?: string | null;
  endDate?: string | null;
  daysOfWeek?: number[] | null;
  /** "HH:MM" 24h format */
  startTime?: string | null;
  endTime?: string | null;
  maxTotalUses?: number | null;
  requiresApproval: boolean;
  status: PromoStatus;
}

export interface UpdatePromoInput extends CreatePromoInput {
  id: string;
}

/** Server-computed eligibility result for one promo against a cart. */
export interface PromoEligibility {
  promoId: string;
  promo: Promo;
  /** True if all conditions met right now for this cart. */
  eligible: boolean;
  /** Computed savings rupiah (0 if not eligible). */
  computedDiscount: number;
  /** Reason for ineligibility — shown in POS as greyed entry. */
  reason: string | null;
}
