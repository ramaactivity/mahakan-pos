import { describe, expect, it } from "vitest";
import {
  diffIngredient,
  diffPreparation,
  findDuplicateMenuRecipeLines,
  findDuplicateNames,
  findDuplicatePrepLines,
  menuRecipeKey,
  normalizeIngredientRow,
  normalizeMenuRecipeLineRow,
  normalizeMenuRecipeRow,
  normalizePrepLineRow,
  normalizePreparationRow,
  topologicalSortPreps,
  type ParsedIngredientRow,
  type ParsedMenuRecipeLineRow,
  type ParsedPrepLineRow,
} from "@/features/inventory/import-engine-pure";

describe("normalizeIngredientRow", () => {
  it("parses a clean row", () => {
    const r = normalizeIngredientRow(
      {
        name: "Ayam Fillet",
        unit: "gr",
        cost_per_unit: "57000",
        initial_stock: "0",
        reorder_threshold: "",
        notes: "",
      },
      2,
    );
    expect(r.errors).toEqual([]);
    expect(r.row).toEqual({
      name: "Ayam Fillet",
      unit: "gr",
      costPerUnit: 57000,
      initialStock: 0,
      reorderThreshold: null,
      notes: null,
    });
  });

  it("accepts Rp-prefixed cost (forward-compat with old spreadsheet paste)", () => {
    const r = normalizeIngredientRow(
      {
        name: "Ayam",
        unit: "gr",
        cost_per_unit: "Rp 57.000",
        initial_stock: "1.000",
        reorder_threshold: "",
        notes: "",
      },
      2,
    );
    expect(r.errors).toEqual([]);
    expect(r.row?.costPerUnit).toBe(57000);
    expect(r.row?.initialStock).toBe(1000);
  });

  it("skips empty row", () => {
    const r = normalizeIngredientRow(
      { name: "", unit: "", cost_per_unit: "", initial_stock: "", reorder_threshold: "", notes: "" },
      2,
    );
    expect(r.skipped).toBe("empty");
  });

  it("skips EXAMPLE_DELETE_ME row", () => {
    const r = normalizeIngredientRow(
      {
        name: "EXAMPLE_DELETE_ME",
        unit: "gr",
        cost_per_unit: "1000",
        initial_stock: "0",
        reorder_threshold: "",
        notes: "",
      },
      2,
    );
    expect(r.skipped).toBe("example");
  });

  it("errors on missing name", () => {
    const r = normalizeIngredientRow(
      { name: "", unit: "gr", cost_per_unit: "100", initial_stock: "0", reorder_threshold: "", notes: "" },
      2,
    );
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].field).toBe("name");
  });

  it("errors on negative cost", () => {
    const r = normalizeIngredientRow(
      {
        name: "X",
        unit: "gr",
        cost_per_unit: "-5",
        initial_stock: "0",
        reorder_threshold: "",
        notes: "",
      },
      2,
    );
    expect(r.errors.some((e) => e.field === "cost_per_unit")).toBe(true);
  });
});

describe("normalizePreparationRow", () => {
  it("parses clean prep row", () => {
    const r = normalizePreparationRow(
      { name: "Prep - Espresso HB", unit: "ml", yield: "45", waste_factor_pct: "10", notes: "" },
      2,
    );
    expect(r.errors).toEqual([]);
    expect(r.row).toEqual({
      name: "Prep - Espresso HB",
      unit: "ml",
      yield: 45,
      wasteFactorPct: 10,
      notes: null,
    });
  });

  it("errors on yield = 0", () => {
    const r = normalizePreparationRow(
      { name: "X", unit: "ml", yield: "0", waste_factor_pct: "10", notes: "" },
      2,
    );
    expect(r.errors.some((e) => e.field === "yield")).toBe(true);
  });

  it("errors on waste > 200", () => {
    const r = normalizePreparationRow(
      { name: "X", unit: "ml", yield: "45", waste_factor_pct: "201", notes: "" },
      2,
    );
    expect(r.errors.some((e) => e.field === "waste_factor_pct")).toBe(true);
  });
});

describe("normalizePrepLineRow", () => {
  it("parses clean line", () => {
    const r = normalizePrepLineRow(
      { prep_name: "Prep - Espresso HB", ingredient_name: "Beans", qty: "16" },
      2,
    );
    expect(r.errors).toEqual([]);
    expect(r.row).toEqual({ prepName: "Prep - Espresso HB", ingredientName: "Beans", qty: 16 });
  });

  it("errors on qty = 0", () => {
    const r = normalizePrepLineRow(
      { prep_name: "P", ingredient_name: "I", qty: "0" },
      2,
    );
    expect(r.errors.some((e) => e.field === "qty")).toBe(true);
  });
});

describe("normalizeMenuRecipeRow", () => {
  it("normalizes variant case", () => {
    expect(
      normalizeMenuRecipeRow(
        { menu_name: "Iced Americano", variant: "ICED", waste_factor_pct: "30", notes: "" },
        2,
      ).row?.variant,
    ).toBe("iced");
    expect(
      normalizeMenuRecipeRow(
        { menu_name: "Hot Americano", variant: "Hot", waste_factor_pct: "30", notes: "" },
        2,
      ).row?.variant,
    ).toBe("hot");
  });

  it("treats empty variant as null (fixed-price)", () => {
    expect(
      normalizeMenuRecipeRow(
        { menu_name: "French Fries", variant: "", waste_factor_pct: "30", notes: "" },
        2,
      ).row?.variant,
    ).toBeNull();
  });

  it("errors on invalid variant", () => {
    const r = normalizeMenuRecipeRow(
      { menu_name: "X", variant: "lukewarm", waste_factor_pct: "30", notes: "" },
      2,
    );
    expect(r.errors.some((e) => e.field === "variant")).toBe(true);
  });
});

describe("normalizeMenuRecipeLineRow", () => {
  it("parses clean line with variant", () => {
    const r = normalizeMenuRecipeLineRow(
      { menu_name: "Iced Americano", variant: "iced", ingredient_name: "Espresso HB", qty: "35" },
      2,
    );
    expect(r.errors).toEqual([]);
    expect(r.row).toEqual({
      menuName: "Iced Americano",
      variant: "iced",
      ingredientName: "Espresso HB",
      qty: 35,
    });
  });
});

describe("diffIngredient", () => {
  const parsed: ParsedIngredientRow = {
    name: "X",
    unit: "gr",
    costPerUnit: 100,
    initialStock: 0,
    reorderThreshold: null,
    notes: null,
  };

  it("returns NEW when no existing", () => {
    const d = diffIngredient(null, parsed);
    expect(d.action).toBe("NEW");
    expect(d.costChanged).toBe(false);
  });

  it("returns SKIP when no diff", () => {
    const d = diffIngredient(
      { costPerUnit: 100, unit: "gr", reorderThreshold: null, notes: null },
      parsed,
    );
    expect(d.action).toBe("SKIP");
  });

  it("returns UPDATE with costChanged when cost differs", () => {
    const d = diffIngredient(
      { costPerUnit: 90, unit: "gr", reorderThreshold: null, notes: null },
      parsed,
    );
    expect(d.action).toBe("UPDATE");
    expect(d.costChanged).toBe(true);
    expect(d.changedFields).toEqual(["cost_per_unit"]);
  });

  it("UPDATE with notes-only change does not flag costChanged", () => {
    const d = diffIngredient(
      { costPerUnit: 100, unit: "gr", reorderThreshold: null, notes: "old" },
      { ...parsed, notes: "new" },
    );
    expect(d.action).toBe("UPDATE");
    expect(d.costChanged).toBe(false);
    expect(d.changedFields).toEqual(["notes"]);
  });
});

describe("diffPreparation", () => {
  it("flags yieldChanged on yield diff", () => {
    const d = diffPreparation(
      { unit: "ml", yield: 45, notes: null },
      { name: "X", unit: "ml", yield: 50, wasteFactorPct: 10, notes: null },
    );
    expect(d.yieldChanged).toBe(true);
  });
});

describe("findDuplicateNames", () => {
  it("flags duplicate (case-insensitive)", () => {
    const errs = findDuplicateNames([
      { row: 2, data: { name: "Ayam" } },
      { row: 5, data: { name: "AYAM" } },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].row).toBe(5);
    expect(errs[0].message).toMatch(/baris 2/);
  });

  it("no duplicate when names unique", () => {
    expect(
      findDuplicateNames([
        { row: 2, data: { name: "A" } },
        { row: 3, data: { name: "B" } },
      ]),
    ).toEqual([]);
  });
});

describe("findDuplicatePrepLines", () => {
  it("flags duplicate (prep, ingredient)", () => {
    const rows: Array<{ row: number; data: ParsedPrepLineRow }> = [
      { row: 2, data: { prepName: "Prep-A", ingredientName: "Sugar", qty: 10 } },
      { row: 5, data: { prepName: "Prep-A", ingredientName: "sugar", qty: 5 } },
    ];
    const errs = findDuplicatePrepLines(rows);
    expect(errs).toHaveLength(1);
    expect(errs[0].row).toBe(5);
  });

  it("allows same ingredient in different preps", () => {
    const rows: Array<{ row: number; data: ParsedPrepLineRow }> = [
      { row: 2, data: { prepName: "Prep-A", ingredientName: "Sugar", qty: 10 } },
      { row: 5, data: { prepName: "Prep-B", ingredientName: "Sugar", qty: 5 } },
    ];
    expect(findDuplicatePrepLines(rows)).toEqual([]);
  });
});

describe("findDuplicateMenuRecipeLines", () => {
  it("flags duplicate (menu, variant, ingredient)", () => {
    const rows: Array<{ row: number; data: ParsedMenuRecipeLineRow }> = [
      { row: 2, data: { menuName: "Iced Americano", variant: "iced", ingredientName: "Espresso", qty: 35 } },
      { row: 5, data: { menuName: "Iced Americano", variant: "iced", ingredientName: "ESPRESSO", qty: 30 } },
    ];
    const errs = findDuplicateMenuRecipeLines(rows);
    expect(errs).toHaveLength(1);
  });

  it("allows same ingredient across variants", () => {
    const rows: Array<{ row: number; data: ParsedMenuRecipeLineRow }> = [
      { row: 2, data: { menuName: "Americano", variant: "iced", ingredientName: "Espresso", qty: 35 } },
      { row: 3, data: { menuName: "Americano", variant: "hot", ingredientName: "Espresso", qty: 30 } },
    ];
    expect(findDuplicateMenuRecipeLines(rows)).toEqual([]);
  });
});

describe("topologicalSortPreps", () => {
  it("returns simple order when no deps", () => {
    const order = topologicalSortPreps(["A", "B", "C"], new Map());
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["A", "B", "C"]));
  });

  it("orders chain B -> A -> X (X atomic, ignored)", () => {
    const deps = new Map<string, string[]>([
      ["A", ["X"]], // X is atomic, not in prepNames
      ["B", ["A"]],
    ]);
    const order = topologicalSortPreps(["A", "B"], deps);
    expect(order).toEqual(["A", "B"]);
  });

  it("orders diamond P -> A,B -> X correctly", () => {
    const deps = new Map<string, string[]>([
      ["P", ["A", "B"]],
      ["A", ["X"]],
      ["B", ["X"]],
    ]);
    const order = topologicalSortPreps(["P", "A", "B"], deps);
    // P must be after A and B; A and B can be in either order.
    expect(order.indexOf("P")).toBeGreaterThan(order.indexOf("A"));
    expect(order.indexOf("P")).toBeGreaterThan(order.indexOf("B"));
  });

  it("throws on cycle", () => {
    const deps = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["A"]],
    ]);
    expect(() => topologicalSortPreps(["A", "B"], deps)).toThrow(/CYCLE_IN_PREP_GRAPH/);
  });
});

describe("menuRecipeKey", () => {
  it("normalizes case and whitespace", () => {
    expect(menuRecipeKey("Iced Americano", "iced")).toBe("iced americano|iced");
    expect(menuRecipeKey(" ICED AMERICANO ", "iced")).toBe("iced americano|iced");
  });

  it("represents null variant as empty string", () => {
    expect(menuRecipeKey("French Fries", null)).toBe("french fries|");
  });
});
