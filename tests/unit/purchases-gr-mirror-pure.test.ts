import { describe, expect, it } from "vitest";
import {
  mirrorReceiptTotal,
  mirrorSectionLines,
  planGrMirror,
  type MirrorGrLine,
  type MirrorPoLine,
} from "@/features/purchases/gr-mirror-pure";

function poLine(over: Partial<MirrorPoLine> = {}): MirrorPoLine {
  return {
    purchaseItemId: "pi-1",
    ingredientId: "ing-1",
    qtyNota: 2,
    qtyMaster: 2000,
    unitCost: 47_000,
    ingredientName: "Ayam Fillet",
    unitSnapshot: "gr",
    sectionSnapshot: "kitchen",
    ...over,
  };
}

function grLine(over: Partial<MirrorGrLine> = {}): MirrorGrLine {
  return {
    grItemId: "gi-1",
    purchaseItemId: "pi-1",
    movementId: "mv-1",
    movementQtyMaster: 2000,
    movementSkipped: true,
    ingredientId: "ing-1",
    ...over,
  };
}

describe("planGrMirror", () => {
  it("qty penerimaan mengikuti qty PO yang baru", () => {
    const actions = planGrMirror(
      [poLine({ qtyNota: 3, qtyMaster: 3000 })],
      [grLine()],
    );
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.kind).toBe("update");
    if (a.kind !== "update") throw new Error("expected update");
    expect(a.receivedQtyNota).toBe(3);
    expect(a.qtyMaster).toBe(3000);
    expect(a.lineTotal).toBe(141_000);
  });

  it("baris PO baru menghasilkan baris penerimaan baru", () => {
    const actions = planGrMirror(
      [poLine(), poLine({ purchaseItemId: "pi-2", ingredientId: "ing-2" })],
      [grLine()],
    );
    const inserts = actions.filter((a) => a.kind === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ purchaseItemId: "pi-2" });
  });

  it("baris PO yang dibuang menghasilkan penghapusan penerimaannya", () => {
    const actions = planGrMirror(
      [],
      [grLine(), grLine({ grItemId: "gi-2", purchaseItemId: "pi-2" })],
    );
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.kind === "delete")).toBe(true);
  });

  /* Inti anti-drift: pergerakan mode periodic TIDAK pernah menyentuh stok,
   * jadi mengubah qty-nya tidak boleh memunculkan koreksi stok. */
  it("pergerakan ber-skip tidak menghasilkan koreksi stok", () => {
    const actions = planGrMirror(
      [poLine({ qtyNota: 5, qtyMaster: 5000 })],
      [grLine({ movementSkipped: true, movementQtyMaster: 2000 })],
    );
    if (actions[0].kind !== "update") throw new Error("expected update");
    expect(actions[0].stockDelta).toBe(0);
  });

  it("pergerakan yang benar-benar menambah stok dikoreksi sebesar selisihnya", () => {
    const actions = planGrMirror(
      [poLine({ qtyNota: 5, qtyMaster: 5000 })],
      [grLine({ movementSkipped: false, movementQtyMaster: 2000 })],
    );
    if (actions[0].kind !== "update") throw new Error("expected update");
    expect(actions[0].stockDelta).toBe(3000);
  });

  it("hapus baris yang pernah menambah stok mengembalikan stoknya", () => {
    const actions = planGrMirror(
      [],
      [grLine({ movementSkipped: false, movementQtyMaster: 2000 })],
    );
    if (actions[0].kind !== "delete") throw new Error("expected delete");
    expect(actions[0].stockDelta).toBe(-2000);
  });

  it("baris tak berubah tetap menghasilkan delta stok nol", () => {
    const actions = planGrMirror(
      [poLine()],
      [grLine({ movementSkipped: false })],
    );
    if (actions[0].kind !== "update") throw new Error("expected update");
    expect(actions[0].stockDelta).toBe(0);
  });
});

describe("mirrorReceiptTotal", () => {
  it("menjumlah baris yang tersisa dan mengabaikan yang dihapus", () => {
    const actions = planGrMirror(
      [
        poLine({ qtyNota: 2, unitCost: 47_000 }),
        poLine({
          purchaseItemId: "pi-2",
          ingredientId: "ing-2",
          qtyNota: 3,
          unitCost: 10_000,
          sectionSnapshot: "bar",
        }),
      ],
      [grLine(), grLine({ grItemId: "gi-9", purchaseItemId: "pi-9" })],
    );
    expect(mirrorReceiptTotal(actions)).toBe(94_000 + 30_000);
  });
});

describe("mirrorSectionLines", () => {
  it("mengelompokkan nilai per seksi persediaan", () => {
    const actions = planGrMirror(
      [
        poLine({ qtyNota: 2, unitCost: 47_000, sectionSnapshot: "kitchen" }),
        poLine({
          purchaseItemId: "pi-2",
          ingredientId: "ing-2",
          qtyNota: 3,
          unitCost: 10_000,
          sectionSnapshot: "bar",
        }),
        poLine({
          purchaseItemId: "pi-3",
          ingredientId: "ing-3",
          qtyNota: 1,
          unitCost: 5_000,
          sectionSnapshot: "kitchen",
        }),
      ],
      [],
    );
    const lines = mirrorSectionLines(actions);
    expect(lines).toEqual(
      expect.arrayContaining([
        { section: "kitchen", amount: 99_000 },
        { section: "bar", amount: 30_000 },
      ]),
    );
    expect(lines).toHaveLength(2);
  });
});
