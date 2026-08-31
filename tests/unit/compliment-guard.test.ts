import { describe, expect, it } from "vitest";
import { requiresPinApprover } from "@/features/approval-codes/compliment-guard";

/* Sesi AE-221 — pemeriksaan kode approval compliment (checkComplimentApproval)
 * dihapus bersama alur kode 6 digit; compliment kini dijaga PIN statis yang
 * diverifikasi server. Yang tersisa di sini adalah gerbang PIN APPROVER untuk
 * diskon biasa, yang HARUS tetap melewatkan compliment — kalau tidak, kasir
 * kembali buntu seperti AE-208. */

describe("requiresPinApprover", () => {
  it("compliment kasir TIDAK butuh PIN approver (cukup kode Owner)", () => {
    expect(
      requiresPinApprover({
        discountAmount: 41000,
        role: "staff",
        isCompliment: true,
      }),
    ).toBe(false);
  });

  it("diskon biasa kasir tetap butuh PIN approver", () => {
    expect(
      requiresPinApprover({
        discountAmount: 41000,
        role: "staff",
        isCompliment: false,
      }),
    ).toBe(true);
  });

  it("tanpa diskon tidak pernah butuh PIN", () => {
    expect(
      requiresPinApprover({
        discountAmount: 0,
        role: "staff",
        isCompliment: false,
      }),
    ).toBe(false);
  });

  it("non-staff tidak lewat jalur PIN", () => {
    expect(
      requiresPinApprover({
        discountAmount: 41000,
        role: "manager",
        isCompliment: false,
      }),
    ).toBe(false);
  });
});
