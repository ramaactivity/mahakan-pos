import { describe, expect, it } from "vitest";
import {
  formatClientErrorForCopy,
  isChunkLoadError,
} from "@/lib/client-error-report";

/**
 * Sesi AE-213 — dua fungsi ini yang menentukan apakah layar error berguna:
 * salah menilai chunk basi = owner terjebak layar error yang sebenarnya
 * cukup dimuat ulang; teks salin yang bolong = laporan ke dev tetap
 * setengah-setengah seperti sebelumnya.
 */
describe("isChunkLoadError", () => {
  it("mengenali ChunkLoadError dari nama error", () => {
    const e = new Error("apa saja");
    e.name = "ChunkLoadError";
    expect(isChunkLoadError(e)).toBe(true);
  });

  it("mengenali pesan chunk webpack + dynamic import ES module", () => {
    expect(isChunkLoadError(new Error("Loading chunk 4821 failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk 12 failed"))).toBe(
      true,
    );
    expect(
      isChunkLoadError(
        new Error("Failed to fetch dynamically imported module: /_next/x.js"),
      ),
    ).toBe(true);
    expect(
      isChunkLoadError(
        new Error("error loading dynamically imported module: /_next/y.js"),
      ),
    ).toBe(true);
  });

  it("TIDAK menganggap error aplikasi biasa sebagai chunk basi", () => {
    expect(
      isChunkLoadError(
        new Error("Cannot read properties of undefined (reading 'filled')"),
      ),
    ).toBe(false);
    expect(isChunkLoadError(new Error("Failed query: select ..."))).toBe(false);
    /* Jangan sampai kata 'chunk' saja cukup — kalau ini true, error data
     * beneran akan disembunyikan di balik reload berulang. */
    expect(isChunkLoadError(new Error("chunk size terlalu besar"))).toBe(false);
  });

  it("aman untuk error tanpa message", () => {
    const e = new Error();
    expect(isChunkLoadError(e)).toBe(false);
  });
});

describe("formatClientErrorForCopy", () => {
  it("memuat pesan, bagian, halaman, dan ref dalam satu teks", () => {
    const text = formatClientErrorForCopy({
      message: "x is not a function",
      name: "TypeError",
      scope: "admin:accounting",
      path: "/dashboard#accounting",
      digest: "1234567890",
      at: "2026-08-21T12:00:00.000Z",
      stack: "TypeError: x is not a function\n  at Foo",
    });
    expect(text).toContain("Error: x is not a function");
    expect(text).toContain("Jenis: TypeError");
    expect(text).toContain("Bagian: admin:accounting");
    expect(text).toContain("Halaman: /dashboard#accounting");
    expect(text).toContain("Ref: 1234567890");
    expect(text).toContain("at Foo");
  });

  it("melewati baris yang datanya tidak ada (tanpa 'undefined')", () => {
    const text = formatClientErrorForCopy({ message: "gagal" });
    expect(text).toBe("Error: gagal");
    expect(text).not.toContain("undefined");
  });
});
