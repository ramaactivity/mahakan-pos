import { describe, it, expect } from "vitest";
import {
  parseIndonesianInt,
  parseIndonesianNumber,
} from "@/lib/format";

/**
 * Sesi AE-136 — Lock down konvensi number parsing.
 *
 * Konvensi sistem Mahakan POS: titik = ribuan, koma = desimal.
 * Strict mode (default) tolak format Inggris yang ambiguous.
 */

describe("parseIndonesianNumber — strict (default)", () => {
  describe("integers", () => {
    it("plain integer", () => {
      expect(parseIndonesianNumber("0")).toBe(0);
      expect(parseIndonesianNumber("1234")).toBe(1234);
      expect(parseIndonesianNumber("123456789")).toBe(123456789);
    });

    it("with thousand separator (titik)", () => {
      expect(parseIndonesianNumber("1.234")).toBe(1234);
      expect(parseIndonesianNumber("12.345")).toBe(12345);
      expect(parseIndonesianNumber("123.456")).toBe(123456);
      expect(parseIndonesianNumber("1.234.567")).toBe(1234567);
      expect(parseIndonesianNumber("1.250.000")).toBe(1250000);
    });

    it("with Rp prefix + spaces", () => {
      expect(parseIndonesianNumber("Rp 1.500.000")).toBe(1500000);
      expect(parseIndonesianNumber("Rp1234")).toBe(1234);
      expect(parseIndonesianNumber("  1.234  ")).toBe(1234);
    });

    it("negative", () => {
      expect(parseIndonesianNumber("-1234")).toBe(-1234);
      expect(parseIndonesianNumber("-1.234")).toBe(-1234);
      expect(parseIndonesianNumber("-1.234,5")).toBe(-1234.5);
    });
  });

  describe("decimals (koma)", () => {
    it("simple decimal", () => {
      expect(parseIndonesianNumber("0,5")).toBe(0.5);
      expect(parseIndonesianNumber("1,5")).toBe(1.5);
      expect(parseIndonesianNumber("12,34")).toBe(12.34);
      expect(parseIndonesianNumber("0,001")).toBe(0.001);
    });

    it("decimal with thousand separator", () => {
      expect(parseIndonesianNumber("1.234,56")).toBe(1234.56);
      expect(parseIndonesianNumber("1.234.567,89")).toBe(1234567.89);
      expect(parseIndonesianNumber("12.345,6789")).toBe(12345.6789);
    });
  });

  describe("REJECTS English format (strict default)", () => {
    it("English decimal without thousand context", () => {
      /* "0.5" ambiguous — bisa "5/10" Inggris atau "5 ribu" Indonesia. Reject. */
      expect(parseIndonesianNumber("0.5")).toBeNaN();
      expect(parseIndonesianNumber("1.5")).toBeNaN();
      expect(parseIndonesianNumber("12.34")).toBeNaN();
      expect(parseIndonesianNumber("1.2345")).toBeNaN();
    });

    it("English thousand separators (comma)", () => {
      expect(parseIndonesianNumber("1,234,567")).toBeNaN();
      expect(parseIndonesianNumber("1,234.56")).toBeNaN();
    });

    it("titik group bukan 3 digit", () => {
      expect(parseIndonesianNumber("12.3456")).toBeNaN();
      expect(parseIndonesianNumber("1234.567")).toBeNaN();
    });
  });

  describe("invalid input", () => {
    it("empty / null-ish", () => {
      expect(parseIndonesianNumber("")).toBeNaN();
      expect(parseIndonesianNumber("   ")).toBeNaN();
      expect(parseIndonesianNumber("abc")).toBeNaN();
      expect(parseIndonesianNumber("Rp")).toBeNaN();
    });

    it("invalid comma usage", () => {
      expect(parseIndonesianNumber(",5")).toBeNaN(); // butuh "0,5"
      expect(parseIndonesianNumber("0,")).toBeNaN(); // butuh angka setelah koma
      expect(parseIndonesianNumber("1,2,3")).toBeNaN(); // koma ganda
      expect(parseIndonesianNumber("1,5.6")).toBeNaN(); // titik setelah koma
    });

    it("invalid sign", () => {
      expect(parseIndonesianNumber("1-234")).toBeNaN();
      expect(parseIndonesianNumber("--1234")).toBeNaN();
    });
  });
});

describe("parseIndonesianNumber — lenient mode", () => {
  it("accepts English single-dot decimal", () => {
    expect(parseIndonesianNumber("0.5", { strict: false })).toBe(0.5);
    expect(parseIndonesianNumber("1.5", { strict: false })).toBe(1.5);
    expect(parseIndonesianNumber("12.34", { strict: false })).toBe(12.34);
  });

  it("still uses Indonesian convention when unambiguous", () => {
    expect(parseIndonesianNumber("1.234", { strict: false })).toBe(1234);
    expect(parseIndonesianNumber("0,5", { strict: false })).toBe(0.5);
    expect(parseIndonesianNumber("1.234.567", { strict: false })).toBe(
      1234567,
    );
  });

  it("still rejects clearly invalid", () => {
    expect(parseIndonesianNumber("1,234,567", { strict: false })).toBeNaN();
    expect(parseIndonesianNumber("abc", { strict: false })).toBeNaN();
  });
});

describe("parseIndonesianInt — strict round to integer", () => {
  it("rounds decimal", () => {
    expect(parseIndonesianInt("1,5")).toBe(2); // round half up
    expect(parseIndonesianInt("1,4")).toBe(1);
    expect(parseIndonesianInt("1.234,7")).toBe(1235);
  });

  it("rejects English format", () => {
    expect(parseIndonesianInt("0.5")).toBeNaN();
  });
});
