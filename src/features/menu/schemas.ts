import { z } from "zod";
import { isValidPriceRange } from "@/lib/money";

const NAME_MIN = 1;
const NAME_MAX = 80;

const priceSchema = z
  .number()
  .int()
  .refine(isValidPriceRange, "Harga harus Rp 1.000 - 999.999.999");

const baseFields = {
  name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
  description: z.string().trim().max(200).nullable().optional(),
  categoryId: z.uuid(),
  isSignature: z.boolean().optional().default(false),
  displayOrder: z.number().int().nonnegative().optional().default(999),
  /** Sesi AE-173 — HPP manual (Rp). NULL/undefined = belum diisi (fallback resep).
   * Dipakai untuk menu fixed/open. */
  cost: z.number().int().nonnegative().max(999_999_999).nullable().optional(),
  /** Sesi AE-175 — HPP manual per varian (Rp). Khusus price_type=variant. */
  costHot: z.number().int().nonnegative().max(999_999_999).nullable().optional(),
  costIced: z.number().int().nonnegative().max(999_999_999).nullable().optional(),
};

export const createMenuItemSchema = z.discriminatedUnion("priceType", [
  z.object({
    ...baseFields,
    priceType: z.literal("fixed"),
    priceFixed: priceSchema,
    priceHot: z.null().optional(),
    priceIced: z.null().optional(),
  }),
  z.object({
    ...baseFields,
    priceType: z.literal("variant"),
    priceFixed: z.null().optional(),
    priceHot: priceSchema.nullable(),
    priceIced: priceSchema.nullable(),
  }),
  z.object({
    ...baseFields,
    priceType: z.literal("open"),
    priceFixed: z.null().optional(),
    priceHot: z.null().optional(),
    priceIced: z.null().optional(),
  }),
]).refine(
  (v) =>
    v.priceType !== "variant" ||
    Boolean(v.priceHot) ||
    Boolean(v.priceIced),
  "Variant harus punya minimal salah satu harga (Hot atau Iced)",
);

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;

export const updateMenuItemSchema = createMenuItemSchema;
export type UpdateMenuItemInput = CreateMenuItemInput;

export const categoryNameSchema = z
  .string()
  .trim()
  .min(NAME_MIN)
  .max(50);

export const reorderDirSchema = z.enum(["up", "down"]);
