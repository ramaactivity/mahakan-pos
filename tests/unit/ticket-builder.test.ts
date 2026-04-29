import { describe, expect, it } from "vitest";
import {
  buildPrepTicket,
  filterItemsForStation,
  type PrepTicketData,
  type PrepTicketItem,
} from "@/lib/printer/ticket-builder";
import {
  categoryToStation,
  knownCategories,
} from "@/lib/printer/station-mapping";

function item(over: Partial<PrepTicketItem>): PrepTicketItem {
  return {
    name: over.name ?? "X",
    variant: over.variant ?? null,
    quantity: over.quantity ?? 1,
    note: over.note ?? null,
    openPriceNote: over.openPriceNote ?? null,
    modifiers: over.modifiers ?? [],
    categoryName: over.categoryName ?? "Coffee Based",
  };
}

function data(items: PrepTicketItem[]): PrepTicketData {
  return {
    transactionNumber: "TRX-001",
    pagerNumber: 7,
    orderType: "dine_in",
    createdAt: new Date("2026-04-28T10:00:00+07:00"),
    cashierName: "Rama",
    items,
  };
}

describe("station-mapping", () => {
  it("maps food categories to kitchen", () => {
    expect(categoryToStation("Ricebowl")).toBe("kitchen");
    expect(categoryToStation("Bakmie")).toBe("kitchen");
    expect(categoryToStation("Sweets")).toBe("kitchen");
    expect(categoryToStation("Bites")).toBe("kitchen");
  });

  it("maps drink categories to bar", () => {
    expect(categoryToStation("Coffee Based")).toBe("bar");
    expect(categoryToStation("Non-Coffee")).toBe("bar");
    expect(categoryToStation("Tea Based")).toBe("bar");
    expect(categoryToStation("Frappe")).toBe("bar");
    expect(categoryToStation("Mocktail")).toBe("bar");
    expect(categoryToStation("Manual Brew")).toBe("bar");
    expect(categoryToStation("Ice Cream")).toBe("bar");
  });

  it("returns null for unknown category", () => {
    expect(categoryToStation("Pastry")).toBeNull();
    expect(categoryToStation("")).toBeNull();
  });

  it("trims whitespace before lookup", () => {
    expect(categoryToStation("  Coffee Based  ")).toBe("bar");
  });

  it("knownCategories covers all 11 seeded categories", () => {
    expect(knownCategories()).toHaveLength(11);
  });
});

describe("filterItemsForStation", () => {
  it("returns only kitchen items for kitchen station", () => {
    const items = [
      item({ name: "Iced Americano", categoryName: "Coffee Based" }),
      item({ name: "Ayam Sambal Matah", categoryName: "Ricebowl" }),
      item({ name: "Croffle", categoryName: "Sweets" }),
    ];
    const kitchen = filterItemsForStation(items, "kitchen");
    expect(kitchen.map((i) => i.name)).toEqual(["Ayam Sambal Matah", "Croffle"]);
  });

  it("returns only bar items for bar station", () => {
    const items = [
      item({ name: "Iced Americano", categoryName: "Coffee Based" }),
      item({ name: "Ayam Sambal Matah", categoryName: "Ricebowl" }),
      item({ name: "Mocktail-X", categoryName: "Mocktail" }),
    ];
    const bar = filterItemsForStation(items, "bar");
    expect(bar.map((i) => i.name)).toEqual(["Iced Americano", "Mocktail-X"]);
  });

  it("returns empty when no items match station", () => {
    const items = [item({ categoryName: "Coffee Based" })];
    expect(filterItemsForStation(items, "kitchen")).toEqual([]);
  });

  it("excludes items with unknown category from both stations", () => {
    const items = [
      item({ name: "Mystery", categoryName: "Pastry" }),
      item({ name: "Coffee", categoryName: "Coffee Based" }),
    ];
    expect(filterItemsForStation(items, "kitchen").map((i) => i.name)).toEqual([]);
    expect(filterItemsForStation(items, "bar").map((i) => i.name)).toEqual(["Coffee"]);
  });
});

describe("buildPrepTicket", () => {
  it("returns null when no items match the station", () => {
    const d = data([item({ categoryName: "Coffee Based" })]);
    expect(buildPrepTicket(d, "kitchen")).toBeNull();
  });

  it("returns Uint8Array when matching items exist", () => {
    const d = data([item({ name: "Ayam", categoryName: "Ricebowl" })]);
    const bytes = buildPrepTicket(d, "kitchen");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect((bytes as Uint8Array).length).toBeGreaterThan(0);
  });

  it("kitchen ticket only contains kitchen items even when bar items present", () => {
    const d = data([
      item({ name: "Iced Americano", categoryName: "Coffee Based" }),
      item({ name: "Ayam Sambal Matah", categoryName: "Ricebowl" }),
    ]);
    const kitchenBytes = buildPrepTicket(d, "kitchen") as Uint8Array;
    const decoded = new TextDecoder("utf-8").decode(kitchenBytes);
    expect(decoded).toContain("TIKET DAPUR");
    expect(decoded).toContain("Ayam Sambal Matah");
    expect(decoded).not.toContain("Iced Americano");
  });

  it("bar ticket includes pager and cashier meta", () => {
    const d = data([item({ name: "Iced Americano", categoryName: "Coffee Based" })]);
    const decoded = new TextDecoder("utf-8").decode(buildPrepTicket(d, "bar")!);
    expect(decoded).toContain("TIKET BAR");
    expect(decoded).toContain("Pager 7");
    expect(decoded).toContain("Dine-in");
    expect(decoded).toContain("Rama");
    expect(decoded).toContain("TRX-001");
  });

  it("does NOT print prices on prep ticket", () => {
    const d = data([item({ name: "Iced Americano", categoryName: "Coffee Based" })]);
    const decoded = new TextDecoder("utf-8").decode(buildPrepTicket(d, "bar")!);
    // No rupiah formatting markers — prep tickets are price-free.
    expect(decoded).not.toContain("Rp ");
    expect(decoded).not.toContain("Subtotal");
    expect(decoded).not.toContain("TOTAL");
  });

  it("includes variant + modifiers + note in item line", () => {
    const d = data([
      item({
        name: "Latte",
        variant: "iced",
        quantity: 2,
        modifiers: [{ modifierSlug: "sugar_level", selectedValue: "less" }],
        note: "extra es",
      }),
    ]);
    const decoded = new TextDecoder("utf-8").decode(buildPrepTicket(d, "bar")!);
    expect(decoded).toContain("2x Latte (Iced)");
    expect(decoded).toContain("less");
    expect(decoded).toContain("catatan: extra es");
  });

  it("renders takeaway label correctly", () => {
    const d: PrepTicketData = {
      ...data([item({ categoryName: "Ricebowl" })]),
      orderType: "takeaway",
    };
    const decoded = new TextDecoder("utf-8").decode(buildPrepTicket(d, "kitchen")!);
    expect(decoded).toContain("Takeaway");
  });

  it("includes total item count footer", () => {
    const d = data([
      item({ categoryName: "Ricebowl", quantity: 1 }),
      item({ categoryName: "Bakmie", quantity: 1 }),
      item({ categoryName: "Coffee Based", quantity: 1 }),
    ]);
    const decoded = new TextDecoder("utf-8").decode(buildPrepTicket(d, "kitchen")!);
    expect(decoded).toContain("Total 2 item");
  });

  it("renders customer name beneath pager when provided", () => {
    const d: PrepTicketData = {
      ...data([item({ name: "Ayam", categoryName: "Ricebowl" })]),
      customerName: "Pak Andi",
    };
    const decoded = new TextDecoder("utf-8").decode(
      buildPrepTicket(d, "kitchen")!,
    );
    expect(decoded).toContain("Pak Andi");
  });

  it("omits customer name line when null/undefined/empty on prep ticket", () => {
    const d = data([item({ name: "Ayam", categoryName: "Ricebowl" })]);
    const decoded = new TextDecoder("utf-8").decode(
      buildPrepTicket(d, "kitchen")!,
    );
    // baseline data() does not set customerName; ensure no leftover label sneaks in.
    expect(decoded).not.toMatch(/Pak/);
  });
});
