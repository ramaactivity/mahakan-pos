import { z } from "zod";

/**
 * Sesi AE-80 — Validation schemas untuk withdrawal flow.
 *
 * Min withdrawal Rp 50.000 (DB CHECK + Zod schema double-defense).
 * Max sanity: Rp 999,999,999 (single-day).
 */

const MIN_WITHDRAWAL = 50_000;
const MAX_SAFE_RUPIAH = 999_999_999;

const isoDateOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .optional()
  .nullable();

export const postWithdrawalSchema = z.object({
  investorId: z.string().uuid(),
  amount: z
    .number()
    .int()
    .min(MIN_WITHDRAWAL, `Minimum withdrawal Rp ${MIN_WITHDRAWAL.toLocaleString("id-ID")}`)
    .max(MAX_SAFE_RUPIAH),
  bankAccountId: z.string().uuid(),
  occurredAt: isoDateOptional,
  description: z.string().trim().max(500).nullish(),
});

export const reverseWithdrawalSchema = z.object({
  id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(5, "Alasan reverse minimal 5 karakter")
    .max(500),
});

export type PostWithdrawalParsed = z.infer<typeof postWithdrawalSchema>;
export type ReverseWithdrawalParsed = z.infer<typeof reverseWithdrawalSchema>;
