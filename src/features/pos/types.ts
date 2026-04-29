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
  pagerNumber: number | null;
  orderType: OrderType;
  /** Optional free-form label — customer name, "Meja 5", "Gojek". When
   * customerPhone is also set, this becomes the loyalty record name. */
  customerName: string | null;
  /** Optional digits-only phone — present means kasir wants to attach the
   * sale to a loyalty member. Server find-or-creates customer by phone. */
  customerPhone: string | null;
  /** Optional bill-level note (catatan khusus pesanan). Trimmed + capped
   * server-side at 200 chars. Distinct from per-line `CartLineItem.note`. */
  billNote: string | null;
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
  /** Loyalty points the kasir applied as redemption on this draft. When
   * set, `discount` is auto-populated with type=fixed value=points*1000 and
   * `discountReason` is "Tukar Poin: N poin". XOR with manual discount /
   * compliment is enforced UI-side — applying a manual discount clears
   * any existing redemption, and applying redemption clears any existing
   * discount/compliment. */
  loyaltyPointsRedeemed: number | null;
  createdAt: string;
}

export type { Discount };
