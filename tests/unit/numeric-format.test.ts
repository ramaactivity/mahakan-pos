import { describe, expect, it } from "vitest";
import { formatDisplay, sanitizeTyped } from "@/lib/numeric-format";

describe("formatDisplay", () => {
  it("kosong tetap kosong", () => {
    expect(formatDisplay("", true)).toBe("");
  });

  it("tambah titik ribuan gaya id-ID", () => {
    expect(formatDisplay("1500000", true)).toBe("1.500.000");
    expect(formatDisplay("150", true)).toBe("150");
  });

  it("desimal pakai koma di tampilan", () => {
    expect(formatDisplay("1500.5", true)).toBe("1.500,5");
    expect(formatDisplay("0.25", true)).toBe("0,25");
  });

  it("tanpa pemisah kalau formatThousands=false", () => {
    expect(formatDisplay("1500000", false)).toBe("1500000");
  });
});

describe("sanitizeTyped (ketikan keyboard fisik di laptop)", () => {
  it("ketikan digit biasa lewat apa adanya", () => {
    expect(sanitizeTyped("1500", false, 12)).toBe("1500");
  });

  it("buang semua karakter non-digit — termasuk paste 'Rp 1.500.000'", () => {
    expect(sanitizeTyped("Rp 1.500.000", false, 12)).toBe("1500000");
    expect(sanitizeTyped("12ab34", false, 12)).toBe("1234");
  });

  it("mode integer menolak pemisah desimal", () => {
    expect(sanitizeTyped("1,5", false, 12)).toBe("15");
    expect(sanitizeTyped("1.5", false, 12)).toBe("15");
  });

  it("mode desimal terima koma ATAU titik, maksimal satu", () => {
    expect(sanitizeTyped("1,5", true, 12)).toBe("1.5");
    expect(sanitizeTyped("1.5", true, 12)).toBe("1.5");
    expect(sanitizeTyped("1.5.7", true, 12)).toBe("1.57");
  });

  it("diawali pemisah desimal jadi '0.'", () => {
    expect(sanitizeTyped(".", true, 12)).toBe("0.");
    expect(sanitizeTyped(",5", true, 12)).toBe("0.5");
  });

  it("nol di depan dibuang, tapi '0' dan '0.x' utuh", () => {
    expect(sanitizeTyped("05", false, 12)).toBe("5");
    expect(sanitizeTyped("007", false, 12)).toBe("7");
    expect(sanitizeTyped("0", false, 12)).toBe("0");
    expect(sanitizeTyped("0.5", true, 12)).toBe("0.5");
  });

  it("potong di maxLength", () => {
    expect(sanitizeTyped("1234567890123", false, 12)).toBe("123456789012");
  });

  it("kosong tetap kosong (hapus semua isi field)", () => {
    expect(sanitizeTyped("", false, 12)).toBe("");
    expect(sanitizeTyped("abc", false, 12)).toBe("");
  });
});
