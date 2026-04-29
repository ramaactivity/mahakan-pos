"use client";

import { create } from "zustand";
import {
  computeDiscountAmount,
  computeItemSubtotal,
  computeTotal,
  type Discount,
} from "@/lib/money";
import type {
  OrderType,
  TransactionWithItems,
} from "@/features/transactions";
import type { CartLineItem, CartLineItemModifier, Draft } from "./types";

function genCartItemId(): string {
  return `cart-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function genDraftId(): string {
  return `draft-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function recalcSubtotal(item: CartLineItem): CartLineItem {
  const subtotal = computeItemSubtotal(
    item.unitPrice,
    item.modifiersPriceDelta,
    item.quantity,
  );
  return { ...item, subtotal };
}

/**
 * Equality check for line-merge (S3): two cart line proposals are mergeable
 * if menu, variant, unit price, modifier set, and notes are identical. Items
 * with notes or openPriceNote are treated as DIFFERENT — those are
 * deliberately custom and shouldn't auto-collapse.
 */
export function isMergeableLine(
  a: Omit<CartLineItem, "cartItemId" | "subtotal">,
  b: Omit<CartLineItem, "cartItemId" | "subtotal">,
): boolean {
  if (a.menuItemId !== b.menuItemId) return false;
  if (a.variant !== b.variant) return false;
  if (a.unitPrice !== b.unitPrice) return false;
  if (a.note !== null || b.note !== null) return false;
  if (a.openPriceNote !== null || b.openPriceNote !== null) return false;
  if (a.modifiers.length !== b.modifiers.length) return false;
  // Modifiers are order-stable per ItemModifierModal builder (seed-defined).
  // Compare slug + selectedValue per index.
  for (let i = 0; i < a.modifiers.length; i++) {
    const ma = a.modifiers[i];
    const mb = b.modifiers[i];
    if (ma.modifierSlug !== mb.modifierSlug) return false;
    if (ma.selectedValue !== mb.selectedValue) return false;
  }
  return true;
}

interface CartStore {
  drafts: Record<string, Draft>;

  // Lifecycle
  startDraft: (
    pagerNumber: number | null,
    orderType: OrderType,
    customerName?: string | null,
    customerPhone?: string | null,
  ) => string;
  setPagerNumber: (draftId: string, pagerNumber: number | null) => void;
  setOrderType: (draftId: string, orderType: OrderType) => void;
  /** Materialize an existing open bill into a fresh Draft so kasir can
   * edit items via the normal cart UI. Sets `editingBillId` — PosShell
   * routes save through editOpenBill. */
  loadOpenBillIntoDraft: (trx: TransactionWithItems) => string;
  removeDraft: (draftId: string) => void;
  setCustomerName: (draftId: string, customerName: string | null) => void;
  setBillNote: (draftId: string, billNote: string | null) => void;

  // Items
  addItem: (
    draftId: string,
    item: Omit<CartLineItem, "cartItemId" | "subtotal">,
  ) => void;
  updateQuantity: (
    draftId: string,
    cartItemId: string,
    quantity: number,
  ) => void;
  removeItem: (draftId: string, cartItemId: string) => void;
  updateNote: (draftId: string, cartItemId: string, note: string | null) => void;

  // Discount
  setDiscount: (
    draftId: string,
    discount: Discount | null,
    reason: string | null,
    approverId?: string,
    approverToken?: string,
  ) => void;

  /** Loyalty redemption — sets discount + reason atomically and tracks the
   * point count separately. Pass `points=0` to clear the redemption.
   * Caller responsibility: validate balance + subtotal coverage upstream. */
  applyRedemption: (draftId: string, points: number) => void;

  // Selectors (computed)
  // NOTE: never call these inside a Zustand selector that returns a
  // non-primitive (`useCartStore((s) => s.someFn())`) — they may produce
  // new references on each call and cause useSyncExternalStore loops.
  // Always select the raw `drafts` record and derive arrays via useMemo.
  getDraft: (draftId: string) => Draft | undefined;
  getSubtotal: (draftId: string) => number;
  getDiscountAmount: (draftId: string) => number;
  getTotal: (draftId: string) => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  drafts: {},

  startDraft: (pagerNumber, orderType, customerName, customerPhone) => {
    const id = genDraftId();
    const now = new Date().toISOString();
    const trimmedName = customerName?.trim();
    const trimmedPhone = customerPhone?.replace(/[^\d]/g, "");
    const draft: Draft = {
      id,
      pagerNumber,
      orderType,
      customerName: trimmedName && trimmedName.length > 0 ? trimmedName : null,
      customerPhone:
        trimmedPhone && trimmedPhone.length >= 6 ? trimmedPhone : null,
      billNote: null,
      items: [],
      discount: null,
      discountReason: null,
      discountApproverId: null,
      discountApproverToken: null,
      editingBillId: null,
      loyaltyPointsRedeemed: null,
      createdAt: now,
    };
    set((state) => ({ drafts: { ...state.drafts, [id]: draft } }));
    return id;
  },

  loadOpenBillIntoDraft: (trx) => {
    const id = genDraftId();
    const now = new Date().toISOString();
    const draft: Draft = {
      id,
      pagerNumber: trx.pagerNumber,
      orderType: trx.orderType,
      customerName: trx.customerName ?? null,
      // We don't have phone on the transaction row directly, only via
      // customers.id linkage. The edit-flow doesn't auto-populate phone —
      // kasir re-types if they want to confirm/change member linkage.
      customerPhone: null,
      billNote: trx.note ?? null,
      items: trx.items.map((it) => ({
        cartItemId: genCartItemId(),
        menuItemId: it.menuItemId,
        name: it.itemName,
        categoryName: it.itemCategoryName,
        variant: it.variant,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        modifiers: it.modifiers.map((m) => ({
          modifierSlug: m.modifierSlug,
          // We lost the original modifier label list at sale time; use slug
          // as fallback so UI can still render. Re-edit re-builds via
          // ItemModifierModal where labels come from menu data.
          label: m.modifierSlug,
          selectedValue: m.selectedValue,
          selectedLabel: m.selectedValue,
          priceDelta: m.priceDelta,
        })),
        modifiersPriceDelta: it.modifiersPriceDelta,
        subtotal: it.subtotal,
        note: it.note,
        openPriceNote: it.openPriceNote,
      })),
      discount:
        trx.discountType && trx.discountValue !== null
          ? { type: trx.discountType, value: trx.discountValue }
          : null,
      discountReason: trx.discountReason,
      discountApproverId: trx.discountApprover ?? null,
      discountApproverToken: null, // approver token is single-use; re-approve on save if discount changes
      editingBillId: trx.id,
      loyaltyPointsRedeemed: null, // redemption is paid-flow only — edit-bill resets it
      createdAt: now,
    };
    set((state) => ({ drafts: { ...state.drafts, [id]: draft } }));
    return id;
  },

  removeDraft: (draftId) =>
    set((state) => {
      const next = { ...state.drafts };
      delete next[draftId];
      return { drafts: next };
    }),

  setCustomerName: (draftId, customerName) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      const trimmed = customerName?.trim();
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            customerName: trimmed && trimmed.length > 0 ? trimmed : null,
          },
        },
      };
    }),

  setPagerNumber: (draftId, pagerNumber) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      return {
        drafts: {
          ...state.drafts,
          [draftId]: { ...draft, pagerNumber },
        },
      };
    }),

  setOrderType: (draftId, orderType) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      return {
        drafts: {
          ...state.drafts,
          [draftId]: { ...draft, orderType },
        },
      };
    }),

  setBillNote: (draftId, billNote) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      const trimmed = billNote?.trim();
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            billNote: trimmed && trimmed.length > 0 ? trimmed.slice(0, 200) : null,
          },
        },
      };
    }),

  addItem: (draftId, item) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      // S3: merge into existing line if menu+variant+modifiers+price match
      // (and neither side has a note/openPriceNote — those stay separate).
      const mergeIdx = draft.items.findIndex((existing) =>
        isMergeableLine(existing, item),
      );
      if (mergeIdx >= 0) {
        const existing = draft.items[mergeIdx];
        const merged = recalcSubtotal({
          ...existing,
          quantity: existing.quantity + item.quantity,
        });
        const next = [...draft.items];
        next[mergeIdx] = merged;
        return {
          drafts: { ...state.drafts, [draftId]: { ...draft, items: next } },
        };
      }
      const newItem = recalcSubtotal({
        ...item,
        cartItemId: genCartItemId(),
        subtotal: 0,
      });
      return {
        drafts: {
          ...state.drafts,
          [draftId]: { ...draft, items: [...draft.items, newItem] },
        },
      };
    }),

  updateQuantity: (draftId, cartItemId, quantity) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      // Quantity 0 removes the item
      if (quantity <= 0) {
        return {
          drafts: {
            ...state.drafts,
            [draftId]: {
              ...draft,
              items: draft.items.filter((i) => i.cartItemId !== cartItemId),
            },
          },
        };
      }
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            items: draft.items.map((i) =>
              i.cartItemId === cartItemId
                ? recalcSubtotal({ ...i, quantity })
                : i,
            ),
          },
        },
      };
    }),

  removeItem: (draftId, cartItemId) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            items: draft.items.filter((i) => i.cartItemId !== cartItemId),
          },
        },
      };
    }),

  updateNote: (draftId, cartItemId, note) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            items: draft.items.map((i) =>
              i.cartItemId === cartItemId ? { ...i, note } : i,
            ),
          },
        },
      };
    }),

  setDiscount: (draftId, discount, reason, approverId, approverToken) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      // Manual discount/compliment clears any pre-existing redemption — XOR.
      // Passing the redemption-shaped reason here also keeps the count if
      // applyRedemption is the actual caller (it dispatches via setDiscount
      // internally for shared persistence).
      const isRedemption = (reason ?? "").startsWith("Tukar Poin:");
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            discount,
            discountReason: reason,
            discountApproverId: approverId ?? null,
            discountApproverToken: approverToken ?? null,
            loyaltyPointsRedeemed: isRedemption
              ? draft.loyaltyPointsRedeemed
              : null,
          },
        },
      };
    }),

  applyRedemption: (draftId, points) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
      if (points <= 0) {
        return {
          drafts: {
            ...state.drafts,
            [draftId]: {
              ...draft,
              discount: null,
              discountReason: null,
              discountApproverId: null,
              discountApproverToken: null,
              loyaltyPointsRedeemed: null,
            },
          },
        };
      }
      const rupiah = points * 1000;
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            discount: { type: "fixed", value: rupiah },
            discountReason: `Tukar Poin: ${points} poin`,
            discountApproverId: null,
            discountApproverToken: null,
            loyaltyPointsRedeemed: points,
          },
        },
      };
    }),

  getDraft: (draftId) => get().drafts[draftId],

  getSubtotal: (draftId) => {
    const draft = get().drafts[draftId];
    if (!draft) return 0;
    return draft.items.reduce((sum, i) => sum + i.subtotal, 0);
  },

  getDiscountAmount: (draftId) => {
    const draft = get().drafts[draftId];
    if (!draft) return 0;
    const subtotal = draft.items.reduce((s, i) => s + i.subtotal, 0);
    return computeDiscountAmount(subtotal, draft.discount);
  },

  getTotal: (draftId) => {
    const draft = get().drafts[draftId];
    if (!draft) return 0;
    const subtotal = draft.items.reduce((s, i) => s + i.subtotal, 0);
    const discount = computeDiscountAmount(subtotal, draft.discount);
    return computeTotal(subtotal, discount);
  },
}));

/** Helper used by ItemModifierModal to build the line item before adding. */
export function buildLineItem(args: {
  menuItemId: string;
  name: string;
  categoryName: string;
  variant: CartLineItem["variant"];
  unitPrice: number;
  quantity: number;
  modifiers: CartLineItemModifier[];
  note: string | null;
  openPriceNote: string | null;
}): Omit<CartLineItem, "cartItemId" | "subtotal"> {
  const modifiersPriceDelta = args.modifiers.reduce(
    (sum, m) => sum + m.priceDelta,
    0,
  );
  return {
    menuItemId: args.menuItemId,
    name: args.name,
    categoryName: args.categoryName,
    variant: args.variant,
    unitPrice: args.unitPrice,
    quantity: args.quantity,
    modifiers: args.modifiers,
    modifiersPriceDelta,
    note: args.note,
    openPriceNote: args.openPriceNote,
  };
}
