import { describe, expect, it } from "vitest";
import {
  detectGaps,
  parseCsvLine,
  parseDateTolerant,
  parseHistoricalCsv,
  parseNumberTolerant,
  suggestColumnMapping,
} from "@/features/historical/csv-parse-pure";

describe("parseCsvLine", () => {
  it("splits simple comma row", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("handles quoted field with comma", () => {
    expect(parseCsvLine('"a,b",c,d')).toEqual(["a,b", "c", "d"]);
  });
  it("handles escaped double-quote inside quoted field", () => {
    expect(parseCsvLine('"he said ""hi""",x')).toEqual([
      'he said "hi"',
      "x",
    ]);
  });
  it("trims whitespace", () => {
    expect(parseCsvLine(" a , b , c ")).toEqual(["a", "b", "c"]);
  });
});

describe("parseNumberTolerant", () => {
  it("returns 0 for empty string", () => {
    expect(parseNumberTolerant("")).toBe(0);
  });
  it("parses plain integer", () => {
    expect(parseNumberTolerant("1250000")).toBe(1250000);
  });
  it("parses Indonesian format (titik thousand, koma decimal)", () => {
    expect(parseNumberTolerant("1.250.000,50", ",")).toBe(1250000.5);
  });
  it("parses English format (koma thousand, titik decimal)", () => {
    expect(parseNumberTolerant("1,250,000.50", ".")).toBe(1250000.5);
  });
  it("strips Rp prefix", () => {
    expect(parseNumberTolerant("Rp 1.250.000", ",")).toBe(1250000);
  });
  it("auto-detects: koma alone with 3 digits = thousand separator", () => {
    expect(parseNumberTolerant("1,000")).toBe(1000);
  });
  it("auto-detects: koma alone with non-3 digits = decimal separator", () => {
    expect(parseNumberTolerant("1,5")).toBe(1.5);
  });
  it("auto-detects mixed: id-ID '1.250,75'", () => {
    expect(parseNumberTolerant("1.250,75")).toBe(1250.75);
  });
  it("auto-detects mixed: en-US '1,250.75'", () => {
    expect(parseNumberTolerant("1,250.75")).toBe(1250.75);
  });
  it("handles negative bracket notation", () => {
    expect(parseNumberTolerant("(500)")).toBe(-500);
  });
  it("returns NaN for invalid", () => {
    expect(parseNumberTolerant("abc")).toBeNaN();
  });
});

describe("parseDateTolerant", () => {
  it("parses ISO YYYY-MM-DD", () => {
    expect(parseDateTolerant("2026-05-15")).toBe("2026-05-15");
  });
  it("parses Indonesian DD/MM/YYYY", () => {
    expect(parseDateTolerant("15/05/2026")).toBe("2026-05-15");
  });
  it("parses with dash separator", () => {
    expect(parseDateTolerant("15-05-2026")).toBe("2026-05-15");
  });
  it("pads single-digit day/month", () => {
    expect(parseDateTolerant("5/3/2026")).toBe("2026-03-05");
  });
  it("rejects invalid date (Feb 30)", () => {
    expect(parseDateTolerant("30/02/2026")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseDateTolerant("abc")).toBeNull();
  });
  it("respects explicit ISO format (rejects DD/MM)", () => {
    expect(parseDateTolerant("15/05/2026", "YYYY-MM-DD")).toBeNull();
  });
});

describe("suggestColumnMapping", () => {
  it("matches Majoo-style headers", () => {
    const headers = [
      "Tanggal",
      "Total Penjualan",
      "Diskon",
      "Total Bersih",
      "Jumlah Transaksi",
      "Tunai",
      "QRIS",
      "EDC",
      "GoFood",
    ];
    const m = suggestColumnMapping(headers);
    expect(m.date).toBe("Tanggal");
    expect(m.grossRevenue).toBe("Total Penjualan");
    expect(m.netRevenue).toBe("Total Bersih");
    expect(m.totalDiscount).toBe("Diskon");
    expect(m.transactionCount).toBe("Jumlah Transaksi");
    expect(m.cashIn).toBe("Tunai");
    expect(m.qrisIn).toBe("QRIS");
    expect(m.edcIn).toBe("EDC");
    expect(m.aggregatorIn).toBe("GoFood");
  });
  it("matches English-style headers", () => {
    const m = suggestColumnMapping(["Date", "Gross", "Refund", "Net Revenue"]);
    expect(m.date).toBe("Date");
    expect(m.grossRevenue).toBe("Gross");
    expect(m.totalRefund).toBe("Refund");
  });
});

describe("detectGaps", () => {
  it("returns empty when contiguous", () => {
    expect(
      detectGaps(["2026-05-01", "2026-05-02", "2026-05-03"]),
    ).toEqual([]);
  });
  it("detects single gap", () => {
    expect(
      detectGaps(["2026-05-01", "2026-05-05"]),
    ).toEqual([{ from: "2026-05-01", to: "2026-05-05", days: 3 }]);
  });
  it("detects multiple gaps", () => {
    const gaps = detectGaps([
      "2026-05-01",
      "2026-05-03",
      "2026-05-07",
    ]);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual({ from: "2026-05-01", to: "2026-05-03", days: 1 });
    expect(gaps[1]).toEqual({ from: "2026-05-03", to: "2026-05-07", days: 3 });
  });
});

describe("parseHistoricalCsv (integration)", () => {
  const headers =
    "Tanggal,Total Penjualan,Refund,Diskon,Total Bersih,Jumlah Transaksi,Tunai,QRIS,EDC,GoFood";

  it("parses Majoo-style happy path", () => {
    const csv = [
      headers,
      "15/05/2026,1.250.000,0,50.000,1.200.000,45,500.000,400.000,200.000,100.000",
      "16/05/2026,1.800.000,30.000,0,1.770.000,60,800.000,600.000,300.000,70.000",
    ].join("\n");
    const result = parseHistoricalCsv(csv, {
      date: "Tanggal",
      grossRevenue: "Total Penjualan",
      totalRefund: "Refund",
      totalDiscount: "Diskon",
      netRevenue: "Total Bersih",
      transactionCount: "Jumlah Transaksi",
      cashIn: "Tunai",
      qrisIn: "QRIS",
      edcIn: "EDC",
      aggregatorIn: "GoFood",
    });
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      businessDate: "2026-05-15",
      grossRevenue: 1250000,
      totalRefund: 0,
      totalDiscount: 50000,
      netRevenue: 1200000,
      transactionCount: 45,
      cashIn: 500000,
      qrisIn: 400000,
      edcIn: 200000,
      aggregatorIn: 100000,
    });
  });

  it("auto-fills missing netRevenue from gross - deductions", () => {
    const csv = [
      "Tanggal,Total Penjualan,Refund,Diskon",
      "15/05/2026,1000000,50000,30000",
    ].join("\n");
    const result = parseHistoricalCsv(csv, {
      date: "Tanggal",
      grossRevenue: "Total Penjualan",
      totalRefund: "Refund",
      totalDiscount: "Diskon",
    });
    expect(result.rows[0]?.netRevenue).toBe(920000);
  });

  it("flags duplicate dates as warning", () => {
    const csv = [
      "Tanggal,Total Penjualan",
      "15/05/2026,1000000",
      "15/05/2026,2000000",
    ].join("\n");
    const result = parseHistoricalCsv(csv, {
      date: "Tanggal",
      grossRevenue: "Total Penjualan",
    });
    expect(result.warnings.some((w) => w.includes("duplikat"))).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it("flags gap as warning", () => {
    const csv = [
      "Tanggal,Total Penjualan",
      "15/05/2026,1000000",
      "20/05/2026,2000000",
    ].join("\n");
    const result = parseHistoricalCsv(csv, {
      date: "Tanggal",
      grossRevenue: "Total Penjualan",
    });
    expect(result.warnings.some((w) => w.includes("gap"))).toBe(true);
  });

  it("returns error when date column missing", () => {
    const csv = "Foo,Bar\n1,2";
    const result = parseHistoricalCsv(csv, { date: "Tanggal" });
    expect(result.errors[0]).toContain("tidak ditemukan");
    expect(result.rows).toEqual([]);
  });

  it("returns error when CSV empty", () => {
    const result = parseHistoricalCsv("", { date: "Tanggal" });
    expect(result.errors[0]).toContain("kosong");
  });

  it("flags invalid date row but continues", () => {
    const csv = [
      "Tanggal,Total Penjualan",
      "30/02/2026,1000000",
      "15/05/2026,2000000",
    ].join("\n");
    const result = parseHistoricalCsv(csv, {
      date: "Tanggal",
      grossRevenue: "Total Penjualan",
    });
    expect(result.errors.some((e) => e.includes("tidak valid"))).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.businessDate).toBe("2026-05-15");
  });

  it("transactionCount truncated to integer (floor negative to 0)", () => {
    const csv = [
      "Tanggal,Total Penjualan,Trx",
      "15/05/2026,1000000,45.7",
    ].join("\n");
    const result = parseHistoricalCsv(csv, {
      date: "Tanggal",
      grossRevenue: "Total Penjualan",
      transactionCount: "Trx",
    });
    expect(result.rows[0]?.transactionCount).toBe(45);
  });

  it("rounds money fields to integer rupiah", () => {
    // Decimal in net field via en-US format (single dot + 2 digits → decimal)
    const csv = ["Tanggal,Net", "15/05/2026,1250000.75"].join("\n");
    const result = parseHistoricalCsv(csv, {
      date: "Tanggal",
      netRevenue: "Net",
    });
    expect(result.rows[0]?.netRevenue).toBe(1250001); // rounded
  });
});
