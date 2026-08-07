import { describe, expect, it } from "vitest";
import {
  indexMasterByName,
  matchManualItemToMaster,
  type ManualLinkCandidate,
} from "@/features/purchase-requests/manual-link-pure";
import {
  convertQtyWithIngredientPacks,
  displayUnit,
  mergePackConversions,
} from "@/lib/unit-conversion";

/* Pakai library konversi ASLI, bukan stub — yang mau dijaga di sini justru
 * apakah tebakan tautan gugur saat konversi satuan tidak tersedia. */
const deps = {
  displayUnit,
  convertQtyWithIngredientPacks,
  mergePackConversions,
};

function ing(over: Partial<ManualLinkCandidate>): ManualLinkCandidate {
  return {
    id: "ing-1",
    name: "Regal",
    unit: "Pcs",
    packConversions: [],
    unitBelanja: null,
    unitBelanjaPerCogs: null,
    ...over,
  };
}

describe("purchase request — auto-link item manual ke master (sesi AE-190)", () => {
  it("menaut saat nama & satuan sama persis", () => {
    const byName = indexMasterByName([ing({})]);
    const r = matchManualItemToMaster(
      { name: "Regal", unit: "Pcs", qty: 2 },
      byName,
      deps,
    );
    expect(r).toEqual({ id: "ing-1", name: "Regal", unit: "Pcs", qtyMaster: 2 });
  });

  it("mengabaikan beda kapital dan spasi berlebih", () => {
    const byName = indexMasterByName([
      ing({ id: "ing-2", name: "Bawang Goreng", unit: "gr" }),
    ]);
    const r = matchManualItemToMaster(
      { name: "  bawang goreng ", unit: "gr", qty: 500 },
      byName,
      deps,
    );
    expect(r?.id).toBe("ing-2");
    /* Nama master yang dipakai, bukan ketikan staff. */
    expect(r?.name).toBe("Bawang Goreng");
  });

  it("mengonversi qty ke satuan master lewat dimensi yang sama (Kg → gr)", () => {
    const byName = indexMasterByName([
      ing({ id: "ing-3", name: "Gula", unit: "gr" }),
    ]);
    const r = matchManualItemToMaster(
      { name: "Gula", unit: "Kg", qty: 2 },
      byName,
      deps,
    );
    expect(r?.qtyMaster).toBe(2000);
  });

  it("mengonversi lewat Konversi Pack milik bahan", () => {
    const byName = indexMasterByName([
      ing({
        id: "ing-4",
        name: "Susu Omela",
        unit: "ml",
        packConversions: [{ unitLabel: "Karton", qtyPerBase: 12000 }],
      }),
    ]);
    const r = matchManualItemToMaster(
      { name: "Susu Omela", unit: "Karton", qty: 3 },
      byName,
      deps,
    );
    expect(r?.qtyMaster).toBe(36000);
  });

  it("BATAL menaut kalau satuan tidak bisa dikonversi — jangan catat 3 ml sbg 3 Karton", () => {
    const byName = indexMasterByName([
      ing({ id: "ing-5", name: "Susu Omela", unit: "ml" }), // tanpa pack Karton
    ]);
    const r = matchManualItemToMaster(
      { name: "Susu Omela", unit: "Karton", qty: 3 },
      byName,
      deps,
    );
    expect(r).toBeNull();
  });

  it("BATAL menaut kalau nama master duplikat (ambigu)", () => {
    const byName = indexMasterByName([
      ing({ id: "a", name: "Oreo", unit: "Pcs" }),
      ing({ id: "b", name: "oreo", unit: "Pack" }),
    ]);
    expect(
      matchManualItemToMaster({ name: "Oreo", unit: "Pcs", qty: 1 }, byName, deps),
    ).toBeNull();
  });

  it("BATAL menaut kalau nama tidak ada di master", () => {
    const byName = indexMasterByName([ing({})]);
    expect(
      matchManualItemToMaster(
        { name: "Saus Mclewis", unit: "Pcs", qty: 2 },
        byName,
        deps,
      ),
    ).toBeNull();
  });

  it("BATAL menaut kalau nama kosong", () => {
    const byName = indexMasterByName([ing({})]);
    expect(
      matchManualItemToMaster({ name: "   ", unit: "Pcs", qty: 1 }, byName, deps),
    ).toBeNull();
  });

  it("tetap menaut saat satuan staff kosong — pakai satuan master apa adanya", () => {
    const byName = indexMasterByName([ing({})]);
    const r = matchManualItemToMaster(
      { name: "Regal", unit: "", qty: 5 },
      byName,
      deps,
    );
    expect(r?.qtyMaster).toBe(5);
  });
});
