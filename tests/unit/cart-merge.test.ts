import { describe, expect, it, beforeEach } from "vitest";
import { isMergeableLine, useCartStore } from "@/features/pos/cartStore";
import type { CartLineItem, CartLineItemModifier } from "@/features/pos/types";

function mod(slug: string, value: string, priceDelta = 0): CartLineItemModifier {
  return {
    modifierSlug: slug,
    label: slug,
    selectedValue: value,
    selectedLabel: value,
    priceDelta,
  };
}

function line(over: Partial<Omit<CartLineItem, "cartItemId" | "subtotal">>): Omit<CartLineItem, "cartItemId" | "subtotal"> {
  return {
    menuItemId: over.menuItemId ?? "menu-1",
    name: over.name ?? "Iced Americano",
    categoryId: over.categoryId ?? null,
    categoryName: over.categoryName ?? "Coffee Based",
    variant: over.variant ?? "iced",
    unitPrice: over.unitPrice ?? 16_000,
    quantity: over.quantity ?? 1,
    modifiers: over.modifiers ?? [],
    modifiersPriceDelta: over.modifiersPriceDelta ?? 0,
    note: over.note ?? null,
    openPriceNote: over.openPriceNote ?? null,
  };
}

describe("isMergeableLine", () => {
  it("merges identical lines", () => {
    expect(isMergeableLine(line({}), line({}))).toBe(true);
  });

  it("rejects different menuItemId", () => {
    expect(isMergeableLine(line({ menuItemId: "a" }), line({ menuItemId: "b" }))).toBe(false);
  });

  it("rejects different variant", () => {
    expect(
      isMergeableLine(line({ variant: "iced" }), line({ variant: "hot", unitPrice: 17_000 })),
    ).toBe(false);
  });

  it("rejects different unitPrice (open-price scenario)", () => {
    expect(
      isMergeableLine(line({ unitPrice: 30_000 }), line({ unitPrice: 32_000 })),
    ).toBe(false);
  });

  it("rejects when either side has a note", () => {
    expect(isMergeableLine(line({ note: "extra es" }), line({}))).toBe(false);
    expect(isMergeableLine(line({}), line({ note: "extra es" }))).toBe(false);
  });

  it("rejects when either side has openPriceNote", () => {
    expect(isMergeableLine(line({ openPriceNote: "V60" }), line({}))).toBe(false);
  });

  it("rejects different modifier count", () => {
    expect(
      isMergeableLine(
        line({ modifiers: [] }),
        line({ modifiers: [mod("sugar_level", "less")] }),
      ),
    ).toBe(false);
  });

  it("rejects different modifier values", () => {
    expect(
      isMergeableLine(
        line({ modifiers: [mod("sugar_level", "normal")] }),
        line({ modifiers: [mod("sugar_level", "less")] }),
      ),
    ).toBe(false);
  });

  it("merges identical modifier sets in same order", () => {
    expect(
      isMergeableLine(
        line({
          modifiers: [mod("sugar_level", "less"), mod("ice_level", "normal")],
        }),
        line({
          modifiers: [mod("sugar_level", "less"), mod("ice_level", "normal")],
        }),
      ),
    ).toBe(true);
  });
});

describe("cartStore.addItem merge behavior (S3)", () => {
  beforeEach(() => {
    // Reset between tests.
    useCartStore.setState({ drafts: {} });
  });

  it("appends new line when no match", () => {
    const draftId = useCartStore.getState().startDraft(1, "takeaway");
    useCartStore.getState().addItem(draftId, line({ name: "A", menuItemId: "a" }));
    useCartStore.getState().addItem(draftId, line({ name: "B", menuItemId: "b" }));
    const draft = useCartStore.getState().getDraft(draftId)!;
    expect(draft.items).toHaveLength(2);
    expect(draft.items.map((i) => i.name)).toEqual(["A", "B"]);
  });

  it("merges qty when same item+modifiers tapped twice", () => {
    const draftId = useCartStore.getState().startDraft(1, "takeaway");
    useCartStore.getState().addItem(draftId, line({}));
    useCartStore.getState().addItem(draftId, line({}));
    useCartStore.getState().addItem(draftId, line({}));
    const draft = useCartStore.getState().getDraft(draftId)!;
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].quantity).toBe(3);
    expect(draft.items[0].subtotal).toBe(48_000); // 16k × 3
  });

  it("does NOT merge when notes present", () => {
    const draftId = useCartStore.getState().startDraft(1, "takeaway");
    useCartStore.getState().addItem(draftId, line({ note: "extra es" }));
    useCartStore.getState().addItem(draftId, line({ note: "extra es" }));
    const draft = useCartStore.getState().getDraft(draftId)!;
    // Both have notes → not mergeable per design (custom items stay separate).
    expect(draft.items).toHaveLength(2);
  });

  it("does NOT merge variant + non-variant", () => {
    const draftId = useCartStore.getState().startDraft(1, "takeaway");
    useCartStore.getState().addItem(draftId, line({ variant: "iced", unitPrice: 16_000 }));
    useCartStore.getState().addItem(draftId, line({ variant: "hot", unitPrice: 17_000 }));
    const draft = useCartStore.getState().getDraft(draftId)!;
    expect(draft.items).toHaveLength(2);
  });

  it("merges when modifiers identical (Less Sugar Iced Americano × 2)", () => {
    const draftId = useCartStore.getState().startDraft(1, "takeaway");
    const withLess = line({
      modifiers: [mod("sugar_level", "less"), mod("ice_level", "normal")],
    });
    useCartStore.getState().addItem(draftId, withLess);
    useCartStore.getState().addItem(draftId, withLess);
    const draft = useCartStore.getState().getDraft(draftId)!;
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].quantity).toBe(2);
  });

  it("does NOT merge when modifier value differs (Less vs Normal sugar)", () => {
    const draftId = useCartStore.getState().startDraft(1, "takeaway");
    useCartStore.getState().addItem(
      draftId,
      line({ modifiers: [mod("sugar_level", "less")] }),
    );
    useCartStore.getState().addItem(
      draftId,
      line({ modifiers: [mod("sugar_level", "normal")] }),
    );
    const draft = useCartStore.getState().getDraft(draftId)!;
    expect(draft.items).toHaveLength(2);
  });
});
