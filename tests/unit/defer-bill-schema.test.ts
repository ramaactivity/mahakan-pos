import { describe, expect, it } from "vitest";
import { deferOpenBillSchema } from "@/features/transactions/schemas";

const base = {
  transactionId: "8f2c1c3e-1b2a-4c3d-9e8f-0a1b2c3d4e5f",
  guarantor: "Adul (karyawan)",
  dueDate: "2026-10-02",
  reasonCode: "guest_left",
  effort: "Maul WA & telepon jam 22.40, tidak diangkat",
  approverToken: "tok",
};

describe("bayar belakangan is a last resort (AE-241)", () => {
  it("accepts a complete request", () => {
    expect(deferOpenBillSchema.safeParse(base).success).toBe(true);
  });
  it("has no 'guest asked to owe' reason", () => {
    expect(deferOpenBillSchema.safeParse({ ...base, reasonCode: "asked_to_owe" }).success).toBe(false);
  });
  it("requires a written effort, a guarantor and an approver PIN token", () => {
    expect(deferOpenBillSchema.safeParse({ ...base, effort: "ga bisa" }).success).toBe(false);
    expect(deferOpenBillSchema.safeParse({ ...base, guarantor: "" }).success).toBe(false);
    expect(deferOpenBillSchema.safeParse({ ...base, approverToken: "" }).success).toBe(false);
  });
});
