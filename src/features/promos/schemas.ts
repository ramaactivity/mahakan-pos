import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const orderTypeSchema = z.enum(["dine_in", "takeaway"]);
const paymentMethodSchema = z.enum([
  "cash",
  "qris",
  "card_bca",
  "card_bni",
  "card_mandiri",
  "card_bri",
  "card_other",
  "split",
]);

const basePromoFields = {
  name: z.string().min(1, "Nama wajib").max(120, "Nama maks 120 karakter").trim(),
  description: z.string().max(500).nullish(),
  discountType: z.enum(["percent", "fixed"]),
  discountValue: z.number().int().positive(),
  maxDiscountAmount: z.number().int().nonnegative().nullish(),
  scope: z.enum(["whole_bill", "category"]),
  scopeCategoryIds: z.array(z.string().uuid()).nullish(),
  minSubtotal: z.number().int().nonnegative().nullish(),
  applicableOrderTypes: z.array(orderTypeSchema).nullish(),
  applicablePaymentMethods: z.array(paymentMethodSchema).nullish(),
  startDate: z.string().regex(DATE_RE).nullish(),
  endDate: z.string().regex(DATE_RE).nullish(),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).nullish(),
  startTime: z.string().regex(TIME_RE).nullish(),
  endTime: z.string().regex(TIME_RE).nullish(),
  maxTotalUses: z.number().int().positive().nullish(),
  requiresApproval: z.boolean(),
  status: z.enum(["draft", "active", "paused", "archived"]),
} as const;

function applyRefines<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.superRefine((v, ctx) => {
    const data = v as {
      discountType: "percent" | "fixed";
      discountValue: number;
      scope: "whole_bill" | "category";
      scopeCategoryIds?: string[] | null;
      startDate?: string | null;
      endDate?: string | null;
      startTime?: string | null;
      endTime?: string | null;
    };
    if (data.discountType === "percent") {
      if (data.discountValue < 1 || data.discountValue > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["discountValue"],
          message: "Persentase harus 1–100",
        });
      }
    }
    if (data.scope === "category") {
      if (!data.scopeCategoryIds || data.scopeCategoryIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["scopeCategoryIds"],
          message: "Pilih minimal 1 kategori",
        });
      }
    }
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Tanggal akhir tidak boleh sebelum tanggal mulai",
      });
    }
    if (data.startTime && data.endTime && data.startTime >= data.endTime) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Jam akhir harus setelah jam mulai",
      });
    }
  });
}

export const createPromoSchema = applyRefines(z.object(basePromoFields));

export const updatePromoSchema = applyRefines(
  z.object({ ...basePromoFields, id: z.string().uuid() }),
);
