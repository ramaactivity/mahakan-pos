import { describe, expect, it } from "vitest";
import {
  parseCsv,
  parseRupiahCell,
  parseDateCell,
  parseDecimalCell,
  findHeaderIdx,
  rowsToCsv,
} from "@/features/admin/sections/investors/_csv-utils";

/**
 * Sesi AE-80 follow-up — pure parser tests untuk CSV importer
 * (Investor / Pengelola / Kreditur).
 */

describe("parseCsv", () => {
  it("parses basic header + 2 rows", () => {
    const { headers, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(headers).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted field with comma inside", () => {
    const { rows } = parseCsv('a,b,c\n1,"hello, world",3');
    expect(rows[0]).toEqual(["1", "hello, world", "3"]);
  });

  it("handles CRLF line endings", () => {
    const { headers, rows } = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toHaveLength(2);
  });

  it("skips empty lines", () => {
    const { rows } = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(rows).toHaveLength(2);
  });

  it("handles empty input", () => {
    const { headers, rows } = parseCsv("");
    expect(headers).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("trims whitespace around cells", () => {
    const { rows } = parseCsv("a,b\n  1  ,  2  ");
    expect(rows[0]).toEqual(["1", "2"]);
  });
});

describe("parseRupiahCell", () => {
  it("strips Rp prefix + dots + spaces", () => {
    expect(parseRupiahCell("Rp 1.700.000")).toBe(1_700_000);
    expect(parseRupiahCell("Rp1.700.000")).toBe(1_700_000);
    expect(parseRupiahCell("1,700,000")).toBe(1_700_000);
  });

  it("handles plain digits", () => {
    expect(parseRupiahCell("500000")).toBe(500_000);
  });

  it("returns 0 for empty", () => {
    expect(parseRupiahCell("")).toBe(0);
    expect(parseRupiahCell("   ")).toBe(0);
  });

  it("ignores non-digit chars", () => {
    expect(parseRupiahCell("Rp abc 500")).toBe(500);
  });
});

describe("parseDateCell", () => {
  it("accepts ISO format", () => {
    expect(parseDateCell("1999-06-02")).toBe("1999-06-02");
  });

  it("accepts ISO with timestamp suffix", () => {
    expect(parseDateCell("1999-06-02T00:00:00.000Z")).toBe("1999-06-02");
  });

  it("accepts text date format", () => {
    expect(parseDateCell("02 June 1999")).toBe("1999-06-02");
  });

  it("rejects empty", () => {
    expect(parseDateCell("")).toBe(null);
    expect(parseDateCell("   ")).toBe(null);
  });

  it("rejects unparseable", () => {
    expect(parseDateCell("not a date")).toBe(null);
  });

  it("rejects year out of range", () => {
    expect(parseDateCell("1899-01-01")).toBe(null);
    expect(parseDateCell("2200-01-01")).toBe(null);
  });
});

describe("parseDecimalCell", () => {
  it("parses standard decimal", () => {
    expect(parseDecimalCell("10.5")).toBe(10.5);
    expect(parseDecimalCell("0.25")).toBe(0.25);
  });

  it("handles comma as decimal separator (id-ID locale)", () => {
    expect(parseDecimalCell("10,5")).toBe(10.5);
  });

  it("strips % suffix", () => {
    expect(parseDecimalCell("10.5%")).toBe(10.5);
  });

  it("returns null for empty", () => {
    expect(parseDecimalCell("")).toBe(null);
    expect(parseDecimalCell("   ")).toBe(null);
  });

  it("returns null for non-numeric", () => {
    expect(parseDecimalCell("abc")).toBe(null);
  });

  it("handles negative values", () => {
    expect(parseDecimalCell("-10.5")).toBe(-10.5);
  });
});

describe("findHeaderIdx", () => {
  const headers = ["Nama Lengkap", "Besaran Investasi", "Email", "Bank"];

  it("returns -1 when no match", () => {
    expect(findHeaderIdx(headers, ["xyz"])).toBe(-1);
  });

  it("matches case-insensitive substring", () => {
    expect(findHeaderIdx(headers, ["NAMA"])).toBe(0);
    expect(findHeaderIdx(headers, ["nama"])).toBe(0);
    expect(findHeaderIdx(headers, ["email"])).toBe(2);
  });

  it("returns first pattern match priority", () => {
    /* "investasi" matches "Besaran Investasi" — earlier in headers than nothing else */
    expect(findHeaderIdx(headers, ["nonexistent", "investasi"])).toBe(1);
  });

  it("handles trim whitespace", () => {
    const padded = ["  Nama Lengkap  ", "Email"];
    expect(findHeaderIdx(padded, ["nama"])).toBe(0);
  });
});

describe("rowsToCsv", () => {
  it("builds CSV with headers + rows", () => {
    const csv = rowsToCsv(
      ["a", "b"],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(csv).toBe("a,b\n1,2\n3,4");
  });

  it("escapes cells with comma via quotes", () => {
    const csv = rowsToCsv(["a", "b"], [["hello, world", "ok"]]);
    expect(csv).toContain('"hello, world"');
  });

  it("escapes double-quote characters by doubling", () => {
    const csv = rowsToCsv(["a"], [['say "hi"']]);
    expect(csv).toContain('"say ""hi"""');
  });

  it("handles null/undefined as empty", () => {
    const csv = rowsToCsv(["a", "b", "c"], [[1, null, undefined]]);
    expect(csv).toBe("a,b,c\n1,,");
  });

  it("escapes newline-containing cells", () => {
    const csv = rowsToCsv(["a"], [["line1\nline2"]]);
    expect(csv).toContain('"line1\nline2"');
  });
});
