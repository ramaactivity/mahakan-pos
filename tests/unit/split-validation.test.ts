import { describe, expect, it } from "vitest";
import {
  findInvalidSplitMethods,
  formatInvalidSplitMethodsError,
} from "@/features/accounting/split-validation";

const VALID = ["cash", "qris", "card_bca"] as const;

const split = (id: string, paymentMethod: string | null) => ({
  id,
  paymentMethod,
});

describe("findInvalidSplitMethods", () => {
  it("semua valid — empty result", () => {
    const r = findInvalidSplitMethods(
      [split("a", "cash"), split("b", "qris")],
      VALID,
    );
    expect(r).toEqual([]);
  });

  it("satu invalid — flagged", () => {
    const r = findInvalidSplitMethods(
      [split("a", "cash"), split("b", "split")],
      VALID,
    );
    expect(r).toHaveLength(1);
    expect(r[0].paymentMethod).toBe("split");
  });

  it("multiple invalid — semua di-flag", () => {
    const r = findInvalidSplitMethods(
      [
        split("a", "cash"),
        split("b", "split"),
        split("c", "unknown_method"),
        split("d", "card_bca"),
      ],
      VALID,
    );
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.paymentMethod)).toEqual([
      "split",
      "unknown_method",
    ]);
  });

  it("null paymentMethod — flagged sebagai invalid", () => {
    const r = findInvalidSplitMethods([split("a", null)], VALID);
    expect(r).toHaveLength(1);
    expect(r[0].paymentMethod).toBeNull();
  });

  it("empty input — empty result", () => {
    expect(findInvalidSplitMethods([], VALID)).toEqual([]);
  });
});

describe("formatInvalidSplitMethodsError", () => {
  it("format dengan context label", () => {
    const msg = formatInvalidSplitMethodsError(
      [
        { id: "11111111-2222-3333-4444-555555555555", paymentMethod: "split" },
      ],
      "pos_sale abc12345",
    );
    expect(msg).toContain("SPLIT_UNKNOWN_PAYMENT_METHOD");
    expect(msg).toContain("pos_sale abc12345");
    expect(msg).toContain("11111111:split");
  });

  it("multiple rows — semua di-include", () => {
    const msg = formatInvalidSplitMethodsError(
      [
        { id: "11111111-aaaa", paymentMethod: "split" },
        { id: "22222222-bbbb", paymentMethod: "unknown" },
      ],
      "pos_refund xyz",
    );
    expect(msg).toContain("2 row invalid");
    expect(msg).toContain("11111111:split");
    expect(msg).toContain("22222222:unknown");
  });

  it("null paymentMethod — render sebagai <null>", () => {
    const msg = formatInvalidSplitMethodsError(
      [{ id: "33333333-cccc", paymentMethod: null }],
      "ctx",
    );
    expect(msg).toContain("33333333:<null>");
  });
});
