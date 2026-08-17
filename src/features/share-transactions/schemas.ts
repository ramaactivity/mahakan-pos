import { z } from "zod";

const MAX_RUPIAH = 999_999_999_999;
const isoDateOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .optional()
  .nullable();

const sharePctDelta = z
  .number()
  .gt(0, "Share delta harus > 0")
  .max(100, "Share delta max 100%");

export const transferShareP2PSchema = z
  .object({
    fromInvestorId: z.string().uuid(),
    toInvestorId: z.string().uuid(),
    sharePctDelta,
    description: z.string().trim().max(500).nullish(),
    occurredAt: isoDateOptional,
  })
  .refine((v) => v.fromInvestorId !== v.toInvestorId, {
    message: "From dan To investor tidak boleh sama",
    path: ["toInvestorId"],
  });

export const companyBuybackSchema = z.object({
  fromInvestorId: z.string().uuid(),
  sharePctDelta,
  amountIdr: z.number().int().positive().max(MAX_RUPIAH),
  bankAccountId: z.string().uuid(),
  description: z.string().trim().max(500).nullish(),
  occurredAt: isoDateOptional,
  /** Sesi AE-208 — bukti transfer (URL Drive). Disaring lagi server-side. */
  receiptImageUrl: z.string().trim().max(2000).nullish(),
});

export const reverseShareTransactionSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

export type TransferShareP2PParsed = z.infer<typeof transferShareP2PSchema>;
export type CompanyBuybackParsed = z.infer<typeof companyBuybackSchema>;
export type ReverseShareTransactionParsed = z.infer<
  typeof reverseShareTransactionSchema
>;
