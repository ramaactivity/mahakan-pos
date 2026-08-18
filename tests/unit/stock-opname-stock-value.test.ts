import { describe, expect, it } from "vitest";
import {
  computeStockValue,
  persediaanAccountForSection,
  type StockValueLineLike,
} from "@/features/stock-opname/stock-value";

function line(p: Partial<StockValueLineLike> = {}): StockValueLineLike {
  return {
    actualQty: 10,
    actualQtyDecimal: null,
    unitCostAtSnapshot: 1000,
    section: "kitchen",
    ...p,
  };
}

describe("computeStockValue", () => {
  it("menjumlah qty aktual × harga beku", () => {
    const s = computeStockValue([
      line({ actualQty: 10, unitCostAtSnapshot: 1000 }),
      line({ actualQty: 3, unitCostAtSnapshot: 2500, section: "bar" }),
    ]);
    expect(s.total).toBe(17500);
    expect(s.countedLines).toBe(2);
    expect(s.uncountedLines).toBe(0);
  });

  it("memakai decimal mirror, bukan bigint yang di-clamp", () => {
    const s = computeStockValue([
      line({ actualQty: 2, actualQtyDecimal: "2.5000", unitCostAtSnapshot: 200 }),
    ]);
    expect(s.total).toBe(500);
  });

  it("jatuh balik ke bigint kalau decimal korup", () => {
    const s = computeStockValue([
      line({ actualQty: 4, actualQtyDecimal: "abc", unitCostAtSnapshot: 100 }),
    ]);
    expect(s.total).toBe(400);
  });

  it("melewati baris belum dihitung, bukan menganggapnya nol", () => {
    const s = computeStockValue([
      line({ actualQty: 10, unitCostAtSnapshot: 100 }),
      line({ actualQty: null, actualQtyDecimal: null }),
    ]);
    expect(s.total).toBe(1000);
    expect(s.countedLines).toBe(1);
    expect(s.uncountedLines).toBe(1);
  });

  it("memetakan section ke akun persediaan sama seperti jurnal opname", () => {
    expect(persediaanAccountForSection("kitchen")).toBe("1140");
    expect(persediaanAccountForSection("bar")).toBe("1141");
    expect(persediaanAccountForSection("supporting")).toBe("1142");
    expect(persediaanAccountForSection("cleaning")).toBe("1142");
    expect(persediaanAccountForSection(null)).toBe("1142");
  });

  it("mengelompokkan supporting + cleaning + tanpa section ke 1142", () => {
    const s = computeStockValue([
      line({ section: "kitchen", actualQty: 1, unitCostAtSnapshot: 100 }),
      line({ section: "bar", actualQty: 1, unitCostAtSnapshot: 200 }),
      line({ section: "supporting", actualQty: 1, unitCostAtSnapshot: 300 }),
      line({ section: "cleaning", actualQty: 1, unitCostAtSnapshot: 400 }),
      line({ section: null, actualQty: 1, unitCostAtSnapshot: 500 }),
    ]);
    const by = Object.fromEntries(
      s.buckets.map((b) => [b.accountCode, b.value]),
    );
    expect(by["1140"]).toBe(100);
    expect(by["1141"]).toBe(200);
    expect(by["1142"]).toBe(1200);
    expect(s.total).toBe(1500);
  });

  it("selalu mengembalikan tiga bucket walau kosong", () => {
    const s = computeStockValue([]);
    expect(s.buckets.map((b) => b.accountCode)).toEqual([
      "1140",
      "1141",
      "1142",
    ]);
    expect(s.total).toBe(0);
  });

  it("menandai baris berstok yang harganya Rp 0", () => {
    const s = computeStockValue([
      line({ actualQty: 5, unitCostAtSnapshot: 0 }),
      line({ actualQty: 0, unitCostAtSnapshot: 0 }),
    ]);
    expect(s.zeroCostLines).toBe(1);
    expect(s.total).toBe(0);
  });

  it("tidak membiarkan harga korup mencemari total", () => {
    const s = computeStockValue([
      line({ actualQty: 2, unitCostAtSnapshot: Number.NaN }),
      line({ actualQty: 2, unitCostAtSnapshot: 1000 }),
    ]);
    expect(s.total).toBe(2000);
  });
});
