import { describe, expect, it } from "vitest";
import {
  packUnitsFromIngredient,
  parsePackUnitsForm,
  type PackUnitsForm,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-174 — editor satuan terpadu (PackUnitsEditor) mapping.
 * Form 2 bagian: Satuan Belanja Utama (→ unitBelanja) + Satuan Pack Lain
 * (→ packConversions). Round-trip + validasi.
 */

const form = (over: Partial<PackUnitsForm> = {}): PackUnitsForm => ({
  mainLabel: "",
  mainQtyStr: "",
  packRows: [],
  ...over,
});

describe("packUnitsFromIngredient", () => {
  it("unitBelanja → main; packConversions → packRows (Chocolatos)", () => {
    const f = packUnitsFromIngredient({
      unitBelanja: "renceng",
      unitBelanjaPerCogs: "280.0000",
      packConversions: [{ unitLabel: "sachet", qtyPerBase: 28 }],
    });
    expect(f.mainLabel).toBe("renceng");
    expect(f.mainQtyStr).toBe("280");
    expect(f.packRows).toHaveLength(1);
    expect(f.packRows[0]!.unitLabel).toBe("sachet");
    expect(f.packRows[0]!.qtyPerBaseStr).toBe("28");
  });

  it("label pack yang sama dengan Belanja Utama tidak dobel", () => {
    const f = packUnitsFromIngredient({
      unitBelanja: "renceng",
      unitBelanjaPerCogs: 280,
      packConversions: [
        { unitLabel: "Renceng", qtyPerBase: 280 },
        { unitLabel: "sachet", qtyPerBase: 28 },
      ],
    });
    expect(f.packRows.map((r) => r.unitLabel)).toEqual(["sachet"]);
  });

  it("tanpa unitBelanja → main kosong", () => {
    const f = packUnitsFromIngredient({
      unitBelanja: null,
      unitBelanjaPerCogs: null,
      packConversions: [{ unitLabel: "Kg", qtyPerBase: 1000 }],
    });
    expect(f.mainLabel).toBe("");
    expect(f.packRows).toHaveLength(1);
  });
});

describe("parsePackUnitsForm", () => {
  it("main → unitBelanja, packRows → packConversions", () => {
    const r = parsePackUnitsForm(
      form({
        mainLabel: "renceng",
        mainQtyStr: "280",
        packRows: [{ id: "p0", unitLabel: "sachet", qtyPerBaseStr: "28" }],
      }),
      "gr",
    );
    expect(r.error).toBeNull();
    expect(r.unitBelanja).toBe("renceng");
    expect(r.unitBelanjaPerCogs).toBe(280);
    expect(r.packConversions).toEqual([{ unitLabel: "sachet", qtyPerBase: 28 }]);
  });

  it("koma desimal id-ID diterima", () => {
    const r = parsePackUnitsForm(
      form({ mainLabel: "botol", mainQtyStr: "2,5" }),
      "L",
    );
    expect(r.unitBelanjaPerCogs).toBe(2.5);
  });

  it("round-trip stabil", () => {
    const data = {
      unitBelanja: "renceng",
      unitBelanjaPerCogs: 280,
      packConversions: [{ unitLabel: "sachet", qtyPerBase: 28 }],
    };
    const f = packUnitsFromIngredient(data);
    const back = parsePackUnitsForm(f, "gr");
    expect(back.unitBelanja).toBe(data.unitBelanja);
    expect(back.unitBelanjaPerCogs).toBe(data.unitBelanjaPerCogs);
    expect(back.packConversions).toEqual(data.packConversions);
  });

  it("tanpa main → unitBelanja null, packConversions terisi", () => {
    const r = parsePackUnitsForm(
      form({ packRows: [{ id: "p0", unitLabel: "Kg", qtyPerBaseStr: "1000" }] }),
      "gr",
    );
    expect(r.unitBelanja).toBeNull();
    expect(r.packConversions).toEqual([{ unitLabel: "Kg", qtyPerBase: 1000 }]);
  });

  it("baris kosong di-skip", () => {
    const r = parsePackUnitsForm(
      form({
        packRows: [
          { id: "p0", unitLabel: "", qtyPerBaseStr: "" },
          { id: "p1", unitLabel: "sachet", qtyPerBaseStr: "28" },
        ],
      }),
      "gr",
    );
    expect(r.error).toBeNull();
    expect(r.packConversions).toHaveLength(1);
  });

  it("error: label == satuan dasar", () => {
    const r = parsePackUnitsForm(form({ mainLabel: "gr", mainQtyStr: "1" }), "gr");
    expect(r.error).toContain("satuan dasar");
  });

  it("error: label angka murni", () => {
    const r = parsePackUnitsForm(form({ mainLabel: "280", mainQtyStr: "1" }), "gr");
    expect(r.error).toContain("angka");
  });

  it("error: duplikat antara main & pack", () => {
    const r = parsePackUnitsForm(
      form({
        mainLabel: "renceng",
        mainQtyStr: "280",
        packRows: [{ id: "p0", unitLabel: "Renceng", qtyPerBaseStr: "280" }],
      }),
      "gr",
    );
    expect(r.error).toContain("duplikat");
  });

  it("error: qty <= 0", () => {
    const r = parsePackUnitsForm(form({ mainLabel: "renceng", mainQtyStr: "0" }), "gr");
    expect(r.error).toContain("> 0");
  });

  it("error: main label diisi tapi qty kosong", () => {
    const r = parsePackUnitsForm(form({ mainLabel: "renceng", mainQtyStr: "" }), "gr");
    expect(r.error).toBeTruthy();
  });

  it("error: > 10 pack lain", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: `p${i}`,
      unitLabel: `unit${i}`,
      qtyPerBaseStr: "2",
    }));
    const r = parsePackUnitsForm(form({ packRows: rows }), "gr");
    expect(r.error).toContain("10");
  });
});
