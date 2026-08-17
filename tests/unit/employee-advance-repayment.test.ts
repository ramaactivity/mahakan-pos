import { describe, expect, it } from "vitest";
import {
  postEmployeeAdvanceRepaymentSchema,
  reverseEmployeeAdvanceRepaymentSchema,
} from "@/features/payroll/schemas";
import { planAdvanceDeductions } from "@/features/payroll/payroll-compute-pure";

/**
 * Sesi AE-209 — cicilan kasbon karyawan.
 *
 * Yang dikunci di sini adalah dua hal yang kalau rusak bikin angka salah
 * tanpa error apa pun:
 *  1. potongan gaji dihitung dari SISA kasbon, bukan nominal penuh
 *     (kalau regresi: karyawan yang sudah nyicil kena tagih dua kali);
 *  2. bentuk data cicilan — transfer wajib punya rekening, tunai tidak
 *     boleh bawa rekening (dijaga juga oleh check constraint di DB).
 */

describe("planAdvanceDeductions — potongan gaji dari sisa kasbon", () => {
  it("potong hanya sisa setelah dicicil, bukan nominal penuh", () => {
    const plan = planAdvanceDeductions([
      { id: "a1", employeeId: "e1", amount: 1_000_000, repaidAmount: 400_000 },
    ]);
    expect(plan.sumByEmployee.get("e1")).toBe(600_000);
    expect(plan.idsByEmployee.get("e1")).toEqual(["a1"]);
  });

  it("kasbon yang sudah lunas via cicilan tidak ikut ditarik payroll", () => {
    const plan = planAdvanceDeductions([
      { id: "a1", employeeId: "e1", amount: 500_000, repaidAmount: 500_000 },
    ]);
    expect(plan.sumByEmployee.has("e1")).toBe(false);
    expect(plan.idsByEmployee.has("e1")).toBe(false);
  });

  it("beberapa kasbon per karyawan dijumlahkan; yang lunas di-skip", () => {
    const plan = planAdvanceDeductions([
      { id: "a1", employeeId: "e1", amount: 300_000, repaidAmount: 0 },
      { id: "a2", employeeId: "e1", amount: 200_000, repaidAmount: 50_000 },
      { id: "a3", employeeId: "e1", amount: 100_000, repaidAmount: 100_000 },
      { id: "b1", employeeId: "e2", amount: 250_000, repaidAmount: null },
    ]);
    expect(plan.sumByEmployee.get("e1")).toBe(450_000);
    expect(plan.idsByEmployee.get("e1")).toEqual(["a1", "a2"]);
    expect(plan.sumByEmployee.get("e2")).toBe(250_000);
  });

  it("repaidAmount kosong/undefined dianggap 0 (data lama pra-AE-209)", () => {
    const plan = planAdvanceDeductions([
      { id: "a1", employeeId: "e1", amount: 200_000 },
    ]);
    expect(plan.sumByEmployee.get("e1")).toBe(200_000);
  });

  it("tidak pernah menghasilkan potongan negatif", () => {
    /* Pertahanan kalau repaid_amount sempat kebablasan (mestinya dicegah
     * check constraint) — jangan sampai malah NAMBAH gaji. */
    const plan = planAdvanceDeductions([
      { id: "a1", employeeId: "e1", amount: 100_000, repaidAmount: 150_000 },
    ]);
    expect(plan.sumByEmployee.has("e1")).toBe(false);
  });
});

describe("postEmployeeAdvanceRepaymentSchema", () => {
  const base = {
    advanceId: "11111111-1111-4111-8111-111111111111",
    amount: 100_000,
    occurredAt: "2026-08-17",
  };
  const bankId = "22222222-2222-4222-8222-222222222222";

  it("terima setoran tunai tanpa rekening", () => {
    const res = postEmployeeAdvanceRepaymentSchema.safeParse({
      ...base,
      method: "cash",
    });
    expect(res.success).toBe(true);
  });

  it("terima transfer dengan rekening", () => {
    const res = postEmployeeAdvanceRepaymentSchema.safeParse({
      ...base,
      method: "transfer",
      bankAccountId: bankId,
    });
    expect(res.success).toBe(true);
  });

  it("tolak transfer tanpa rekening", () => {
    const res = postEmployeeAdvanceRepaymentSchema.safeParse({
      ...base,
      method: "transfer",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(["bankAccountId"]);
    }
  });

  it("tolak tunai yang bawa rekening (bentuk data tidak konsisten)", () => {
    const res = postEmployeeAdvanceRepaymentSchema.safeParse({
      ...base,
      method: "cash",
      bankAccountId: bankId,
    });
    expect(res.success).toBe(false);
  });

  it("tolak nominal nol / negatif", () => {
    for (const amount of [0, -5000]) {
      const res = postEmployeeAdvanceRepaymentSchema.safeParse({
        ...base,
        amount,
        method: "cash",
      });
      expect(res.success).toBe(false);
    }
  });

  it("tolak tanggal bukan YYYY-MM-DD", () => {
    const res = postEmployeeAdvanceRepaymentSchema.safeParse({
      ...base,
      occurredAt: "17-08-2026",
      method: "cash",
    });
    expect(res.success).toBe(false);
  });

  it("catatan kosong dinormalkan jadi null", () => {
    const res = postEmployeeAdvanceRepaymentSchema.safeParse({
      ...base,
      method: "cash",
      description: "   ",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.description).toBeNull();
  });
});

describe("reverseEmployeeAdvanceRepaymentSchema", () => {
  it("wajib alasan minimal 5 karakter", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(
      reverseEmployeeAdvanceRepaymentSchema.safeParse({ id, reason: "abc" })
        .success,
    ).toBe(false);
    expect(
      reverseEmployeeAdvanceRepaymentSchema.safeParse({
        id,
        reason: "salah input nominal",
      }).success,
    ).toBe(true);
  });
});
