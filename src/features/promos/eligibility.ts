/**
 * Pure eligibility evaluation for a single promo against a cart context.
 * Server (POS apply) and client (POS picker preview) both use this.
 *
 * Day-of-week convention: 1 = Monday … 7 = Sunday (ISO 8601).
 * Times: 24-hour "HH:MM" strings.
 */

import { computeDiscountAmount } from "@/lib/money";
import type { Promo, PromoEligibility } from "./types";

export interface CartContext {
  /** Bill subtotal in rupiah (already-summed cart lines). */
  subtotal: number;
  /** Per-line breakdown for category-scoped promos. Each line carries
   *  its menu's category id + the line subtotal contribution. */
  lines: Array<{ categoryId: string | null; lineSubtotal: number }>;
  orderType: "dine_in" | "takeaway";
  /** Optional planned payment method (modal can preview before staff picks). */
  paymentMethod?:
    | "cash"
    | "qris"
    | "card_bca"
    | "card_bni"
    | "card_mandiri"
    | "card_bri"
    | "card_other"
    | "split"
    | null;
  /** Reference time — pass `new Date()` at call site. Allows deterministic
   *  testing. Server should use server time, client should use client time
   *  (close enough for window-eligibility). */
  now: Date;
}

function isoWeekday(d: Date): number {
  // JS getDay(): 0=Sun..6=Sat. We want 1=Mon..7=Sun.
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}

function nowMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function dateToIsoLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Evaluate one promo against a cart. Returns eligibility flag + computed
 * discount + a reason string when ineligible (rendered in POS as muted).
 */
export function evaluatePromo(
  promo: Promo,
  ctx: CartContext,
): PromoEligibility {
  const result: PromoEligibility = {
    promoId: promo.id,
    promo,
    eligible: false,
    computedDiscount: 0,
    reason: null,
  };

  // Status gate
  if (promo.status !== "active") {
    result.reason = "Promo tidak aktif";
    return result;
  }

  // Total uses
  if (
    promo.maxTotalUses !== null &&
    promo.currentUses >= promo.maxTotalUses
  ) {
    result.reason = "Limit pemakaian tercapai";
    return result;
  }

  // Date range
  const today = dateToIsoLocal(ctx.now);
  if (promo.startDate && today < promo.startDate) {
    result.reason = `Mulai berlaku ${promo.startDate}`;
    return result;
  }
  if (promo.endDate && today > promo.endDate) {
    result.reason = "Sudah kadaluarsa";
    return result;
  }

  // Day of week
  if (promo.daysOfWeek && promo.daysOfWeek.length > 0) {
    const dow = isoWeekday(ctx.now);
    if (!promo.daysOfWeek.includes(dow)) {
      const dayNames = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
      const allowed = promo.daysOfWeek
        .map((d) => dayNames[d - 1])
        .join(", ");
      result.reason = `Hanya ${allowed}`;
      return result;
    }
  }

  // Time of day
  if (promo.startTime && promo.endTime) {
    const cur = nowMinutes(ctx.now);
    const startM = timeToMinutes(promo.startTime);
    const endM = timeToMinutes(promo.endTime);
    if (cur < startM || cur >= endM) {
      result.reason = `Hanya ${promo.startTime}–${promo.endTime}`;
      return result;
    }
  }

  // Order type
  if (
    promo.applicableOrderTypes &&
    promo.applicableOrderTypes.length > 0 &&
    !promo.applicableOrderTypes.includes(ctx.orderType)
  ) {
    result.reason = `Hanya untuk ${promo.applicableOrderTypes.join(" / ")}`;
    return result;
  }

  // Payment method (only check if cart has it set)
  if (
    ctx.paymentMethod &&
    promo.applicablePaymentMethods &&
    promo.applicablePaymentMethods.length > 0 &&
    !promo.applicablePaymentMethods.includes(ctx.paymentMethod)
  ) {
    result.reason = `Hanya pembayaran ${promo.applicablePaymentMethods.join(" / ")}`;
    return result;
  }

  // Compute the base subtotal for discount target.
  let targetSubtotal: number;
  if (promo.scope === "whole_bill") {
    targetSubtotal = ctx.subtotal;
  } else {
    // category — sum lines whose categoryId matches.
    const catIds = new Set(promo.scopeCategoryIds ?? []);
    targetSubtotal = ctx.lines
      .filter((l) => l.categoryId !== null && catIds.has(l.categoryId))
      .reduce((sum, l) => sum + l.lineSubtotal, 0);

    if (targetSubtotal <= 0) {
      result.reason = "Tidak ada item di kategori promo";
      return result;
    }
  }

  // Min subtotal — checked against TOTAL bill (not per-category subtotal).
  if (promo.minSubtotal !== null && ctx.subtotal < promo.minSubtotal) {
    const need = promo.minSubtotal - ctx.subtotal;
    result.reason = `Min belanja Rp ${promo.minSubtotal.toLocaleString("id-ID")} (kurang Rp ${need.toLocaleString("id-ID")})`;
    return result;
  }

  // Compute discount
  let discount = computeDiscountAmount(targetSubtotal, {
    type: promo.discountType,
    value: promo.discountValue,
  });

  // Apply max cap (percent only — fixed type already caps at subtotal in helper).
  if (
    promo.discountType === "percent" &&
    promo.maxDiscountAmount !== null &&
    discount > promo.maxDiscountAmount
  ) {
    discount = promo.maxDiscountAmount;
  }

  if (discount <= 0) {
    result.reason = "Tidak ada penghematan";
    return result;
  }

  result.eligible = true;
  result.computedDiscount = discount;
  return result;
}

/**
 * Bulk evaluate — convenience wrapper.
 * Returns 2 buckets: eligible (sorted by computedDiscount desc — biggest savings first)
 * and ineligible (preserve input order).
 */
export function evaluateAll(
  promos: Promo[],
  ctx: CartContext,
): { eligible: PromoEligibility[]; ineligible: PromoEligibility[] } {
  const eligible: PromoEligibility[] = [];
  const ineligible: PromoEligibility[] = [];
  for (const p of promos) {
    const res = evaluatePromo(p, ctx);
    if (res.eligible) eligible.push(res);
    else ineligible.push(res);
  }
  eligible.sort((a, b) => b.computedDiscount - a.computedDiscount);
  return { eligible, ineligible };
}
