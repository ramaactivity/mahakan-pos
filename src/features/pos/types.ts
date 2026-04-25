/**
 * POS feature local types — cart line items + drafts.
 *
 * Distinct from DB shapes — these live in client state during an in-progress
 * order, mapped to `CreateTransactionInput` at payment time.
 */

import type { Discount } from "@/lib/money";
import type { OrderType, Variant } from "@/features/transactions";

export interface CartLineItemModifier {
  modifierSlug: string;
  label: string;
  selectedValue: string | null;
  selectedLabel: string | null;
  priceDelta: number;
}

export interface CartLineItem {
  cartItemId: string;
  menuItemId: string;
  name: string;
  categoryName: string;
  variant: Variant | null;
  /** Base price snapshot (excludes modifier deltas). */
  unitPrice: number;
  quantity: number;
  modifiers: CartLineItemModifier[];
  /** Sum of all `priceDelta` per unit. */
  modifiersPriceDelta: number;
  /** (unitPrice + modifiersPriceDelta) * quantity */
  subtotal: number;
  note: string | null;
  /** For Manual Brew open-price items. */
  openPriceNote: string | null;
}

export interface Draft {
  id: string;
  pagerNumber: number;
  orderType: OrderType;
  items: CartLineItem[];
  discount: Discount | null;
  discountReason: string | null;
  /** For Staff-initiated discount: approver who PIN-verified. */
  discountApproverId: string | null;
  discountApproverToken: string | null;
  createdAt: string;
}

export type { Discount };
