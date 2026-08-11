import { describe, expect, it } from "vitest";
import { countInputWarning } from "@/features/stock-opname/count-input-warning";

describe("countInputWarning", () => {
  it("menandai titik ribuan — kasus Powder Red Velvet 30 Juni 2026", () => {
    const w = countInputWarning({
      raw: "1.381",
      totalQty: 1.381,
      recipeUnit: "gr",
    });
    expect(w).toContain("1.381");
    expect(w).toContain("tanpa titik");
  });

  it("menandai titik ribuan walau ada koma desimal di belakang", () => {
    expect(
      countInputWarning({ raw: "1.337,8", totalQty: 1.3378, recipeUnit: "gr" }),
    ).toContain("1.337,8");
  });

  it("menandai pecahan kecil di satuan halus — kasus Garnish 0,293 gr", () => {
    const w = countInputWarning({
      raw: "0,293",
      totalQty: 0.293,
      recipeUnit: "gr",
    });
    expect(w).toContain("ganti satuan");
  });

  it("menandai pecahan kecil pada ml — kasus Butterscoth 0,9868", () => {
    expect(
      countInputWarning({ raw: "0,9868", totalQty: 0.9868, recipeUnit: "ml" }),
    ).not.toBeNull();
  });

  it("diam untuk hitungan wajar", () => {
    expect(
      countInputWarning({ raw: "1381", totalQty: 1381, recipeUnit: "gr" }),
    ).toBeNull();
    expect(
      countInputWarning({ raw: "750", totalQty: 750, recipeUnit: "ml" }),
    ).toBeNull();
  });

  it("diam untuk pecahan wajar di satuan besar (1,5 Kg)", () => {
    expect(
      countInputWarning({ raw: "1,5", totalQty: 1.5, recipeUnit: "Kg" }),
    ).toBeNull();
  });

  it("diam untuk bilangan bulat kecil (4 Pcs) dan nol", () => {
    expect(
      countInputWarning({ raw: "4", totalQty: 4, recipeUnit: "Pcs" }),
    ).toBeNull();
    expect(
      countInputWarning({ raw: "0", totalQty: 0, recipeUnit: "gr" }),
    ).toBeNull();
  });

  it("diam saat kolom masih kosong", () => {
    expect(
      countInputWarning({ raw: "  ", totalQty: null, recipeUnit: "gr" }),
    ).toBeNull();
  });

  it("tidak menandai desimal biasa yang bukan pola ribuan", () => {
    expect(
      countInputWarning({ raw: "12.5", totalQty: 12.5, recipeUnit: "gr" }),
    ).toBeNull();
  });
});
