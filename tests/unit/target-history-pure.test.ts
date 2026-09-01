import { describe, expect, it } from "vitest";
import { resolveMonthlyTarget } from "@/features/reports/target-history-pure";

describe("resolveMonthlyTarget — patokan penilaian bulan lampau (AE-223)", () => {
  const targets = {
    monthlyRevenue: 40_000_000, // berlaku sekarang
    monthlyHistory: { "2026-08": 30_000_000, "2026-07": 25_000_000 },
  };

  it("bulan yang dikunci dinilai dengan target bulan itu", () => {
    expect(resolveMonthlyTarget("2026-08", targets)).toEqual({
      target: 30_000_000,
      fromHistory: true,
    });
  });

  it("bulan yang belum dikunci jatuh ke target sekarang, TAPI ditandai", () => {
    // Penandaan ini yang dipakai layar untuk bilang terus terang bahwa
    // patokannya bukan target bulan itu.
    expect(resolveMonthlyTarget("2026-06", targets)).toEqual({
      target: 40_000_000,
      fromHistory: false,
    });
  });

  it('target 0 yang dikunci TIDAK jatuh ke target sekarang', () => {
    // "Bulan itu targetnya nol" adalah pernyataan yang sah. Kalau 0 dianggap
    // kosong, bulan itu diam-diam dinilai dengan target 40 juta.
    const r = resolveMonthlyTarget("2026-05", {
      ...targets,
      monthlyHistory: { "2026-05": 0 },
    });
    expect(r).toEqual({ target: 0, fromHistory: true });
  });

  it("tanpa target sama sekali → null, bukan 0", () => {
    // null dibaca layar sebagai "tidak usah tampilkan kartunya". Kalau
    // dijadikan 0, kartunya muncul dengan capaian tak hingga.
    expect(resolveMonthlyTarget("2026-08", null)).toEqual({
      target: null,
      fromHistory: false,
    });
    expect(resolveMonthlyTarget("2026-08", {})).toEqual({
      target: null,
      fromHistory: false,
    });
  });

  it("nilai rusak di settings tidak diloloskan", () => {
    const rusak = {
      monthlyRevenue: Number.NaN,
      monthlyHistory: { "2026-08": Number.NaN },
    };
    expect(resolveMonthlyTarget("2026-08", rusak)).toEqual({
      target: null,
      fromHistory: false,
    });
  });
});
