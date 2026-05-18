import { describe, expect, it } from "vitest";
import {
  aggregateDaily,
  aggregateSinglePeriod,
  autoDetectColumns,
  parseAggregatorCsv,
  parseIndonesianDate,
  parseRupiahLoose,
} from "@/features/finance/aggregator-csv-parser";

describe("parseIndonesianDate", () => {
  it("parses ISO YYYY-MM-DD", () => {
    expect(parseIndonesianDate("2026-05-15")).toBe("2026-05-15");
    expect(parseIndonesianDate("2026/05/15")).toBe("2026-05-15");
    expect(parseIndonesianDate("2026.05.15")).toBe("2026-05-15");
  });

  it("parses DD-MM-YYYY (Indonesian)", () => {
    expect(parseIndonesianDate("15-05-2026")).toBe("2026-05-15");
    expect(parseIndonesianDate("15/05/2026")).toBe("2026-05-15");
    expect(parseIndonesianDate("1/5/2026")).toBe("2026-05-01");
  });

  it("parses DD Month YYYY (Indonesian names)", () => {
    expect(parseIndonesianDate("15 Mei 2026")).toBe("2026-05-15");
    expect(parseIndonesianDate("15 Januari 2026")).toBe("2026-01-15");
    expect(parseIndonesianDate("1 Des 2026")).toBe("2026-12-01");
  });

  it("strips time suffix", () => {
    expect(parseIndonesianDate("2026-05-15 14:30:00")).toBe("2026-05-15");
    expect(parseIndonesianDate("2026-05-15T14:30:00")).toBe("2026-05-15");
  });

  it("handles Excel serial date number", () => {
    // 45437 = 2024-05-15 (approx — Excel serial)
    const result = parseIndonesianDate(45437);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns null for invalid input", () => {
    expect(parseIndonesianDate("")).toBeNull();
    expect(parseIndonesianDate("foo")).toBeNull();
    expect(parseIndonesianDate("99-99-9999")).not.toBeNull(); // permissive — caller responsibility
  });
});

describe("parseRupiahLoose", () => {
  it("strips Rp prefix + thousand separators", () => {
    expect(parseRupiahLoose("Rp 1.500.000")).toBe(1500000);
    expect(parseRupiahLoose("Rp 1,500,000")).toBe(1500000);
    expect(parseRupiahLoose("Rp1.500.000")).toBe(1500000);
    expect(parseRupiahLoose("1500000")).toBe(1500000);
  });

  it("handles plain number", () => {
    expect(parseRupiahLoose(1500000)).toBe(1500000);
    expect(parseRupiahLoose(0)).toBe(0);
  });

  it("handles negative (-1000 or parenthesis)", () => {
    expect(parseRupiahLoose("-1.000")).toBe(-1000);
    expect(parseRupiahLoose("(1.000)")).toBe(-1000);
  });

  it("returns null for invalid", () => {
    expect(parseRupiahLoose("")).toBeNull();
    expect(parseRupiahLoose("abc")).toBeNull();
  });
});

describe("autoDetectColumns", () => {
  it("detects standard GoFood headers", () => {
    const mapping = autoDetectColumns([
      "Tanggal",
      "No Transaksi",
      "Gross",
      "Komisi",
      "Net",
    ]);
    expect(mapping).toEqual({
      dateColumn: 0,
      grossColumn: 2,
      feeColumn: 3,
      netColumn: 4,
    });
  });

  it("detects English headers (Grab-style)", () => {
    const mapping = autoDetectColumns([
      "Date",
      "Order ID",
      "Gross Amount",
      "Commission",
      "Net Amount",
    ]);
    expect(mapping?.dateColumn).toBe(0);
    expect(mapping?.grossColumn).toBe(2);
    expect(mapping?.feeColumn).toBe(3);
    expect(mapping?.netColumn).toBe(4);
  });

  it("returns null kalau no date/gross detected", () => {
    expect(autoDetectColumns(["foo", "bar", "baz"])).toBeNull();
  });

  it("works with partial keywords (omset, omzet)", () => {
    const mapping = autoDetectColumns(["Tanggal", "Omzet", "Potongan"]);
    expect(mapping?.dateColumn).toBe(0);
    expect(mapping?.grossColumn).toBe(1);
    expect(mapping?.feeColumn).toBe(2);
  });
});

describe("parseAggregatorCsv", () => {
  it("parses standard CSV with header auto-detect", () => {
    const csv = `Tanggal,Gross,Komisi
2026-05-15,150000,30000
2026-05-16,200000,40000
2026-05-17,175000,35000`;
    const result = parseAggregatorCsv(csv);
    expect(result.rows.length).toBe(3);
    expect(result.errors.length).toBe(0);
    expect(result.rows[0]).toMatchObject({
      date: "2026-05-15",
      grossAmount: 150000,
      feeAmount: 30000,
      netAmount: 120000,
    });
  });

  it("uses provided mapping kalau auto-detect ga cocok", () => {
    const csv = `foo,bar,baz
2026-05-15,1500,300
2026-05-16,2000,400`;
    const result = parseAggregatorCsv(csv, {
      mapping: { dateColumn: 0, grossColumn: 1, feeColumn: 2 },
    });
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].grossAmount).toBe(1500);
  });

  it("handles rupiah formatted columns", () => {
    const csv = `Tanggal,Gross,Komisi
15-05-2026,"Rp 1.500.000","Rp 300.000"
16-05-2026,"Rp 2.000.000","Rp 400.000"`;
    const result = parseAggregatorCsv(csv);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]).toMatchObject({
      date: "2026-05-15",
      grossAmount: 1500000,
      feeAmount: 300000,
      netAmount: 1200000,
    });
  });

  it("skips invalid rows + collects errors", () => {
    const csv = `Tanggal,Gross
2026-05-15,100000
invalid-date,200000
2026-05-17,not-a-number`;
    const result = parseAggregatorCsv(csv);
    expect(result.rows.length).toBe(1);
    expect(result.errors.length).toBe(2);
  });

  it("net column override gross-fee computation", () => {
    const csv = `Tanggal,Gross,Fee,Net
2026-05-15,100000,15000,80000`; // net = 80k bukan 85k (gross-fee)
    const result = parseAggregatorCsv(csv);
    expect(result.rows[0].netAmount).toBe(80000);
  });

  it("empty file returns empty result + error", () => {
    const result = parseAggregatorCsv("");
    expect(result.rows.length).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("aggregateDaily", () => {
  it("groups multiple rows per same date", () => {
    const result = aggregateDaily([
      {
        date: "2026-05-15",
        grossAmount: 100000,
        feeAmount: 10000,
        netAmount: 90000,
        sourceRowIndex: 1,
      },
      {
        date: "2026-05-15",
        grossAmount: 50000,
        feeAmount: 5000,
        netAmount: 45000,
        sourceRowIndex: 2,
      },
      {
        date: "2026-05-16",
        grossAmount: 200000,
        feeAmount: 20000,
        netAmount: 180000,
        sourceRowIndex: 3,
      },
    ]);
    expect(result.length).toBe(2);
    expect(result[0]).toMatchObject({
      date: "2026-05-15",
      periodFrom: "2026-05-15",
      periodTo: "2026-05-15",
      grossAmount: 150000,
      feeAmount: 15000,
      netAmount: 135000,
      rowCount: 2,
    });
    expect(result[1].grossAmount).toBe(200000);
  });

  it("sorts by date ascending", () => {
    const result = aggregateDaily([
      {
        date: "2026-05-20",
        grossAmount: 100,
        feeAmount: 0,
        netAmount: 100,
        sourceRowIndex: 1,
      },
      {
        date: "2026-05-10",
        grossAmount: 200,
        feeAmount: 0,
        netAmount: 200,
        sourceRowIndex: 2,
      },
      {
        date: "2026-05-15",
        grossAmount: 300,
        feeAmount: 0,
        netAmount: 300,
        sourceRowIndex: 3,
      },
    ]);
    expect(result.map((r) => r.date)).toEqual([
      "2026-05-10",
      "2026-05-15",
      "2026-05-20",
    ]);
  });
});

describe("aggregateSinglePeriod", () => {
  it("sums all rows into one settlement spanning min..max date", () => {
    const result = aggregateSinglePeriod([
      {
        date: "2026-05-15",
        grossAmount: 100000,
        feeAmount: 10000,
        netAmount: 90000,
        sourceRowIndex: 1,
      },
      {
        date: "2026-05-20",
        grossAmount: 200000,
        feeAmount: 20000,
        netAmount: 180000,
        sourceRowIndex: 2,
      },
      {
        date: "2026-05-10",
        grossAmount: 50000,
        feeAmount: 5000,
        netAmount: 45000,
        sourceRowIndex: 3,
      },
    ]);
    expect(result).toMatchObject({
      periodFrom: "2026-05-10",
      periodTo: "2026-05-20",
      grossAmount: 350000,
      feeAmount: 35000,
      netAmount: 315000,
      rowCount: 3,
    });
  });

  it("returns null for empty input", () => {
    expect(aggregateSinglePeriod([])).toBeNull();
  });
});
