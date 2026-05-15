import { z } from "zod";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

const optionalDate = dateString
  .nullish()
  .transform((s) => (s && s.length > 0 ? s : null));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null));

const optionalUuid = z
  .uuid()
  .nullish()
  .transform((s) => (s && s.length > 0 ? s : null));

const optionalMoney = z
  .number()
  .int()
  .min(0)
  .max(999_999_999)
  .nullish()
  .transform((n) => (typeof n === "number" ? n : null));

/* Sesi AE-60 — paymentType + dailyRate. Refine enforce dailyRate > 0
 * kalau paymentType='daily'. Pakai base object supaya bisa extend untuk
 * updateEmployeeSchema (ZodEffects tidak punya .extend). */
const paymentTypeSchema = z
  .enum(["daily", "monthly"])
  .nullish()
  .transform((s) => s ?? null);

const dailyRateRefine = (v: { paymentType: "daily" | "monthly" | null; dailyRate: number | null }) => {
  if (v.paymentType === "daily") {
    return v.dailyRate != null && v.dailyRate > 0;
  }
  return true;
};
const dailyRateRefineMsg = {
  message: "Karyawan tipe Harian wajib punya tarif harian (Rp/hari) > 0",
  path: ["dailyRate" as const],
};

const createEmployeeBase = z.object({
  fullName: z.string().trim().min(1).max(120),
  nickname: optionalText(60),
  nik: optionalText(32),
  email: optionalText(120),
  phone: optionalText(32),
  address: optionalText(500),
  dateOfBirth: optionalDate,
  employeeNumber: optionalText(32),
  position: optionalText(80),
  department: optionalText(80),
  hireDate: optionalDate,
  employmentType: z
    .enum(["full_time", "part_time", "contract", "freelance"])
    .nullish()
    .transform((s) => s ?? null),
  paymentType: paymentTypeSchema,
  salaryAmount: optionalMoney,
  dailyRate: optionalMoney,
  userId: optionalUuid,
  notes: optionalText(1000),
});

export const createEmployeeSchema = createEmployeeBase.refine(
  dailyRateRefine,
  dailyRateRefineMsg,
);

export const updateEmployeeSchema = createEmployeeBase
  .extend({
    id: z.uuid(),
    status: z
      .enum(["active", "on_leave", "resigned", "terminated"])
      .optional(),
    resignedAt: z
      .string()
      .nullish()
      .transform((s) => (s && s.length > 0 ? s : null)),
    resignReason: optionalText(500),
  })
  .refine(dailyRateRefine, dailyRateRefineMsg);

export const createEmployeeDocumentSchema = z.object({
  employeeId: z.uuid(),
  docType: z.enum([
    "ktp",
    "bpjs_kesehatan",
    "bpjs_ketenagakerjaan",
    "npwp",
    "ijazah",
    "kontrak",
    "other",
  ]),
  title: z.string().trim().min(1).max(200),
  fileUrl: optionalText(500),
  expiresAt: optionalDate,
  notes: optionalText(500),
});

export const updateEmployeeDocumentSchema = createEmployeeDocumentSchema.extend(
  { id: z.uuid() },
);

/** Sesi M — manual career history backfill (Owner adds historical promo). */
export const createCareerHistoryEntrySchema = z.object({
  employeeId: z.uuid(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  position: optionalText(80),
  department: optionalText(80),
  employmentType: z
    .enum(["full_time", "part_time", "contract", "freelance"])
    .nullish(),
  salaryAmount: z.number().int().nonnegative().nullish(),
  note: optionalText(500),
});
