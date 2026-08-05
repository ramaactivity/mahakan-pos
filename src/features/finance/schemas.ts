import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

export const createCashDepositSchema = z
  .object({
    depositDate: isoDate,
    amount: z
      .number()
      .int()
      .positive("Nominal harus lebih dari 0")
      .max(999_999_999, "Nominal terlalu besar"),
    bankDestination: z
      .string()
      .trim()
      .min(2, "Tujuan bank wajib diisi")
      .max(120),
    referenceNo: z
      .string()
      .trim()
      .max(64)
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
    photoUrl: z
      .string()
      .url()
      .nullish()
      .or(z.literal("").transform(() => null)),
    notes: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
    coversFromDate: isoDate,
    coversToDate: isoDate,
  })
  .refine((v) => v.coversToDate >= v.coversFromDate, {
    message: "Tanggal akhir harus >= tanggal awal",
    path: ["coversToDate"],
  });

export const updateCashDepositSchema = z.object({
  id: z.string().uuid(),
  depositDate: isoDate.optional(),
  amount: z.number().int().positive().max(999_999_999).optional(),
  bankDestination: z.string().trim().min(2).max(120).optional(),
  referenceNo: z.string().trim().max(64).nullish(),
  photoUrl: z.string().url().nullish().or(z.literal("")),
  notes: z.string().trim().max(500).nullish(),
  coversFromDate: isoDate.optional(),
  coversToDate: isoDate.optional(),
});

export const verifyCashDepositSchema = z.object({
  id: z.string().uuid(),
  /** Sesi AE-62h — kalau verify akan bikin cashOnHand jadi negatif
   * (deposit > cash siap setor), owner harus eksplisit acknowledge
   * dengan acknowledgeNegativeCash=true. Tanpa flag → reject. */
  acknowledgeNegativeCash: z.boolean().optional().default(false),
});

export const rejectCashDepositSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, "Alasan wajib diisi").max(500),
});

/** Sesi AE-62h — revert deposit yang sudah verified kembali ke pending.
 * Use case: owner discover deposit fraudulent/duplicate/wrong amount
 * setelah verify. Reverse journal entry juga di-trigger. */
export const unverifyCashDepositSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, "Alasan wajib diisi").max(500),
});

export const aggregatorChannelEnum = z.enum([
  "edc_bca",
  "gofood",
  "grabfood",
  "shopeefood",
  "qris",
]);

/** Sesi AE-77 — per-order line item dari CSV import. Optional; manual
 * entry tidak punya line items. */
export const aggregatorLineItemSchema = z.object({
  date: isoDate,
  orderNo: z.string().trim().max(64).nullish(),
  gross: z.number().int().nonnegative().max(999_999_999),
  fee: z.number().int().nonnegative().max(999_999_999).default(0),
  net: z.number().int().nonnegative().max(999_999_999),
  customer: z.string().trim().max(128).nullish(),
  notes: z.string().trim().max(256).nullish(),
  rawLine: z.number().int().nullish(),
});

export const createAggregatorSettlementSchema = z
  .object({
    channel: aggregatorChannelEnum,
    periodFrom: isoDate,
    periodTo: isoDate,
    grossAmount: z.number().int().nonnegative().max(999_999_999_999),
    feeAmount: z
      .number()
      .int()
      .nonnegative()
      .max(999_999_999_999)
      .default(0),
    bankCreditedAt: z
      .union([z.date(), z.string()])
      .nullish()
      .transform((v) => (v ? new Date(v) : null)),
    referenceNo: z.string().trim().max(64).nullish(),
    notes: z.string().trim().max(500).nullish(),
    bankAccountId: z.string().uuid().nullish(),
    /** Optional — saat dari CSV import, sertakan per-order rows untuk drilldown. */
    lineItems: z.array(aggregatorLineItemSchema).max(10_000).nullish(),
    /** Sesi AE-165 — asal data (csv/auto_pos/manual). Default 'manual'. */
    source: z.enum(["csv", "auto_pos", "manual"]).optional(),
  })
  .refine((v) => v.periodTo >= v.periodFrom, {
    message: "Periode akhir harus >= periode awal",
    path: ["periodTo"],
  })
  .refine((v) => v.feeAmount <= v.grossAmount, {
    message: "Fee tidak boleh lebih besar dari gross",
    path: ["feeAmount"],
  });

export const updateAggregatorSettlementSchema = z.object({
  id: z.string().uuid(),
  channel: aggregatorChannelEnum.optional(),
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  grossAmount: z.number().int().nonnegative().max(999_999_999_999).optional(),
  feeAmount: z.number().int().nonnegative().max(999_999_999_999).optional(),
  bankCreditedAt: z.union([z.date(), z.string()]).nullish(),
  referenceNo: z.string().trim().max(64).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

/** Sesi AE-165 — generate settlement QRIS/EDC harian dari POS untuk rentang
 * tanggal (inclusive). Tiap hari yang sudah ada settlement (overlap) di-skip. */
export const generateCashlessSettlementSchema = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to >= v.from, {
    message: "Tanggal akhir harus >= tanggal mulai",
    path: ["to"],
  });

/** Sesi AE-165 — rate MDR per channel cashless langsung. Persen 0..10. */
export const updateCashlessMdrSchema = z.object({
  mdrQrisPct: z.number().min(0).max(10),
  mdrEdcBcaPct: z.number().min(0).max(10),
  /* Sesi AE-182 — opsional supaya form lama (2 field) tetap valid; kalau
   * tidak dikirim, nilai lama dipertahankan. */
  mdrEdcBniPct: z.number().min(0).max(10).optional(),
  mdrEdcBriPct: z.number().min(0).max(10).optional(),
  mdrEdcOtherPct: z.number().min(0).max(10).optional(),
});
