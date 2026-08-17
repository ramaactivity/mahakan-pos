import { describe, expect, it } from "vitest";
import { normalizeReceiptUrl } from "@/features/accounting/receipt-url";

/* Sesi AE-206 — bukti transaksi jurnal manual. URL-nya jadi tautan yang
 * diklik owner di daftar Jurnal, jadi skema selain http/https WAJIB ditolak. */

describe("normalizeReceiptUrl", () => {
  it("meloloskan link Drive https apa adanya", () => {
    const url = "https://drive.google.com/file/d/abc123/view";
    expect(normalizeReceiptUrl(url)).toBe(url);
  });

  it("http biasa juga boleh", () => {
    expect(normalizeReceiptUrl("http://contoh.test/nota.jpg")).toBe(
      "http://contoh.test/nota.jpg",
    );
  });

  it("kosong / null / spasi → null", () => {
    expect(normalizeReceiptUrl("")).toBeNull();
    expect(normalizeReceiptUrl("   ")).toBeNull();
    expect(normalizeReceiptUrl(null)).toBeNull();
    expect(normalizeReceiptUrl(undefined)).toBeNull();
  });

  it("skema berbahaya ditolak, bukan disimpan", () => {
    expect(normalizeReceiptUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeReceiptUrl("  JavaScript:alert(1)")).toBeNull();
    expect(normalizeReceiptUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(normalizeReceiptUrl("file:///etc/passwd")).toBeNull();
  });

  it("teks acak / path relatif bukan URL sah → null", () => {
    expect(normalizeReceiptUrl("nota kemarin")).toBeNull();
    expect(normalizeReceiptUrl("/uploads/nota.jpg")).toBeNull();
  });

  it("URL kepanjangan dipotong di 2000 karakter", () => {
    const long = `https://drive.google.com/${"a".repeat(3000)}`;
    expect(normalizeReceiptUrl(long)).toHaveLength(2000);
  });
});
