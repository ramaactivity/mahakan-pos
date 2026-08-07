import { describe, expect, it } from "vitest";
import {
  PAYMENT_TERM_DEFAULT_DAYS,
  PAYMENT_TERM_MAX_DAYS,
  paymentTermOnSwitchToTop,
  resolvePaymentTermDays,
  resolveSupplierTermDays,
  sanitizePaymentTermInput,
} from "@/features/purchases/payment-term";

describe("sanitizePaymentTermInput", () => {
  it("membiarkan field kosong saat user menghapus isinya", () => {
    /* Regresi AE-190: dulu field kosong langsung ditulis balik jadi "7",
     * sehingga tempo terasa terkunci di 7 hari. */
    expect(sanitizePaymentTermInput("")).toBe("");
  });

  it("menerima angka berapa pun, bukan cuma 7", () => {
    expect(sanitizePaymentTermInput("14")).toBe("14");
    expect(sanitizePaymentTermInput("30")).toBe("30");
    expect(sanitizePaymentTermInput("45")).toBe("45");
    expect(sanitizePaymentTermInput("365")).toBe("365");
  });

  it("membuang karakter non-digit", () => {
    expect(sanitizePaymentTermInput("1a4")).toBe("14");
    expect(sanitizePaymentTermInput("-7")).toBe("7");
    expect(sanitizePaymentTermInput("2.5")).toBe("25");
    expect(sanitizePaymentTermInput("abc")).toBe("");
  });

  it("memotong di 3 digit dan merapikan nol di depan", () => {
    expect(sanitizePaymentTermInput("99999")).toBe("999");
    expect(sanitizePaymentTermInput("007")).toBe("7");
    expect(sanitizePaymentTermInput("0")).toBe("0");
  });
});

describe("resolvePaymentTermDays", () => {
  it("non-TOP selalu 0 apa pun isi fieldnya", () => {
    expect(resolvePaymentTermDays("30", false)).toEqual({ ok: true, days: 0 });
    expect(resolvePaymentTermDays("", false)).toEqual({ ok: true, days: 0 });
  });

  it("TOP menerima tempo bebas 1..365", () => {
    for (const raw of ["1", "7", "14", "30", "45", "60", "90", "365"]) {
      expect(resolvePaymentTermDays(raw, true)).toEqual({
        ok: true,
        days: Number(raw),
      });
    }
  });

  it("TOP menolak kosong, nol, dan di atas batas server", () => {
    expect(resolvePaymentTermDays("", true).ok).toBe(false);
    expect(resolvePaymentTermDays("0", true).ok).toBe(false);
    expect(resolvePaymentTermDays("366", true).ok).toBe(false);
    expect(resolvePaymentTermDays(String(PAYMENT_TERM_MAX_DAYS), true).ok).toBe(
      true,
    );
  });

  it("TOP menolak sampah yang dulu lolos lewat parseInt", () => {
    /* parseInt("7hari") = 7 — angka karangan ikut tersimpan diam-diam. */
    expect(resolvePaymentTermDays("7hari", true).ok).toBe(false);
    expect(resolvePaymentTermDays("14.5", true).ok).toBe(false);
  });
});

describe("paymentTermOnSwitchToTop", () => {
  it("menyodorkan default saat field belum berisi tempo yang sah", () => {
    expect(paymentTermOnSwitchToTop("")).toBe(String(PAYMENT_TERM_DEFAULT_DAYS));
    expect(paymentTermOnSwitchToTop("0")).toBe(
      String(PAYMENT_TERM_DEFAULT_DAYS),
    );
  });

  it("mempertahankan tempo yang sudah diketik user", () => {
    expect(paymentTermOnSwitchToTop("30")).toBe("30");
    expect(paymentTermOnSwitchToTop(" 45 ")).toBe("45");
  });
});

describe("resolveSupplierTermDays", () => {
  it("kosong = 0 (cash on delivery)", () => {
    expect(resolveSupplierTermDays("")).toEqual({ ok: true, days: 0 });
    expect(resolveSupplierTermDays("0")).toEqual({ ok: true, days: 0 });
  });

  it("menerima tempo default bebas sampai batas server", () => {
    expect(resolveSupplierTermDays("30")).toEqual({ ok: true, days: 30 });
    expect(resolveSupplierTermDays("366").ok).toBe(false);
  });
});
