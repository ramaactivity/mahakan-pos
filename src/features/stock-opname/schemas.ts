import { z } from "zod";

const PERIOD_MAX = 40;
const NOTES_MAX = 500;
const REASON_MIN = 3;
const REASON_MAX = 200;
const NOTE_LINE_MAX = 200;

const qtyNonNeg = z
  .number()
  .int()
  .nonnegative("Jumlah tidak boleh negatif")
  .max(10_000_000_000, "Jumlah terlalu besar");

export const startOpnameSchema = z.object({
  periodLabel: z.string().trim().min(1).max(PERIOD_MAX).optional(),
  notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
});

export const saveCountSchema = z.object({
  sessionId: z.uuid(),
  ingredientId: z.uuid(),
  actualQty: qtyNonNeg.nullable(),
  note: z.string().trim().max(NOTE_LINE_MAX).nullable().optional(),
});

export const saveCountBatchSchema = z.object({
  sessionId: z.uuid(),
  lines: z
    .array(
      z.object({
        ingredientId: z.uuid(),
        actualQty: qtyNonNeg.nullable(),
        note: z.string().trim().max(NOTE_LINE_MAX).nullable().optional(),
      }),
    )
    .min(1, "Minimal 1 baris")
    .max(500, "Terlalu banyak baris dalam 1 batch"),
});

export const submitOpnameSchema = z.object({
  sessionId: z.uuid(),
  treatUncountedAsExpected: z.boolean().optional(),
});

export const finalizeOpnameSchema = z.object({
  sessionId: z.uuid(),
});

export const cancelOpnameSchema = z.object({
  sessionId: z.uuid(),
  reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
});

export const reopenOpnameSchema = z.object({
  sessionId: z.uuid(),
});
