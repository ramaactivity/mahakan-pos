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
  /** Optional free-form label — customer name, "Meja 5", "Gojek". */
  customerName: string | null;
  items: CartLineItem[];
  discount: Discount | null;
  discountReason: string | null;
  /** For Staff-initiated discount: approver who PIN-verified. */
  discountApproverId: string | null;
  discountApproverToken: string | null;
  /** Set when this draft is editing an existing open bill. UI swaps the
   * "Simpan sebagai Open Bill" + "Bayar" buttons with a single "Update Bill"
   * action and routes save through `editOpenBill` instead of `saveAsOpenBill`. */
  editingBillId: string | null;
  createdAt: string;
}

export type { Discount };
