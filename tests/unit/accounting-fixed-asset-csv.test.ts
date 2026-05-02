import { describe, it, expect } from "vitest";
import {
  fixedAssetCsvTemplate,
  parseFixedAssetCsv,
} from "@/features/admin/sections/accounting/fixed-asset-csv";

describe("parseFixedAssetCsv", () => {
  const VALID_CSV = `nama,kategori,cost,salvage_value,useful_life_months,acquired_date,asset_account_code,depreciation_account_code,capitalize,payment_method,notes
Mesin Espresso,Peralatan Bar,50000000,5000000,96,2026-04-15,1203,6503,true,transfer_bca,Serial XYZ
Furniture Meja,Furniture,1500000,0,60,2026-05-01,1201,6501,false,,Note kosong`;

  it("parses valid CSV correctly", () => {
    const r = parseFixedAssetCsv(VALID_CSV);
    expect(r.errors).toEqual([]);
    expect(r.rows.length).toBe(2);
    expect(r.totalParsed).toBe(2);
    expect(r.rows[0].name).toBe("Mesin Espresso");
    expect(r.rows[0].cost).toBe(50_000_000);
    expect(r.rows[0].salvageValue).toBe(5_000_000);
    expect(r.rows[0].usefulLifeMonths).toBe(96);
    expect(r.rows[0].assetAccountCode).toBe("1203");
    expect(r.rows[0].depreciationAccountCode).toBe("6503");
    expect(r.rows[0].capitalize).toBe(true);
    expect(r.rows[0].paymentMethod).toBe("transfer_bca");
    expect(r.rows[1].capitalize).toBe(false);
    expect(r.rows[1].notes).toBe("Note kosong");
  });

  it("rejects missing required name", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
,1500000,60,2026-05-01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(r.errors.some((e) => e.field === "nama")).toBe(true);
  });

  it("rejects invalid cost (zero or negative)", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,0,60,2026-05-01,1201,6501
Test2,-100,60,2026-05-01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(r.errors.filter((e) => e.field === "cost").length).toBe(2);
  });

  it("rejects salvage >= cost", () => {
    const csv = `nama,cost,salvage_value,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,1000000,1000000,60,2026-05-01,1201,6501
Test2,1000000,2000000,60,2026-05-01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(r.errors.some((e) => e.field === "salvage_value")).toBe(true);
  });

  it("rejects invalid useful_life_months", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,1000000,0,2026-05-01,1201,6501
Test2,1000000,700,2026-05-01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(
      r.errors.filter((e) => e.field === "useful_life_months").length,
    ).toBe(2);
  });

  it("rejects invalid date format", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,1000000,60,15-04-2026,1201,6501
Test2,1000000,60,2026/05/01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(r.errors.filter((e) => e.field === "acquired_date").length).toBe(2);
  });

  it("rejects invalid asset_account_code (must be 1201-1204)", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,1000000,60,2026-05-01,1101,6501
Test2,1000000,60,2026-05-01,9999,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(
      r.errors.filter((e) => e.field === "asset_account_code").length,
    ).toBe(2);
  });

  it("rejects invalid depreciation_account_code (must be 6501-6504)", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,1000000,60,2026-05-01,1201,1234`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(
      r.errors.filter((e) => e.field === "depreciation_account_code").length,
    ).toBe(1);
  });

  it("accepts capitalize variants (true/1/yes/y/ya/iya)", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code,capitalize,payment_method
Aset Satu,1000000,60,2026-05-01,1201,6501,true,transfer_bca
Aset Dua,1000000,60,2026-05-01,1201,6501,1,transfer_bca
Aset Tiga,1000000,60,2026-05-01,1201,6501,yes,transfer_bca
Aset Empat,1000000,60,2026-05-01,1201,6501,ya,transfer_bca
Aset Lima,1000000,60,2026-05-01,1201,6501,no,transfer_bca`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(5);
    expect(r.rows[0].capitalize).toBe(true);
    expect(r.rows[1].capitalize).toBe(true);
    expect(r.rows[2].capitalize).toBe(true);
    expect(r.rows[3].capitalize).toBe(true);
    expect(r.rows[4].capitalize).toBe(false);
  });

  it("rejects invalid payment_method when capitalize=true", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code,capitalize,payment_method
Test,1000000,60,2026-05-01,1201,6501,true,gopay`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(0);
    expect(r.errors.some((e) => e.field === "payment_method")).toBe(true);
  });

  it("normalizes thousand separators in numeric fields", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,"50.000.000",60,2026-05-01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].cost).toBe(50_000_000);
  });

  it("default salvage to 0 if missing", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Test,1000000,60,2026-05-01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].salvageValue).toBe(0);
  });

  it("preserves rowNumber for error display (1-indexed, accounting for header)", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
Valid,1000000,60,2026-05-01,1201,6501
,1000000,60,2026-05-01,1201,6501`;
    const r = parseFixedAssetCsv(csv);
    expect(r.errors[0].rowNumber).toBe(3); // header=1, valid=2, error=3
  });

  it("multiple errors per row reported", () => {
    const csv = `nama,cost,useful_life_months,acquired_date,asset_account_code,depreciation_account_code
,0,700,bad-date,9999,1234`;
    const r = parseFixedAssetCsv(csv);
    expect(r.errors.length).toBeGreaterThan(3);
  });
});

describe("fixedAssetCsvTemplate", () => {
  it("generates CSV with all expected headers", () => {
    const csv = fixedAssetCsvTemplate();
    expect(csv).toContain("nama");
    expect(csv).toContain("cost");
    expect(csv).toContain("useful_life_months");
    expect(csv).toContain("acquired_date");
    expect(csv).toContain("asset_account_code");
    expect(csv).toContain("depreciation_account_code");
    expect(csv).toContain("capitalize");
    expect(csv).toContain("payment_method");
  });

  it("template parses without errors as round-trip", () => {
    const csv = fixedAssetCsvTemplate();
    const r = parseFixedAssetCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
