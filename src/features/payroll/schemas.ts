import { z } from "zod";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");
const moneyNonneg = z.number().int().min(0).max(999_999_999);

export const createPayrollPeriodSchema = z.object({
  label: z.string().trim().min(1).max(100),
  periodStart: dateString,
  periodEnd: dateString,
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
});

export const updatePayrollLineSchema = z.object({
  id: z.uuid(),
  baseSalary: moneyNonneg.optional(),
  overtimePay: moneyNonneg.optional(),
  lateDeduction: moneyNonneg.optional(),
  bonus: moneyNonneg.optional(),
  /** Sesi AE-60 — Tunjangan Hari Raya (manual atau via computeThr). */
  thr: moneyNonneg.optional(),
  /** Sesi AE-60 — manual override advanceDeduction (biasanya auto-fill
   * dari employee_advances). */
  advanceDeduction: moneyNonneg.optional(),
  otherDeductions: moneyNonneg.optional(),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
});

/* Sesi AE-60 — Force flag untuk recompute kalau ada manual edits. */
export const computePayrollLinesSchema = z.object({
  periodId: z.uuid(),
  /** True kalau owner sudah konfirmasi recompute akan timpa manual edits. */
  force: z.boolean().optional().default(false),
});

/* Sesi AE-60 — Apply THR ke semua line di period. */
export const applyThrSchema = z.object({
  periodId: z.uuid(),
  /** Multiplier override (default outlet.payroll.thrMonthlyBaseMultiplier
   * atau 1.0 kalau tidak set). */
  multiplier: z.number().positive().max(10).optional(),
});

/* Sesi AE-60 — Employee Advance (Kasbon). */
const advanceMoneyPos = z.number().int().positive().max(999_999_999);

export const createEmployeeAdvanceSchema = z
  .object({
    employeeId: z.uuid(),
    amount: advanceMoneyPos,
    reason: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((s) => (s && s.length > 0 ? s : null)),
    issuedDate: dateString,
    /* Sesi AE-209b — uang kasbon diambil dari mana. Menentukan lawan jurnal
     * Dr 1155 Piutang Kasbon. 'opening_balance' = kasbon lama yang uangnya
     * sudah keluar sebelum kasbon masuk pembukuan → tanpa jurnal.
     * Default 'cash' menjaga pemanggil lama tetap sah. */
    fundingSource: z
      .enum(["cash", "bank", "opening_balance"])
      .optional()
      .default("cash"),
    bankAccountId: z.uuid().nullish(),
  })
  .refine((v) => v.fundingSource !== "bank" || !!v.bankAccountId, {
    message: "Pilih rekening sumber uang kasbon",
    path: ["bankAccountId"],
  })
  .refine((v) => v.fundingSource === "bank" || !v.bankAccountId, {
    message: "Rekening hanya dipakai kalau uangnya dari bank",
    path: ["bankAccountId"],
  });

export const forgiveEmployeeAdvanceSchema = z.object({
  id: z.uuid(),
});

/* Sesi AE-209 — Cicilan kasbon (karyawan setor balik di luar potong gaji). */
export const postEmployeeAdvanceRepaymentSchema = z
  .object({
    advanceId: z.uuid(),
    amount: advanceMoneyPos,
    /** 'cash' = setor tunai; 'transfer' = masuk rekening bisnis. */
    method: z.enum(["cash", "transfer"]),
    bankAccountId: z.uuid().nullish(),
    occurredAt: dateString,
    description: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((s) => (s && s.length > 0 ? s : null)),
    receiptImageUrl: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => v.method !== "transfer" || !!v.bankAccountId, {
    message: "Pilih rekening bisnis penerima transfer",
    path: ["bankAccountId"],
  })
  .refine((v) => v.method !== "cash" || !v.bankAccountId, {
    message: "Setoran tunai tidak perlu rekening",
    path: ["bankAccountId"],
  });

export const reverseEmployeeAdvanceRepaymentSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter").max(500),
});
