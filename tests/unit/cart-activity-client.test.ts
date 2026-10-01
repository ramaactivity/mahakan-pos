import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/pos/cart-activity/actions", () => ({
  recordCartActivity: vi.fn(async (b: unknown[]) => ({ saved: b.length })),
}));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

const { logCartReduce, logCartDiscard, logCartCommit } = await import(
  "@/features/pos/cart-activity/client"
);
const queue = () => JSON.parse(store.get("mahakan.cartActivityQueue") ?? "[]");

const draft = (over: object = {}) => ({
  id: "draft-1",
  editingBillId: null as string | null,
  customerName: "Ayu",
  pagerNumber: 3,
  items: [{ cartItemId: "c1", name: "Pablo Eskopi", variant: "iced", quantity: 2, subtotal: 48000 }],
  ...over,
});

describe("cart activity logger", () => {
  beforeEach(() => store.clear());

  it("logs a qty decrease with its rupiah value", () => {
    logCartReduce(draft(), "c1", 1, 48000, null);
    const [e] = queue();
    expect(e.kind).toBe("item_remove");
    expect(e.line).toEqual({ name: "Pablo Eskopi (iced)", qty: 1, subtotal: 24000 });
    expect(e.totalAfter).toBe(24000);
    expect(e.label).toBe("Ayu / Pager 3");
  });

  it("ignores qty increases and edit-bill drafts", () => {
    logCartReduce(draft(), "c1", 3, 48000, null);
    logCartReduce(draft({ editingBillId: "b1" }), "c1", 0, 48000, null);
    expect(queue()).toHaveLength(0);
  });

  it("commit only for drafts that left a trace", () => {
    logCartCommit(draft({ id: "draft-clean" }), null, { transactionId: null });
    expect(queue()).toHaveLength(0);
    logCartReduce(draft(), "c1", 0, 48000, null);
    logCartCommit(draft(), null, { clientRefId: "00000000-0000-4000-8000-000000000000" });
    expect(queue().map((e: { kind: string }) => e.kind)).toEqual(["item_remove", "commit"]);
  });

  it("logs a discarded cart with its items", () => {
    logCartDiscard(draft(), 48000, null);
    expect(queue()[0]).toMatchObject({ kind: "discard", totalBefore: 48000 });
  });
});
