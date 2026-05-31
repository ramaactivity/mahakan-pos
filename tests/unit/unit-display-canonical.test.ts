import { describe, expect, it } from "vitest";
import {
  buildUnitSelectOptions,
  displayUnit,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-173 — satuan kanonik untuk display + dropdown anti-blank.
 * Akar masalah: DB simpan "kg" (huruf kecil) tapi dropdown isinya "Kg" →
 * Radix Select gagal cocok → trigger blank. `displayUnit` + buildUnitSelectOptions
 * menjamin value & options selalu pakai bentuk kanonik yang sama.
 */
describe("displayUnit", () => {
  it("normalisasi case registry units ke label UNIT_TABLE", () => {
    expect(displayUnit("kg")).toBe("Kg");
    expect(displayUnit("KG")).toBe("Kg");
    expect(displayUnit("Kg")).toBe("Kg");
    expect(displayUnit("g")).toBe("gr");
    expect(displayUnit("gr")).toBe("gr");
    expect(displayUnit("Gr")).toBe("gr");
    expect(displayUnit("ml")).toBe("ml");
    expect(displayUnit("ML")).toBe("ml");
    expect(displayUnit("l")).toBe("L");
    expect(displayUnit("liter")).toBe("L");
    expect(displayUnit("pcs")).toBe("Pcs");
  });

  it("label custom (tak dikenal) dikembalikan apa adanya (trim)", () => {
    expect(displayUnit("botol")).toBe("botol");
    expect(displayUnit("galon")).toBe("galon");
    expect(displayUnit("  Karung ")).toBe("Karung");
  });

  it("null/empty → string kosong", () => {
    expect(displayUnit(null)).toBe("");
    expect(displayUnit(undefined)).toBe("");
    expect(displayUnit("")).toBe("");
    expect(displayUnit("   ")).toBe("");
  });
});

describe("buildUnitSelectOptions", () => {
  it("nilai 'kg' tersimpan → value kanonik 'Kg' + ada di options (tak blank)", () => {
    const { options, value } = buildUnitSelectOptions({
      presets: ["Kg", "gr", "L", "ml"],
      current: "kg",
    });
    expect(value).toBe("Kg");
    expect(options.some((o) => o.value === "Kg")).toBe(true);
    // tidak ada duplikat "kg" + "Kg"
    expect(options.filter((o) => o.value.toLowerCase() === "kg")).toHaveLength(1);
  });

  it("current selalu ada di options walau bukan bagian presets (label custom)", () => {
    const { options, value } = buildUnitSelectOptions({
      presets: ["Kg", "gr"],
      current: "botol",
    });
    expect(value).toBe("botol");
    expect(options[0]).toEqual({ value: "botol", label: "botol" });
  });

  it("dedup case-insensitive antar presets & pack", () => {
    const { options } = buildUnitSelectOptions({
      presets: ["Kg", "kg", "gr", "g", "GR"],
      packLabels: ["KG"],
      current: "kg",
    });
    const kgs = options.filter((o) => o.value.toLowerCase() === "kg");
    const grs = options.filter((o) => o.value.toLowerCase() === "gr");
    expect(kgs).toHaveLength(1);
    expect(grs).toHaveLength(1);
  });

  it("pack labels diutamakan setelah current, sebelum presets", () => {
    const { options } = buildUnitSelectOptions({
      presets: ["Kg", "gr"],
      packLabels: ["Karung"],
      current: "Pcs",
    });
    expect(options.map((o) => o.value)).toEqual(["Pcs", "Karung", "Kg", "gr"]);
  });

  it("current kosong → value kosong, options dari presets saja", () => {
    const { options, value } = buildUnitSelectOptions({
      presets: ["Kg", "gr"],
      current: null,
    });
    expect(value).toBe("");
    expect(options.map((o) => o.value)).toEqual(["Kg", "gr"]);
  });
});
