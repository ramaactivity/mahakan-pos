import { z } from "zod";

const MAX_RUPIAH = 999_999_999_999; // 999 milyar

const isoDateOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .optional()
  .nullable();

const moneyPos = z.number().int().positive().max(MAX_RUPIAH);

export const createInternalDebtPartySchema = z.object({
  name: z.string().trim().min(2).max(120),
  partyType: z.enum(["owner", "manager", "staff", "other"]).optional(),
  phone: z.string().trim().max(30).nullish(),
  bankName: z.string().trim().max(60).nullish(),
  bankAccountNumber: z.string().trim().max(40).nullish(),
  bankAccountHolderName: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const updateInternalDebtPartySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120).optional(),
  partyType: z.enum(["owner", "manager", "staff", "other"]).optional(),
  phone: z.string().trim().max(30).nullish(),
  bankName: z.string().trim().max(60).nullish(),
  bankAccountNumber: z.string().trim().max(40).nullish(),
  bankAccountHolderName: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const postInternalDebtEntrySchema = z
  .object({
    partyId: z.string().uuid(),
    kind: z.enum(["expense_advance", "cash_loan"]),
    amount: moneyPos,
    occurredAt: isoDateOptional,
    description: z.string().trim().min(3).max(200),
    categoryId: z.string().uuid().nullish(),
    bankAccountId: z.string().uuid().nullish(),
  })
  .refine((v) => v.kind !== "expense_advance" || !!v.categoryId, {
    message: "Pilih kategori pengeluaran untuk talangan biaya",
    path: ["categoryId"],
  })
  .refine((v) => v.kind !== "cash_loan" || !!v.bankAccountId, {
    message: "Pilih rekening bisnis penerima pinjaman tunai",
    path: ["bankAccountId"],
  });

export const postInternalDebtRepaymentSchema = z.object({
  partyId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  amount: moneyPos,
  occurredAt: isoDateOptional,
  description: z.string().trim().max(500).nullish(),
  /* Sesi AE-209 — bukti transfer opsional (URL Drive dari endpoint
   * /api/v1/journal-receipts/upload). Disaring `normalizeReceiptUrl`
   * di action sebelum masuk DB. */
  receiptImageUrl: z.string().trim().max(1000).nullish(),
});

export const reverseInternalDebtSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter").max(500),
});

export type CreateInternalDebtPartyParsed = z.infer<
  typeof createInternalDebtPartySchema
>;
export type PostInternalDebtEntryParsed = z.infer<
  typeof postInternalDebtEntrySchema
>;
export type PostInternalDebtRepaymentParsed = z.infer<
  typeof postInternalDebtRepaymentSchema
>;
