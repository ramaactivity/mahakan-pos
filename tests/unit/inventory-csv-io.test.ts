import { describe, expect, it } from "vitest";
import {
  computeDiff,
  parseIngredientsCsv,
  serializeIngredientsCsv,
  type ExistingIngredientLite,
  type IngredientForExport,
} from "@/features/inventory/csv-io";

const SAMPLE: IngredientForExport[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Susu Full Cream",
    section: "bar",
    unit: "ml",
    unitBelanja: "L",
    unitBelanjaPerCogs: "1000",
    costPerUnit: 4500,
    currentStockDecimal: "15000.0000",
    reorderThreshold: 5000,
    notes: "Indomilk 1L",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Beans Houseblend",
    section: "bar",
    unit: "g",
    unitBelanja: "kg",
    unitBelanjaPerCogs: "1000",
    costPerUnit: 200,
    currentStockDecimal: "731.5000",
    reorderThreshold: 2000,
    notes: null,
  },
];

describe("serializeIngredientsCsv", () => {
  it("generates CSV with UTF-8 BOM + comment header + data row", () => {
    const csv = serializeIngredientsCsv(SAMPLE, {
      generatedAt: new Date("2026-05-22T12:00:00Z"),
      outletName: "Mahakan",
    });
    // BOM
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // Comment line
    expect(csv).toContain("# Generated 2026-05-22");
    // Data header (Sesi AE-136 — split unit ke recipe + purchase + ratio)
    expect(csv).toContain(
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit",
    );
    // Data rows
    expect(csv).toContain("Susu Full Cream");
    expect(csv).toContain("Beans Houseblend");
    // Sorted: Beans (bar/B) before Susu (bar/S)
    const beansIdx = csv.indexOf("Beans Houseblend");
    const susuIdx = csv.indexOf("Susu Full Cream");
    expect(beansIdx).toBeLessThan(susuIdx);
  });

  it("escapes commas and quotes in names/notes", () => {
    const csv = serializeIngredientsCsv(
      [
        {
          ...SAMPLE[0],
          name: 'Susu, "Premium"',
          notes: "line1\nline2",
        },
      ],
      { generatedAt: new Date(), outletName: "X" },
    );
    expect(csv).toContain('"Susu, ""Premium"""');
    expect(csv).toContain('"line1\nline2"');
  });
});

describe("parseIngredientsCsv", () => {
  it("parses valid CSV correctly (legacy 'unit' column)", () => {
    const csv =
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ",Susu Test,bar,ml,4500,0,5000,Tes brand\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].parsed).toEqual({
      id: null,
      name: "Susu Test",
      section: "bar",
      recipeUnit: "ml",
      purchaseUnit: null,
      purchasePerRecipe: null,
      costPerUnit: 4500,
      currentStock: 0,
      threshold: 5000,
      notes: "Tes brand",
    });
  });

  it("parses new CSV with recipe_unit + purchase_unit + purchase_per_recipe", () => {
    const csv =
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit,current_stock,threshold,notes\n" +
      ",Susu Test,bar,L,ml,1000,4500,0,5000,Tes brand\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed).toEqual({
      id: null,
      name: "Susu Test",
      section: "bar",
      recipeUnit: "ml",
      purchaseUnit: "L",
      purchasePerRecipe: 1000,
      costPerUnit: 4500,
      currentStock: 0,
      threshold: 5000,
      notes: "Tes brand",
    });
  });

  it("auto-infers ratio for common pairs kg→g (1000) when ratio kosong", () => {
    const csv =
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit,current_stock,threshold,notes\n" +
      ",Beans,bar,kg,g,,200,0,2000,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.purchasePerRecipe).toBe(1000);
  });

  it("auto-infers ratio L→ml (1000)", () => {
    const csv =
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit,current_stock,threshold,notes\n" +
      ",Sirup,bar,L,ml,,150,0,500,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.purchasePerRecipe).toBe(1000);
  });

  it("identity 1:1 when purchase == recipe", () => {
    const csv =
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit,current_stock,threshold,notes\n" +
      ",Telur,kitchen,pcs,pcs,,3000,0,30,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.purchasePerRecipe).toBe(1);
  });

  it("flags missing ratio for non-default pair", () => {
    const csv =
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit,current_stock,threshold,notes\n" +
      ",Dimsum,kitchen,pack,pcs,,2500,0,20,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors[0].field).toBe("purchase_per_recipe");
  });

  it("explicit ratio with Indonesian decimal (koma)", () => {
    const csv =
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit,current_stock,threshold,notes\n" +
      ",Bubuk,kitchen,pack,g,250,180,0,10,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.purchasePerRecipe).toBe(250);
  });

  it("flags ratio without purchase_unit", () => {
    const csv =
      "id,name,section,purchase_unit,recipe_unit,purchase_per_recipe,cost_per_unit,current_stock,threshold,notes\n" +
      ",Bad,kitchen,,g,1000,180,0,10,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors[0].field).toBe("purchase_per_recipe");
  });

  it("case-insensitive header normalization", () => {
    const csv =
      "ID,Name,Section,Purchase Unit,Recipe Unit,Purchase Per Recipe,Cost Per Unit,Current Stock,Threshold,Notes\n" +
      ",Beans,bar,kg,g,1000,200,0,2000,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.purchaseUnit).toBe("kg");
    expect(result.rows[0].parsed?.recipeUnit).toBe("g");
    expect(result.rows[0].parsed?.purchasePerRecipe).toBe(1000);
  });

  it("ignores comment lines (#)", () => {
    const csv =
      "# Generated 2026-05-22\n" +
      "# safety notice\n" +
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ",Beans,bar,g,200,0,2000,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows).toHaveLength(1);
  });

  it("handles UTF-8 BOM", () => {
    const csv =
      "﻿id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ",Test,bar,g,100,0,,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.name).toBe("Test");
  });

  it("flags missing required name", () => {
    const csv =
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ",,bar,g,100,0,,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors[0].field).toBe("name");
  });

  it("flags invalid section enum", () => {
    const csv =
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ",Test,kicthen,g,100,0,,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors[0].field).toBe("section");
  });

  it("flags non-integer cost", () => {
    const csv =
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ",Test,bar,g,100.5,0,,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors[0].field).toBe("cost_per_unit");
  });

  it("flags invalid UUID format for id", () => {
    const csv =
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      "not-a-uuid,Test,bar,g,100,0,,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors[0].field).toBe("id");
  });

  it("accepts empty section (null)", () => {
    const csv =
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ",Test,,g,100,0,,\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.section).toBeNull();
  });

  it("accepts quoted values with commas + escaped quotes", () => {
    const csv =
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
      ',"Susu, Premium",bar,ml,4500,0,,"He said ""hi"""\n';
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].parsed?.name).toBe("Susu, Premium");
    expect(result.rows[0].parsed?.notes).toBe('He said "hi"');
  });

  it("flags header missing required column", () => {
    const csv = "id,name\n,Test\n";
    const result = parseIngredientsCsv(csv);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors[0].field).toBe("header");
  });
});

describe("computeDiff", () => {
  const existing: ExistingIngredientLite[] = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Susu Full Cream",
      section: "bar",
      unit: "ml",
      unitBelanja: null,
      unitBelanjaPerCogs: null,
      costPerUnit: 4500,
      reorderThreshold: 5000,
      notes: "Indomilk 1L",
    },
  ];

  it("flags new row (no id) as CREATE", () => {
    const parsed = parseIngredientsCsv(
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
        ",New Bahan,bar,g,200,0,,\n",
    );
    const diff = computeDiff(parsed, existing);
    expect(diff.summary.create).toBe(1);
    expect(diff.summary.update).toBe(0);
    expect(diff.rows[0].action).toBe("create");
  });

  it("flags matching id with cost change as UPDATE", () => {
    const parsed = parseIngredientsCsv(
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
        "11111111-1111-1111-1111-111111111111,Susu Full Cream,bar,ml,5000,0,5000,Indomilk 1L\n",
    );
    const diff = computeDiff(parsed, existing);
    expect(diff.summary.update).toBe(1);
    expect(diff.rows[0].action).toBe("update");
    expect(diff.rows[0].changedFields).toContain("cost_per_unit");
  });

  it("flags identical row as UNCHANGED", () => {
    const parsed = parseIngredientsCsv(
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
        "11111111-1111-1111-1111-111111111111,Susu Full Cream,bar,ml,4500,0,5000,Indomilk 1L\n",
    );
    const diff = computeDiff(parsed, existing);
    expect(diff.summary.unchanged).toBe(1);
    expect(diff.rows[0].action).toBe("unchanged");
  });

  it("flags id not in DB as ERROR", () => {
    const parsed = parseIngredientsCsv(
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
        "99999999-9999-9999-9999-999999999999,Ghost,bar,g,100,0,,\n",
    );
    const diff = computeDiff(parsed, existing);
    expect(diff.summary.error).toBe(1);
    expect(diff.rows[0].action).toBe("error");
    expect(diff.rows[0].errors[0].field).toBe("id");
  });

  it("ignores current_stock field changes (read-only)", () => {
    // Existing has stock 15000; CSV says 99999 — both should be UNCHANGED
    const parsed = parseIngredientsCsv(
      "id,name,section,unit,cost_per_unit,current_stock,threshold,notes\n" +
        "11111111-1111-1111-1111-111111111111,Susu Full Cream,bar,ml,4500,99999,5000,Indomilk 1L\n",
    );
    const diff = computeDiff(parsed, existing);
    // current_stock not in checked fields
    expect(diff.summary.unchanged).toBe(1);
  });
});

describe("roundtrip export → parse", () => {
  it("export then parse produces 0 errors + 0 changes", () => {
    const csv = serializeIngredientsCsv(SAMPLE, {
      generatedAt: new Date(),
      outletName: "Mahakan",
    });
    const parsed = parseIngredientsCsv(csv);
    expect(parsed.errorCount).toBe(0);
    expect(parsed.rows).toHaveLength(SAMPLE.length);

    const existing: ExistingIngredientLite[] = SAMPLE.map((s) => ({
      id: s.id,
      name: s.name,
      section: s.section,
      unit: s.unit,
      unitBelanja: s.unitBelanja,
      unitBelanjaPerCogs: s.unitBelanjaPerCogs,
      costPerUnit: s.costPerUnit,
      reorderThreshold: s.reorderThreshold,
      notes: s.notes,
    }));
    const diff = computeDiff(parsed, existing);
    // Roundtrip: all rows should be UNCHANGED
    expect(diff.summary.unchanged).toBe(SAMPLE.length);
    expect(diff.summary.create).toBe(0);
    expect(diff.summary.update).toBe(0);
    expect(diff.summary.error).toBe(0);
  });
});
