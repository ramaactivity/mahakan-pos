import { describe, expect, it } from "vitest";
import {
  cancelReasonProblem,
  formatCancelReason,
  normalizeBillRef,
} from "@/features/transactions/cancel-reason";

describe("cancel open bill reasons (AE-240)", () => {
  it("refuses 'moved to bill' without a target bill (the Sekal case)", () => {
    expect(cancelReasonProblem({ reasonCode: "moved_to_bill", targetBill: "" })).toMatch(/bill tujuan/);
    expect(cancelReasonProblem({ reasonCode: "moved_to_bill", targetBill: "0015" })).toBeNull();
  });

  it("requires ticked items for out of stock, and a real explanation for other", () => {
    expect(cancelReasonProblem({ reasonCode: "out_of_stock", itemIds: [] })).toMatch(/Centang/);
    expect(cancelReasonProblem({ reasonCode: "out_of_stock", itemIds: ["a"] })).toBeNull();
    expect(cancelReasonProblem({ reasonCode: "other", detail: "salah" })).toMatch(/10 huruf/);
    expect(cancelReasonProblem({ reasonCode: "customer_left", detail: "" })).toMatch(/wajib/);
  });

  it("formats a readable reason and normalizes bill refs", () => {
    expect(
      formatCancelReason("out_of_stock", { itemNames: ["1× Brownie Ice Cream"], detail: "" }),
    ).toBe("Stok habis — 1× Brownie Ice Cream");
    expect(formatCancelReason("moved_to_bill", { targetNumber: "TRX-20260826-0015" })).toBe(
      "Pindah ke bill lain — ke TRX-20260826-0015",
    );
    expect(normalizeBillRef("15")).toEqual({ full: null, suffix: "0015" });
    expect(normalizeBillRef("trx-20260826-0015")).toEqual({ full: "TRX-20260826-0015", suffix: null });
    expect(normalizeBillRef("bill wida")).toEqual({ full: null, suffix: null });
  });
});
