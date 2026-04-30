import { z } from "zod";

const NAME_MIN = 1;
const NAME_MAX = 80;
const CONTACT_MAX = 120;
const CATEGORY_MAX = 60;
const NOTES_MAX = 500;
const TERM_MAX = 365;

export const createSupplierSchema = z.object({
  name: z.string().trim().min(NAME_MIN, "Nama wajib").max(NAME_MAX),
  contact: z.string().trim().max(CONTACT_MAX).nullable().optional(),
  category: z.string().trim().max(CATEGORY_MAX).nullable().optional(),
  defaultPaymentTermDays: z
    .number()
    .int()
    .min(0, "Term tidak boleh negatif")
    .max(TERM_MAX, "Term terlalu lama")
    .optional()
    .default(0),
  notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(NAME_MIN).max(NAME_MAX).optional(),
    contact: z.string().trim().max(CONTACT_MAX).nullable().optional(),
    category: z.string().trim().max(CATEGORY_MAX).nullable().optional(),
    defaultPaymentTermDays: z
      .number()
      .int()
      .min(0)
      .max(TERM_MAX)
      .optional(),
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Minimal satu field harus diisi",
  );

export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
