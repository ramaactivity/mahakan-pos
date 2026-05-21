import { z } from "zod";

const MAX_RUPIAH = 999_999_999_999; // 999 milyar

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
const isoDateOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .optional()
  .nullable();

const moneyNonNeg = z.number().int().min(0).max(MAX_RUPIAH);
const moneyPos = z.number().int().positive().max(MAX_RUPIAH);

export const createCreditorSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    nickname: z.string().trim().max(60).nullish(),
    nik: z.string().trim().regex(/^\d{0,20}$/, "NIK angka saja").nullish(),
    email: z.string().trim().email().nullish().or(z.literal("").transform(() => null)),
    phone: z.string().trim().max(30).nullish(),
    address: z.string().trim().max(500).nullish(),
    bankName: z.string().trim().max(60).nullish(),
    bankAccountNumber: z.string().trim().max(40).nullish(),
    bankAccountHolderName: z.string().trim().max(120).nullish(),
    principalOriginal: moneyPos,
    interestRatePct: z.number().min(0).max(100).optional(),
    interestPeriod: z.enum(["monthly", "yearly", "flat"]).optional(),
    startDate: isoDate,
    dueDate: isoDateOptional,
    notes: z.string().trim().max(1000).nullish(),
  })
  .refine(
    (v) =>
      !v.dueDate || (typeof v.dueDate === "string" && v.dueDate >= v.startDate),
    {
      message: "Tanggal jatuh tempo harus >= tanggal mulai",
      path: ["dueDate"],
    },
  );

/* Zod v4: refine wraps schema; we manually construct update schema dengan
 * partial fields + id + status (tidak pakai .innerType() yang ga ada). */
export const updateCreditorSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(2).max(120).optional(),
  nickname: z.string().trim().max(60).nullish(),
  nik: z.string().trim().regex(/^\d{0,20}$/).nullish(),
  email: z.string().trim().email().nullish().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(500).nullish(),
  bankName: z.string().trim().max(60).nullish(),
  bankAccountNumber: z.string().trim().max(40).nullish(),
  bankAccountHolderName: z.string().trim().max(120).nullish(),
  principalOriginal: moneyPos.optional(),
  interestRatePct: z.number().min(0).max(100).optional(),
  interestPeriod: z.enum(["monthly", "yearly", "flat"]).optional(),
  startDate: isoDate.optional(),
  dueDate: isoDateOptional,
  notes: z.string().trim().max(1000).nullish(),
  status: z.enum(["active", "settled", "defaulted"]).optional(),
});

export const postRepaymentSchema = z
  .object({
    creditorId: z.string().uuid(),
    bankAccountId: z.string().uuid(),
    principalAmount: moneyNonNeg,
    interestAmount: moneyNonNeg.optional(),
    occurredAt: isoDateOptional,
    description: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.principalAmount + (v.interestAmount ?? 0) > 0, {
    message: "Total cicilan (pokok + bunga) harus > 0",
    path: ["principalAmount"],
  });

export const reverseRepaymentSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter").max(500),
});

export type CreateCreditorParsed = z.infer<typeof createCreditorSchema>;
export type UpdateCreditorParsed = z.infer<typeof updateCreditorSchema>;
export type PostRepaymentParsed = z.infer<typeof postRepaymentSchema>;
export type ReverseRepaymentParsed = z.infer<typeof reverseRepaymentSchema>;
