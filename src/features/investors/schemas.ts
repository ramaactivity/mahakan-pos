import { z } from "zod";

const NAME_MIN = 2;
const NAME_MAX = 120;
const NIK_PATTERN = /^\d{16}$/; // 16-digit KTP
const PHONE_PATTERN = /^[+\d\s\-()]{6,20}$/;
const EMAIL_MAX = 120;

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
}

const niksSchema = z
  .string()
  .trim()
  .regex(NIK_PATTERN, "NIK harus 16 digit angka")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const phoneSchema = z
  .string()
  .trim()
  .regex(PHONE_PATTERN, "Nomor telepon tidak valid")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email tidak valid")
  .max(EMAIL_MAX)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/* Sesi AE-63b — Investor base fields shared by create + update + import. */
const investorBaseSchema = z.object({
  fullName: z.string().trim().min(NAME_MIN).max(NAME_MAX),
  nickname: optionalText(60),
  nik: niksSchema,
  email: emailSchema,
  phone: phoneSchema,
  address: optionalText(500),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  occupation: optionalText(80),
  igHandle: optionalText(60),
  bankName: optionalText(40),
  bankAccountNumber: optionalText(40),
  bankAccountHolderName: optionalText(120),
  modalDisetor: z
    .number()
    .int("Modal harus angka bulat (Rupiah)")
    .min(0, "Modal tidak boleh negatif")
    .max(99_999_999_999, "Modal terlalu besar"),
  status: z.enum(["active", "inactive", "exited"]).optional(),
  notes: optionalText(1000),
});

export const createInvestorSchema = investorBaseSchema;
export type CreateInvestorParsed = z.infer<typeof createInvestorSchema>;

export const updateInvestorSchema = investorBaseSchema
  .extend({
    exitReason: optionalText(500),
  })
  .partial()
  .refine(
    (v) => Object.keys(v).length > 0,
    "Minimal satu field harus diisi",
  );
export type UpdateInvestorParsed = z.infer<typeof updateInvestorSchema>;

/* CSV import — sama dengan create base tapi tanpa `status` (default active)
 * dan `notes`. nik + email tidak wajib (sebagian data Sheets kosong). */
export const bulkImportInvestorRowSchema = investorBaseSchema.pick({
  fullName: true,
  nik: true,
  email: true,
  phone: true,
  address: true,
  dateOfBirth: true,
  occupation: true,
  igHandle: true,
  bankName: true,
  bankAccountNumber: true,
  bankAccountHolderName: true,
  modalDisetor: true,
});

export const bulkImportInvestorsSchema = z.object({
  rows: z
    .array(bulkImportInvestorRowSchema)
    .min(1, "Minimal 1 baris")
    .max(500, "Maksimal 500 baris per import"),
  /* Sesi AE-68 — Mode dedup behavior:
   *  - insert_only (default, backward-compat): skip kalau name/NIK match existing
   *  - upsert: kalau name/NIK match existing → UPDATE field-nya pakai nilai baru
   *    dari CSV. Untuk re-upload CSV dari Sheets dengan data yang sudah di-koreksi. */
  mode: z.enum(["insert_only", "upsert"]).default("insert_only"),
});

export const listInvestorsSchema = z.object({
  status: z.enum(["active", "inactive", "exited", "all"]).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});
