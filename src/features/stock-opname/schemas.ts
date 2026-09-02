import { z } from "zod";

const PERIOD_MAX = 40;
const NOTES_MAX = 500;
const REASON_MIN = 3;
const REASON_MAX = 200;
const NOTE_LINE_MAX = 200;

// Sesi AE-15 — accept decimal qty (e.g. 2.5 kg, 0.75 L). Mirror sesi AE-12
// pattern dari purchases. Removed `.int()` constraint. Server stores via
// dual-column pattern: bigint (rounded) + numeric(15,4) decimal.
const qtyNonNeg = z
  .number()
  .nonnegative("Jumlah tidak boleh negatif")
  .max(10_000_000_000, "Jumlah terlalu besar")
  .refine((v) => Number.isFinite(v), "Jumlah harus angka");

export const startOpnameSchema = z.object({
  periodLabel: z.string().trim().min(1).max(PERIOD_MAX).optional(),
  /* Sesi AE-230 — bulan yang DIWAKILI opname ini ("YYYY-MM"), bukan bulan
   * saat menghitung. Ini yang menentukan opname masuk rekap COGS bulan mana. */
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format bulan harus YYYY-MM")
    .optional(),
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

/** Sesi AE-22 — add ad-hoc item ke opname session berjalan. */
export const addOpnameItemAdHocSchema = z.object({
  sessionId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(2, "Nama bahan minimal 2 karakter")
    .max(80, "Nama bahan maksimal 80 karakter"),
  unit: z.string().trim().min(1, "Unit wajib diisi").max(20),
  section: z
    .enum(["kitchen", "bar", "supporting", "cleaning"])
    .nullable()
    .optional(),
  actualQty: qtyNonNeg,
  note: z.string().trim().max(NOTE_LINE_MAX).nullable().optional(),
});
