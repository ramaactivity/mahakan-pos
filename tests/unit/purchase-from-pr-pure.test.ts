import { describe, expect, it } from "vitest";
import {
  applyPrReceiveDelta,
  categorizePrItem,
  computePrStatus,
  getPurchaseGroupBlockers,
  groupItemsBySupplier,
  validatePurchaseGroupItems,
  type PrPurchaseItemRow,
} from "@/features/purchase-requests/group-items-pure";
import { computePrLineDefault } from "@/features/admin/sections/inventory/purchases/purchase-line-helpers";

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

  it("completed when every item bought even if UNDER requested (owner override)", () => {
    // Feedback Anisa: owner sengaja beli lebih sedikit dari request staff →
    // qty kurang = keputusan final, PR tetap Selesai selama tiap item dapat ≥1.
    expect(
      computePrStatus([
        { requestedQty: 5726, receivedQty: 2000, rejectedAt: null },
        { requestedQty: 535, receivedQty: 500, rejectedAt: null },
        { requestedQty: 30, receivedQty: 20, rejectedAt: null },
      ]),
    ).toBe("completed");
  });

  it("stays partial when an item is skipped entirely (qty 0)", () => {
    // Item yang belum dibeli sama sekali tetap menahan PR di partial —
    // owner tutup manual via Tandai Selesai.
    expect(
      computePrStatus([
        { requestedQty: 10, receivedQty: 3, rejectedAt: null },
        { requestedQty: 5, receivedQty: 0, rejectedAt: null },
      ]),
    ).toBe("partial");
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

describe("computePrLineDefault (harga saran)", () => {
  /* Sesi AE-177 — utamakan harga supplier ASLI saat dekat estimasi master
   * (hindari drift pembulatan). */
  it("Sabun: pakai harga supplier 10.000, BUKAN cpu(13)×780=10.140", () => {
    const d = computePrLineDefault({
      outstandingQty: 1170, // ml
      masterUnit: "ml",
      prUnit: "ml",
      costPerUnit: 13, // per ml, rounded dari 10000/780=12,82
      suggestedUnitCost: 10000, // harga supplier asli per Pack
      belanjaUnit: "Pack",
      belanjaPerCogs: 780, // 1 Pack = 780 ml
    });
    expect(d.unit).toBe("Pack");
    expect(d.qty).toBeCloseTo(1.5, 4); // 1170/780
    expect(d.unitCost).toBe(10000); // bukan 10140
  });

  it("harga supplier jauh dari estimasi (satuan beda) → pakai estimasi master", () => {
    const d = computePrLineDefault({
      outstandingQty: 1000,
      masterUnit: "gr",
      prUnit: "gr",
      costPerUnit: 80, // per gr
      suggestedUnitCost: 999999, // jauh → jangan dipakai
      belanjaUnit: "Kg",
      belanjaPerCogs: 1000,
    });
    expect(d.unitCost).toBe(80000); // 80×1000
  });

  it("tanpa suggestedUnitCost → estimasi master", () => {
    const d = computePrLineDefault({
      outstandingQty: 1500,
      masterUnit: "gr",
      prUnit: "gr",
      costPerUnit: 10,
      suggestedUnitCost: 0,
      belanjaUnit: "Kg",
      belanjaPerCogs: 1000,
    });
    expect(d.unitCost).toBe(10000);
  });
});

/* Feedback Cacil 2026-06-12 — bucket per item PR. Definisi tunggal yang
 * dipakai detail modal, RequestCard, Tarik ke Pembelian, dan stats. */
describe("categorizePrItem", () => {
  it("rejected menang atas semua state lain", () => {
    expect(
      categorizePrItem({
        receivedQty: 5,
        rejectedAt: new Date(),
        inActivePurchase: true,
      }),
    ).toBe("rejected");
  });

  it("received > 0 → bought (walau kurang dari request = final owner)", () => {
    expect(
      categorizePrItem({
        receivedQty: 1,
        rejectedAt: null,
        inActivePurchase: false,
      }),
    ).toBe("bought");
  });

  it("received > 0 dalam PO aktif tetap bought (received menang)", () => {
    expect(
      categorizePrItem({
        receivedQty: 3,
        rejectedAt: null,
        inActivePurchase: true,
      }),
    ).toBe("bought");
  });

  it("received 0 tapi sudah ditarik ke PO aktif → ordered (cegah dobel-tarik)", () => {
    expect(
      categorizePrItem({
        receivedQty: 0,
        rejectedAt: null,
        inActivePurchase: true,
      }),
    ).toBe("ordered");
  });

  it("received 0 tanpa link PO → outstanding (boleh ditarik)", () => {
    expect(
      categorizePrItem({
        receivedQty: 0,
        rejectedAt: null,
        inActivePurchase: false,
      }),
    ).toBe("outstanding");
  });

  it("PO dibatalkan (link tidak aktif lagi) → kembali outstanding", () => {
    // caller (fetchActivePurchaseLinkIds) sudah exclude purchase cancelled,
    // jadi inActivePurchase=false → item bisa ditarik ulang.
    expect(
      categorizePrItem({
        receivedQty: 0,
        rejectedAt: null,
        inActivePurchase: false,
      }),
    ).toBe("outstanding");
  });
});

/* Feedback Cacil 2026-06-12 (audit lanjutan) — un-bump receivedQty PR saat
 * cancelPurchase. Decimal = truth; bigint jaga invariant >0 → ≥1. */
describe("applyPrReceiveDelta", () => {
  it("un-bump penuh → balik ke 0 (item bisa ditarik ulang)", () => {
    const r = applyPrReceiveDelta({ currentDecimal: 5, delta: -5 });
    expect(r.receivedQty).toBe(0);
    expect(r.receivedQtyDecimal).toBe("0.0000");
  });

  it("un-bump sebagian → sisa kontribusi pembelian lain tetap", () => {
    const r = applyPrReceiveDelta({ currentDecimal: 8, delta: -5 });
    expect(r.receivedQty).toBe(3);
    expect(r.receivedQtyDecimal).toBe("3.0000");
  });

  it("clamp 0 — un-bump melebihi current (bump min-1 inflation) tidak negatif", () => {
    const r = applyPrReceiveDelta({ currentDecimal: 0.3, delta: -1 });
    expect(r.receivedQty).toBe(0);
    expect(r.receivedQtyDecimal).toBe("0.0000");
  });

  it("sisa pecahan kecil > 0 → bigint tetap ≥1 (bucket bought akurat)", () => {
    const r = applyPrReceiveDelta({ currentDecimal: 5.3, delta: -5 });
    expect(r.receivedQty).toBe(1); // max(1, round(0.3))
    expect(r.receivedQtyDecimal).toBe("0.3000");
  });

  it("debu float < 1e-6 dianggap 0", () => {
    const r = applyPrReceiveDelta({ currentDecimal: 5, delta: -4.9999999 });
    expect(r.receivedQty).toBe(0);
    expect(r.receivedQtyDecimal).toBe("0.0000");
  });

  it("delta positif (bump) juga konsisten", () => {
    const r = applyPrReceiveDelta({ currentDecimal: 0, delta: 0.5 });
    expect(r.receivedQty).toBe(1);
    expect(r.receivedQtyDecimal).toBe("0.5000");
  });
});
