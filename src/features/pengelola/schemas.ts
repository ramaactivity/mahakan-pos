import { z } from "zod";

const NAME_MIN = 2;
const NAME_MAX = 120;

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
}

const pengelolaBaseSchema = z.object({
  fullName: z.string().trim().min(NAME_MIN).max(NAME_MAX),
  nickname: optionalText(60),
  nik: z
    .string()
    .trim()
    .regex(/^\d{16}$/, "NIK harus 16 digit")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email tidak valid")
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  phone: optionalText(20),
  address: optionalText(500),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  bankName: optionalText(40),
  bankAccountNumber: optionalText(40),
  bankAccountHolderName: optionalText(120),
  modalDisetor: z
    .number()
    .int("Modal harus angka bulat")
    .min(0)
    .max(99_999_999_999),
  userId: z.uuid().optional().nullable(),
  status: z.enum(["active", "inactive", "exited"]).optional(),
  notes: optionalText(1000),
});

export const createPengelolaSchema = pengelolaBaseSchema;
export const updatePengelolaSchema = pengelolaBaseSchema
  .extend({ exitReason: optionalText(500) })
  .partial()
  .refine(
    (v) => Object.keys(v).length > 0,
    "Minimal satu field harus diisi",
  );
