import type { InferSelectModel } from "drizzle-orm";
import type { customers } from "@/db/schema";

export type Customer = InferSelectModel<typeof customers>;

export interface FindOrCreateCustomerInput {
  phone: string;
  name: string;
  /** Optional notes — only set on initial create. Updates ignore. */
  notes?: string | null;
}

export interface UpdateCustomerInput {
  id: string;
  name?: string;
  phone?: string;
  notes?: string | null;
}

export interface ListCustomersOptions {
  /** Free-text match against `name` or `phone`. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListCustomersResult {
  items: Customer[];
  total: number;
  hasMore: boolean;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(code: string, message: string): ApiResult<never> {
  return { success: false, error: { code, message } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success;
}

/** Earn ratio: Rp 1000 spent = 1 point. Lifetime spend feeds the same
 * ratio. Configurable later via outlet settings; hardcoded for Phase 2 v1. */
export const POINTS_PER_RUPIAH = 1 / 1000;

/** Redemption ratio: 1 point = Rp 1000 discount. Mirror of the earn ratio
 * for now. If the policy diverges later (e.g. earn 1000=1 but redeem
 * 1500=1), only this constant changes. */
export const RUPIAH_PER_POINT_REDEEMED = 1000;

export function computePointsEarned(rupiahSpent: number): number {
  if (rupiahSpent <= 0) return 0;
  return Math.floor(rupiahSpent * POINTS_PER_RUPIAH);
}

/** Rupiah discount for a given redemption count. */
export function computeRedemptionAmount(points: number): number {
  if (points <= 0) return 0;
  return Math.floor(points) * RUPIAH_PER_POINT_REDEEMED;
}

/**
 * Clamp a kasir-requested redemption count to what is actually allowed.
 * Returns the largest valid integer point count in [0, requestedPoints]
 * such that:
 *   - it does not exceed the member's available balance
 *   - the resulting rupiah discount does not exceed the eligible subtotal
 *     (i.e. cannot make total go negative)
 *
 * `eligibleSubtotal` is the cart subtotal the redemption is being applied
 * against (after any pre-existing discount/compliment is removed — caller
 * decides). The XOR-with-manual-discount rule is enforced UI-side so the
 * pure helper stays narrow.
 */
export function clampRedemption(
  requestedPoints: number,
  balance: number,
  eligibleSubtotal: number,
): number {
  if (!Number.isFinite(requestedPoints) || requestedPoints <= 0) return 0;
  if (balance <= 0 || eligibleSubtotal <= 0) return 0;
  const maxByBalance = Math.floor(balance);
  const maxBySubtotal = Math.floor(eligibleSubtotal / RUPIAH_PER_POINT_REDEEMED);
  return Math.max(
    0,
    Math.min(Math.floor(requestedPoints), maxByBalance, maxBySubtotal),
  );
}

/**
 * Normalise an Indonesian phone input into digits-only canonical form.
 * Strips +, spaces, dashes, parens, and dots. Leaves leading 0 or 62 alone
 * — both represent the same number but stored as-typed so the same person
 * isn't accidentally split into two records by formatting.
 *
 * Returns null if the result is too short to be a real phone (<6 digits).
 */
export function normalisePhone(raw: string): string | null {
  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (digitsOnly.length < 6) return null;
  return digitsOnly;
}
