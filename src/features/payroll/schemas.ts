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

export const createEmployeeAdvanceSchema = z.object({
  employeeId: z.uuid(),
  amount: advanceMoneyPos,
  reason: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  issuedDate: dateString,
});

export const forgiveEmployeeAdvanceSchema = z.object({
  id: z.uuid(),
});
