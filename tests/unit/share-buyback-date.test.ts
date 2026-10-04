import { describe, expect, it } from "vitest";
import { jakartaDateOf } from "@/lib/tz";

/* Sesi AE-247 — modal buyback & pindah saham kini mengirim tanggal "YYYY-MM-DD".
 * Server mengubahnya `new Date(str)` (= tengah malam UTC) lalu menurunkan
 * entry_date lewat jakartaDateOf. Yang gampang salah: tanggalnya maju atau
 * mundur sehari di WIB — jurnalnya mendarat di hari, kadang BULAN, yang beda
 * tanpa ada yang menolak. */
describe("tanggal buyback → entry_date jurnal (AE-247)", () => {
  const cases = [
    "2026-10-04",
    "2026-10-01", // awal bulan — paling berisiko lompat ke bulan sebelumnya
    "2026-09-30", // akhir bulan
    "2026-01-01",
    "2026-12-31",
  ];
  for (const iso of cases) {
    it(`${iso} tetap ${iso}`, () => {
      expect(jakartaDateOf(new Date(iso))).toBe(iso);
    });
  }

  it("tengah malam WIB persis masih hari yang sama", () => {
    // 2026-10-01 00:00 WIB = 2026-09-30 17:00 UTC
    expect(jakartaDateOf(new Date("2026-09-30T17:00:00Z"))).toBe("2026-10-01");
  });

  it("sedetik sebelum tengah malam WIB masih hari sebelumnya", () => {
    expect(jakartaDateOf(new Date("2026-09-30T16:59:59Z"))).toBe("2026-09-30");
  });
});
