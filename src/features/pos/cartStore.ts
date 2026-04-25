"use client";

import { create } from "zustand";
import {
  computeDiscountAmount,
  computeItemSubtotal,
  computeTotal,
  type Discount,
} from "@/lib/money";
import type { OrderType } from "@/mocks/types";
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

interface CartStore {
  drafts: Record<string, Draft>;

  // Lifecycle
  startDraft: (pagerNumber: number, orderType: OrderType) => string;
  loadDraftFromTransaction: () => never; // placeholder for future re-edit
  removeDraft: (draftId: string) => void;

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

  startDraft: (pagerNumber, orderType) => {
    const id = genDraftId();
    const now = new Date().toISOString();
    const draft: Draft = {
      id,
      pagerNumber,
      orderType,
      items: [],
      discount: null,
      discountReason: null,
      discountApproverId: null,
      discountApproverToken: null,
      createdAt: now,
    };
    set((state) => ({ drafts: { ...state.drafts, [id]: draft } }));
    return id;
  },

  loadDraftFromTransaction: () => {
    throw new Error("Not implemented in M5 — Phase 2 feature");
  },

  removeDraft: (draftId) =>
    set((state) => {
      const next = { ...state.drafts };
      delete next[draftId];
      return { drafts: next };
    }),

  addItem: (draftId, item) =>
    set((state) => {
      const draft = state.drafts[draftId];
      if (!draft) return state;
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
      return {
        drafts: {
          ...state.drafts,
          [draftId]: {
            ...draft,
            discount,
            discountReason: reason,
            discountApproverId: approverId ?? null,
            discountApproverToken: approverToken ?? null,
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
