import { describe, expect, it } from "vitest";
import {
  computePrStatus,
  getPurchaseGroupBlockers,
  groupItemsBySupplier,
  validatePurchaseGroupItems,
  type PrPurchaseItemRow,
} from "@/features/purchase-requests/group-items-pure";

function row(overrides: Partial<PrPurchaseItemRow>): PrPurchaseItemRow {
  return {
    purchaseRequestItemId: overrides.purchaseRequestItemId ?? "pri-1",
    ingredientId: overrides.ingredientId ?? "ing-1",
    ingredientName: overrides.ingredientName ?? "Beras",
    unit: overrides.unit ?? "Kg",
    outstandingQty: overrides.outstandingQty ?? 10,
    qty: overrides.qty ?? 5,
    supplierId:
      "supplierId" in overrides ? overrides.supplierId! : "sup-A",
    unitCost: overrides.unitCost ?? 12_000,
    unitOverride: overrides.unitOverride ?? null,
    selected: overrides.selected ?? true,
  };
}

describe("groupItemsBySupplier", () => {
  it("returns empty array for no selected items", () => {
    const r = groupItemsBySupplier([row({ selected: false })]);
    expect(r).toEqual([]);
  });

  it("groups 2 items same supplier into 1 group", () => {
    const r = groupItemsBySupplier([
      row({ purchaseRequestItemId: "p1", supplierId: "sup-A", qty: 5, unitCost: 10_000 }),
      row({ purchaseRequestItemId: "p2", supplierId: "sup-A", qty: 3, unitCost: 20_000 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].supplierId).toBe("sup-A");
    expect(r[0].itemCount).toBe(2);
    expect(r[0].totalAmount).toBe(5 * 10_000 + 3 * 20_000); // 110_000
  });

  it("splits 2 different suppliers into 2 groups", () => {
    const r = groupItemsBySupplier([
      row({ purchaseRequestItemId: "p1", supplierId: "sup-A", qty: 2, unitCost: 50_000 }),
      row({ purchaseRequestItemId: "p2", supplierId: "sup-B", qty: 1, unitCost: 100_000 }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((g) => g.supplierId).sort()).toEqual(["sup-A", "sup-B"]);
  });

  it("places null supplier group last", () => {
    const r = groupItemsBySupplier([
      row({ purchaseRequestItemId: "p1", supplierId: null }),
      row({ purchaseRequestItemId: "p2", supplierId: "sup-A" }),
    ]);
    expect(r[0].supplierId).toBe("sup-A");
    expect(r[r.length - 1].supplierId).toBeNull();
    expect(r[r.length - 1].supplierName).toBe("Tanpa Supplier");
  });

  it("uses supplierNameLookup for display name", () => {
    const r = groupItemsBySupplier(
      [row({ supplierId: "sup-A" })],
      { supplierNameLookup: (id) => (id === "sup-A" ? "Toko Beras Jaya" : null) },
    );
    expect(r[0].supplierName).toBe("Toko Beras Jaya");
  });

  it("excludes deselected items from grouping", () => {
    const r = groupItemsBySupplier([
      row({ purchaseRequestItemId: "p1", selected: true, supplierId: "sup-A" }),
      row({ purchaseRequestItemId: "p2", selected: false, supplierId: "sup-A" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].itemCount).toBe(1);
  });
});

describe("validatePurchaseGroupItems", () => {
  it("returns empty for valid items", () => {
    expect(validatePurchaseGroupItems([row({})])).toEqual([]);
  });

  it("flags missing supplier as error blocker", () => {
    const issues = validatePurchaseGroupItems([row({ supplierId: null })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("supplier");
    expect(issues[0].severity).toBe("error");
  });

  it("qty > outstanding is a warning, NOT a blocker (sesi AE-122 — over-receive allowed)", () => {
    const issues = validatePurchaseGroupItems([
      row({ outstandingQty: 5, qty: 8 }),
    ]);
    const qtyIssues = issues.filter((i) => i.field === "qty");
    expect(qtyIssues).toHaveLength(1);
    expect(qtyIssues[0].severity).toBe("warning");
    // Blockers exclude warnings → empty
    expect(getPurchaseGroupBlockers(issues)).toEqual([]);
  });

  it("flags qty <= 0 as error blocker", () => {
    const issues = validatePurchaseGroupItems([row({ qty: 0 })]);
    const qtyIssues = issues.filter((i) => i.field === "qty");
    expect(qtyIssues.some((i) => i.severity === "error")).toBe(true);
    expect(getPurchaseGroupBlockers(issues).length).toBeGreaterThan(0);
  });

  it("ignores deselected items", () => {
    const issues = validatePurchaseGroupItems([
      row({ supplierId: null, selected: false }),
    ]);
    expect(issues).toEqual([]);
  });

  it("getPurchaseGroupBlockers filters out warnings", () => {
    const issues = validatePurchaseGroupItems([
      row({ outstandingQty: 5, qty: 8, supplierId: null }), // qty warning + supplier error
    ]);
    const blockers = getPurchaseGroupBlockers(issues);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].field).toBe("supplier");
  });
});

describe("computePrStatus", () => {
  it("returns open for fresh PR (no receive)", () => {
    expect(
      computePrStatus([{ requestedQty: 10, receivedQty: 0, rejectedAt: null }]),
    ).toBe("open");
  });

  it("returns partial when some received", () => {
    expect(
      computePrStatus([
        { requestedQty: 10, receivedQty: 5, rejectedAt: null },
        { requestedQty: 5, receivedQty: 0, rejectedAt: null },
      ]),
    ).toBe("partial");
  });

  it("returns completed when all received", () => {
    expect(
      computePrStatus([
        { requestedQty: 10, receivedQty: 10, rejectedAt: null },
        { requestedQty: 5, receivedQty: 5, rejectedAt: null },
      ]),
    ).toBe("completed");
  });

  it("rejected items don't block completion", () => {
    expect(
      computePrStatus([
        { requestedQty: 10, receivedQty: 10, rejectedAt: null },
        { requestedQty: 5, receivedQty: 0, rejectedAt: new Date() },
      ]),
    ).toBe("completed");
  });

  it("returns open for empty array", () => {
    expect(computePrStatus([])).toBe("open");
  });
});
