import { describe, expect, it } from "vitest";
import {
  EMPTY_VALUE_SENTINEL,
  decodeSelectValue,
  encodeSelectValue,
  hasEmptyOption,
} from "@/components/ui/select-empty-value";

/**
 * Sesi AE-213 — regresi nyata: opsi `{ value: "" }` di modul Aset Tetap
 * membuat Radix Select melempar error dan MENJATUHKAN SELURUH back office
 * (bukan cuma dropdown-nya). Aturan yang dijaga tes ini:
 *
 *   1. tidak ada nilai "" yang boleh lolos ke Radix,
 *   2. pemanggil tetap menerima "" seperti semula,
 *   3. layar yang TIDAK punya opsi kosong tidak boleh ikut berubah —
 *      di sana `value=""` artinya "belum memilih" dan itu yang memunculkan
 *      placeholder.
 */
describe("encodeSelectValue", () => {
  it("mengubah string kosong jadi sentinel", () => {
    expect(encodeSelectValue("")).toBe(EMPTY_VALUE_SENTINEL);
  });

  it("membiarkan nilai lain apa adanya", () => {
    expect(encodeSelectValue("1110")).toBe("1110");
    expect(encodeSelectValue("transfer_bca")).toBe("transfer_bca");
    expect(encodeSelectValue("0")).toBe("0");
  });

  it("tidak pernah menghasilkan string kosong — ini inti bugnya", () => {
    for (const v of ["", "0", "false", " ", "1101", EMPTY_VALUE_SENTINEL]) {
      expect(encodeSelectValue(v)).not.toBe("");
    }
  });
});

describe("decodeSelectValue", () => {
  it("mengembalikan sentinel jadi string kosong", () => {
    expect(decodeSelectValue(EMPTY_VALUE_SENTINEL)).toBe("");
  });

  it("bolak-balik utuh", () => {
    for (const v of ["", "1110", "transfer_other", "0"]) {
      expect(decodeSelectValue(encodeSelectValue(v))).toBe(v);
    }
  });

  it("membiarkan nilai lain apa adanya", () => {
    expect(decodeSelectValue("1110")).toBe("1110");
  });
});

describe("hasEmptyOption", () => {
  it("true kalau ada opsi kosong di daftar datar", () => {
    expect(
      hasEmptyOption([
        { value: "", label: "— pakai bawaan —" },
        { value: "2101", label: "Hutang Dagang" },
      ] as Array<{ value: string; label: string }>),
    ).toBe(true);
  });

  it("true kalau opsi kosongnya ada di dalam group", () => {
    expect(
      hasEmptyOption(undefined, [
        { options: [{ value: "1101" }] },
        { options: [{ value: "" }] },
      ]),
    ).toBe(true);
  });

  it("false kalau tidak ada opsi kosong — layar lain tidak boleh berubah", () => {
    expect(hasEmptyOption([{ value: "1101" }, { value: "1110" }])).toBe(false);
    expect(hasEmptyOption(undefined, undefined)).toBe(false);
    expect(hasEmptyOption([], [])).toBe(false);
  });
});
