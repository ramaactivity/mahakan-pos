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
  otherDeductions: moneyNonneg.optional(),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
});
