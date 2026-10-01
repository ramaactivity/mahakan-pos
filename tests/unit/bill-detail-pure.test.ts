import { describe, expect, it } from "vitest";
import { findMoveCandidates, type InflowEvent } from "@/features/reports/bill-detail-pure";

const ev = (over: Partial<InflowEvent>): InflowEvent => ({
  transactionId: "t2",
  transactionNumber: "TRX-2",
  customerName: null,
  status: "paid",
  at: "2026-09-26T14:00:00Z",
  kind: "edit_up",
  amount: 48000,
  items: null,
  ...over,
});

describe("findMoveCandidates", () => {
  const at = "2026-09-26T14:00:00Z";

  it("no trace when no bill absorbed the amount (TRX-20260826-0003 case)", () => {
    const r = findMoveCandidates({ at, amount: 80000, totalBefore: 105000, removed: null }, [
      ev({ amount: 60000 }),
      ev({ amount: 10000 }),
    ]);
    expect(r.verdict).toBe("no_trace");
    expect(r.candidates).toHaveLength(0);
  });

  it("likely_moved on exact amount when items were not recorded", () => {
    const r = findMoveCandidates({ at, amount: 48000, totalBefore: 90000, removed: null }, [ev({})]);
    expect(r.verdict).toBe("likely_moved");
  });

  it("moved when amount and item names both match", () => {
    const r = findMoveCandidates(
      { at, amount: 48000, totalBefore: 90000, removed: [{ name: "Brownie Ice Cream", qty: 1 }] },
      [ev({ items: [{ name: "Brownie Ice Cream", qty: 1 }] })],
    );
    expect(r.verdict).toBe("moved");
    expect(r.candidates[0].itemMatches).toEqual(["Brownie Ice Cream"]);
  });

  it("item_mismatch when amount equal but different items", () => {
    const r = findMoveCandidates(
      { at, amount: 48000, totalBefore: 90000, removed: [{ name: "Pablo Eskopi (iced)", qty: 1 }] },
      [ev({ items: [{ name: "Americano (iced)", qty: 1 }] })],
    );
    expect(r.verdict).toBe("item_mismatch");
  });

  it("paid_separately when another trx equals the pre-edit total (Kapras case)", () => {
    const r = findMoveCandidates({ at, amount: 8000, totalBefore: 24000, removed: null }, [
      ev({ kind: "direct_sale", amount: 24000, at: "2026-09-26T12:12:00Z" }),
    ]);
    expect(r.verdict).toBe("paid_separately");
    expect(r.candidates[0].fullBeforeMatch).toBe(true);
  });

  it("ignores events outside the time window", () => {
    const r = findMoveCandidates({ at, amount: 48000, totalBefore: 90000, removed: null }, [
      ev({ at: "2026-09-26T20:00:00Z" }),
    ]);
    expect(r.verdict).toBe("no_trace");
  });
});
