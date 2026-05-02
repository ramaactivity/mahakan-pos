import { z } from "zod";

const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cogs",
  "expense",
] as const;

const NORMAL_BALANCES = ["debit", "credit"] as const;

/**
 * Account code: 4-digit numeric (1xxx-6xxx). Owner can create custom codes
 * dalam range 1xxx-6xxx; per type guard di action.
 */
export const accountCodeSchema = z
  .string()
  .regex(/^[1-6]\d{3}$/, "Kode akun harus 4 digit numerik (1xxx–6xxx)");

export const createAccountSchema = z.object({
  code: accountCodeSchema,
  name: z.string().trim().min(2, "Nama akun minimal 2 karakter").max(120),
  type: z.enum(ACCOUNT_TYPES),
  normalBalance: z.enum(NORMAL_BALANCES),
  parentCode: z
    .string()
    .regex(/^\d{4}$/)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  isContra: z.boolean().optional().default(false),
  displayOrder: z.number().int().min(0).max(9999).optional().default(0),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const updateAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120).optional(),
  parentCode: z.string().regex(/^\d{4}$/).nullish(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  notes: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});

export const deactivateAccountSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Validate that account `type` ↔ `normalBalance` follows accounting rules.
 * - asset / cogs / expense → normally debit (kontra-asset bisa credit)
 * - liability / equity / revenue → normally credit (kontra bisa debit)
 *
 * Used app-side; not a DB constraint karena kontra accounts allow flip.
 */
export function isNormalBalanceValid(
  type: (typeof ACCOUNT_TYPES)[number],
  normalBalance: (typeof NORMAL_BALANCES)[number],
  isContra: boolean,
): boolean {
  const debitNormal = ["asset", "cogs", "expense"].includes(type);
  const expected = debitNormal ? "debit" : "credit";
  if (isContra) {
    return normalBalance === (expected === "debit" ? "credit" : "debit");
  }
  return normalBalance === expected;
}

export type CreateAccountInputZ = z.infer<typeof createAccountSchema>;
export type UpdateAccountInputZ = z.infer<typeof updateAccountSchema>;
