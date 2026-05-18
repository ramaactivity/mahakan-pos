import { z } from "zod";

const NAME_MIN = 1;
const NAME_MAX = 80;
const UNIT_MAX = 16;
const NOTES_MAX = 500;
const REASON_MIN = 3;
const REASON_MAX = 200;

const qtyPositive = z
  .number()
  .int()
  .positive("Jumlah harus lebih dari 0")
  .max(10_000_000_000, "Jumlah terlalu besar");

const qtyNonNeg = z
  .number()
  .int()
  .nonnegative()
  .max(10_000_000_000, "Jumlah terlalu besar");

const qtyDelta = z
  .number()
  .int()
  .refine((v) => v !== 0, "Delta tidak boleh 0")
  .refine(
    (v) => Math.abs(v) <= 10_000_000_000,
    "Delta terlalu besar",
  );

const costNonNeg = z
  .number()
  .int()
  .nonnegative("Harga harus >= 0")
  .max(999_999_999, "Harga terlalu besar");

const sectionEnum = z
  .enum(["kitchen", "bar", "supporting", "cleaning"])
  .nullable()
  .optional();

export const createIngredientSchema = z
  .object({
    name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
    unit: z.string().trim().min(1).max(UNIT_MAX),
    costPerUnit: costNonNeg,
    initialStock: qtyNonNeg,
    reorderThreshold: qtyNonNeg.nullable().optional(),
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    isPreparation: z.boolean().optional().default(false),
    preparationYield: qtyPositive.nullable().optional(),
    section: sectionEnum,
  })
  .refine(
    (v) => !v.isPreparation || (v.preparationYield != null),
    {
      message: "preparation_yield wajib jika isPreparation=true",
      path: ["preparationYield"],
    },
  );

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;

/** Sesi AE-62y — pack conversion entry. Validasi:
 *   - unitLabel non-empty trim, max 20 chars
 *   - qtyPerBase > 0, integer atau decimal
 *   - Tidak ada server-side dedup di sini (client tanggung supaya UI
 *     bisa kasih error message inline). Server validate via .refine */
export const packConversionEntrySchema = z.object({
  unitLabel: z.string().trim().min(1).max(20),
  qtyPerBase: z.number().positive().max(1_000_000),
});
export type PackConversionEntry = z.infer<typeof packConversionEntrySchema>;

export const packConversionsSchema = z
  .array(packConversionEntrySchema)
  .max(10)
  .refine(
    (arr) => {
      const labels = arr.map((p) => p.unitLabel.trim().toLowerCase());
      return new Set(labels).size === labels.length;
    },
    { message: "Label satuan tidak boleh duplikat (case-insensitive)" },
  );

export const updateIngredientSchema = z
  .object({
    name: z.string().trim().min(NAME_MIN).max(NAME_MAX).optional(),
    unit: z.string().trim().min(1).max(UNIT_MAX).optional(),
    costPerUnit: costNonNeg.optional(),
    reorderThreshold: qtyNonNeg.nullable().optional(),
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    isActive: z.boolean().optional(),
    preparationYield: qtyPositive.nullable().optional(),
    section: sectionEnum,
    /** Sesi AE-62y — opt-in pack conversion mappings. Null = wipe. */
    packConversions: packConversionsSchema.nullable().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Minimal satu field harus diisi",
  );

export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;

export const bulkAssignSectionSchema = z.object({
  ingredientIds: z
    .array(z.uuid())
    .min(1, "Pilih minimal 1 bahan")
    .max(500, "Terlalu banyak bahan dalam 1 batch"),
  section: z
    .enum(["kitchen", "bar", "supporting", "cleaning"])
    .nullable(),
});

export type BulkAssignSectionInput = z.infer<typeof bulkAssignSectionSchema>;

export const receiveStockSchema = z.object({
  ingredientId: z.uuid(),
  qty: qtyPositive,
  unitCost: costNonNeg,
  updateCost: z.boolean().optional().default(true),
  note: z.string().trim().max(NOTES_MAX).nullable().optional(),
});

export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

export const adjustStockSchema = z.object({
  ingredientId: z.uuid(),
  delta: qtyDelta,
  reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const recordWasteSchema = z.object({
  ingredientId: z.uuid(),
  qty: qtyPositive,
  reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
});

export type RecordWasteInput = z.infer<typeof recordWasteSchema>;

const recipeIngredientLineSchema = z.object({
  ingredientId: z.uuid(),
  qty: qtyPositive,
});

const ingredientsListSchema = z
  .array(recipeIngredientLineSchema)
  .min(1, "Minimal 1 bahan")
  .max(40, "Terlalu banyak bahan dalam satu resep")
  .refine(
    (lines) => {
      const ids = lines.map((l) => l.ingredientId);
      return new Set(ids).size === ids.length;
    },
    "Bahan tidak boleh duplikat",
  );

const recipeVariantSchema = z.enum(["hot", "iced"]).nullable().optional();

const wasteFactorPct = z
  .number()
  .int()
  .min(0, "Q Factor tidak boleh negatif")
  .max(200, "Q Factor maksimal 200%");

export const createRecipeSchema = z
  .object({
    menuItemId: z.uuid().nullable().optional(),
    ingredientId: z.uuid().nullable().optional(),
    variant: recipeVariantSchema,
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    wasteFactorPct: wasteFactorPct.optional(),
    ingredients: ingredientsListSchema,
  })
  .refine(
    (v) => {
      const isMenu = !!v.menuItemId && !v.ingredientId;
      const isPrep = !v.menuItemId && !!v.ingredientId;
      // XOR + D5 (no variant on prep recipes) in a single check.
      if (!isMenu && !isPrep) return false;
      if (isPrep && v.variant != null) return false;
      return true;
    },
    "Resep harus target satu dari menu_item ATAU ingredient (XOR), dan preparation tidak boleh punya variant",
  );

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = z
  .object({
    variant: recipeVariantSchema,
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    wasteFactorPct: wasteFactorPct.optional(),
    ingredients: ingredientsListSchema.optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Minimal satu field harus diisi",
  );

export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
