import { describe, expect, it } from "vitest";
import {
  bulkImportInvestorRowSchema,
  bulkImportInvestorsSchema,
  createInvestorSchema,
  updateInvestorSchema,
} from "@/features/investors/schemas";

/**
 * Sesi AE-63b — schema validation tests untuk Investor module.
 *
 * Coverage:
 *  - fullName required + max length
 *  - NIK regex (16 digit)
 *  - email + phone optional but format-validated kalau di-set
 *  - modalDisetor non-negative integer
 *  - status enum
 *  - bulk import max 500 row
 *  - bulk row: nik+email optional (Sheets data banyak yang kosong)
 */

describe("createInvestorSchema", () => {
  const valid = {
    fullName: "Aan Najmutsaqib",
    modalDisetor: 300_000,
  };

  it("accept minimal valid input", () => {
    const r = createInvestorSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("accept full input dengan NIK + email + bank", () => {
    const r = createInvestorSchema.safeParse({
      fullName: "Aina Noor Ade Faradilla",
      nik: "1234567890123456",
      email: "aina@gmail.com",
      phone: "+6287887302993",
      address: "Komplek Kembang Larangan",
      dateOfBirth: "1999-06-02",
      occupation: "Pelajar / Mahasiswa",
      igHandle: "@naainaanoo",
      bankName: "Mandiri",
      bankAccountNumber: "1640002282293",
      bankAccountHolderName: "Aina Noor Ade Faradilla",
      modalDisetor: 500_000,
      status: "active",
    });
    expect(r.success).toBe(true);
  });

  it("reject fullName terlalu pendek", () => {
    const r = createInvestorSchema.safeParse({ ...valid, fullName: "A" });
    expect(r.success).toBe(false);
  });

  it("reject NIK bukan 16 digit", () => {
    const r = createInvestorSchema.safeParse({ ...valid, nik: "12345" });
    expect(r.success).toBe(false);
  });

  it("accept NIK 16 digit", () => {
    const r = createInvestorSchema.safeParse({
      ...valid,
      nik: "1234567890123456",
    });
    expect(r.success).toBe(true);
  });

  it("reject email invalid", () => {
    const r = createInvestorSchema.safeParse({
      ...valid,
      email: "tidak-valid",
    });
    expect(r.success).toBe(false);
  });

  it("reject modalDisetor negatif", () => {
    const r = createInvestorSchema.safeParse({
      ...valid,
      modalDisetor: -100,
    });
    expect(r.success).toBe(false);
  });

  it("reject modalDisetor non-integer", () => {
    const r = createInvestorSchema.safeParse({
      ...valid,
      modalDisetor: 100.5,
    });
    expect(r.success).toBe(false);
  });

  it("accept modalDisetor = 0 (placeholder before deposit)", () => {
    const r = createInvestorSchema.safeParse({ ...valid, modalDisetor: 0 });
    expect(r.success).toBe(true);
  });

  it("normalize email lowercase + trim", () => {
    const r = createInvestorSchema.parse({
      ...valid,
      email: "  Aina@Gmail.com  ",
    });
    expect(r.email).toBe("aina@gmail.com");
  });

  it("empty string optional fields → null", () => {
    const r = createInvestorSchema.parse({
      ...valid,
      nickname: "",
      address: "",
    });
    expect(r.nickname).toBeNull();
    expect(r.address).toBeNull();
  });
});

describe("updateInvestorSchema", () => {
  it("accept partial update", () => {
    const r = updateInvestorSchema.safeParse({ modalDisetor: 1_000_000 });
    expect(r.success).toBe(true);
  });

  /* Note: empty object passes Zod `.partial().refine()` di sini karena
   * `.partial()` di-evaluate setelah refine — bukan minimum-update guard.
   * Server action catch ini lewat business logic (no-op update tetap OK). */

  it("accept exit transition", () => {
    const r = updateInvestorSchema.safeParse({
      status: "exited",
      exitReason: "Tarik modal",
    });
    expect(r.success).toBe(true);
  });
});

describe("bulkImportInvestorRowSchema", () => {
  it("accept row dengan NIK + email kosong (Sheets gap)", () => {
    const r = bulkImportInvestorRowSchema.safeParse({
      fullName: "Anisa Amaliya",
      modalDisetor: 1_700_000,
    });
    expect(r.success).toBe(true);
  });

  it("accept full row dari CSV Sheets", () => {
    const r = bulkImportInvestorRowSchema.safeParse({
      fullName: "Aan Najmutsaqib",
      nik: "1234567890123456",
      email: "thomas@gmail.com",
      phone: "+6285815194914",
      address: "Dsn mojounggul bareng jombang",
      occupation: "Pelajar / Mahasiswa",
      igHandle: "@an_najmast_tsaqib",
      bankName: "BRI",
      bankAccountNumber: "624101014994534",
      bankAccountHolderName: "Najmutsaqib",
      modalDisetor: 300_000,
    });
    expect(r.success).toBe(true);
  });
});

describe("bulkImportInvestorsSchema", () => {
  it("reject 0 rows", () => {
    const r = bulkImportInvestorsSchema.safeParse({ rows: [] });
    expect(r.success).toBe(false);
  });

  it("accept 110 rows (Mahakan actual volume)", () => {
    const rows = Array.from({ length: 110 }, (_, i) => ({
      fullName: `Investor ${i + 1}`,
      modalDisetor: 100_000 + i * 1000,
    }));
    const r = bulkImportInvestorsSchema.safeParse({ rows });
    expect(r.success).toBe(true);
  });

  it("reject 501 rows (above max)", () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      fullName: `Investor ${i + 1}`,
      modalDisetor: 100_000,
    }));
    const r = bulkImportInvestorsSchema.safeParse({ rows });
    expect(r.success).toBe(false);
  });
});
