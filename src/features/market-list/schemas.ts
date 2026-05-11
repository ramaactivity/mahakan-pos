import { z } from "zod";

export const createMarketItemSchema = z.object({
  supplierId: z.string().uuid(),
  ingredientId: z.string().uuid(),
  unitCost: z
    .number()
    .int("Harga harus angka bulat (Rupiah)")
    .positive("Harga harus > 0"),
  packSize: z
    .number()
    .positive("Pack size harus > 0")
    .max(100000, "Pack size maksimal 100.000"),
  packUnit: z.string().min(1, "Unit pack wajib diisi").max(20),
  isPrimary: z.boolean().optional().default(false),
  notes: z.string().max(500).nullable().optional(),
});

export const updateMarketItemSchema = z.object({
  /** Sesi AE-39 — staff minta bisa ganti supplier / bahan tanpa hapus
   *  + buat ulang. Backend handle dup-check + cascade ulang. */
  supplierId: z.string().uuid().optional(),
  ingredientId: z.string().uuid().optional(),
  unitCost: z.number().int().positive().optional(),
  packSize: z.number().positive().max(100000).optional(),
  packUnit: z.string().min(1).max(20).optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const bulkImportRowSchema = z.object({
  supplierName: z.string().min(1),
  ingredientName: z.string().min(1),
  unitCost: z.number().int().positive(),
  packSize: z.number().positive(),
  packUnit: z.string().min(1).max(20),
  isPrimary: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const bulkImportSchema = z.object({
  rows: z.array(bulkImportRowSchema).min(1).max(500),
  /** Sesi AE-27 — kalau true, auto-create supplier / ingredient yang
   *  belum ada di master (drastically reduces friction kalau staff
   *  punya CSV besar dengan supplier baru). */
  createMissing: z.boolean().optional().default(false),
});
