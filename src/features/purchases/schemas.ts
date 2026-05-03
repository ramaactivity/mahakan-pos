import { z } from "zod";

const NOTES_MAX = 500;
const INVOICE_MAX = 60;
const REASON_MIN = 3;
const REASON_MAX = 200;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

const paymentMethodEnum = z.enum([
  "cash",
  "transfer_bca",
  "transfer_bri",
  "transfer_other",
  "top",
]);

const purchaseItemSchema = z.object({
  ingredientId: z.uuid(),
  qty: z
    .number()
    .int()
    .positive("Qty harus > 0")
    .max(10_000_000_000, "Qty terlalu besar"),
  unitCost: z
    .number()
    .int()
    .nonnegative("Harga tidak boleh negatif")
    .max(999_999_999, "Harga terlalu besar"),
});

export const createPurchaseSchema = z
  .object({
    supplierId: z.uuid().nullable(),
    purchaseDate: dateString,
    paymentMethod: paymentMethodEnum,
    paymentTermDays: z
      .number()
      .int()
      .min(0)
      .max(365)
      .optional()
      .default(0),
    invoiceNo: z.string().trim().max(INVOICE_MAX).nullable().optional(),
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    /** Vercel Blob URL ke foto nota / bukti transfer (sesi AA #2).
     * URL boundary check only — actual upload + content-type enforcement
     * di /api/v1/purchase-receipts/upload route. */
    receiptImageUrl: z.url().max(500).nullable().optional(),
    updateCost: z.boolean().optional().default(true),
    createKasEntry: z.boolean().optional(),
    items: z
      .array(purchaseItemSchema)
      .min(1, "Minimal 1 item pembelian")
      .max(200, "Terlalu banyak item dalam 1 purchase"),
  })
  .refine(
    (v) => {
      // Dedupe — ingredientId tidak boleh duplikat dalam 1 purchase.
      const ids = v.items.map((i) => i.ingredientId);
      return new Set(ids).size === ids.length;
    },
    "Item bahan duplikat dalam 1 purchase",
  )
  .refine(
    (v) => {
      // TOP wajib paymentTermDays > 0; non-TOP harus 0.
      if (v.paymentMethod === "top") return v.paymentTermDays > 0;
      return v.paymentTermDays === 0;
    },
    {
      message:
        "TOP wajib paymentTermDays > 0; non-TOP harus 0",
      path: ["paymentTermDays"],
    },
  );

export const cancelPurchaseSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
});

export const markPaidSchema = z.object({
  id: z.uuid(),
  paymentMethod: paymentMethodEnum.refine(
    (m) => m !== "top",
    "Payment method untuk lunas tidak boleh TOP",
  ),
});

export type { } from "./types";
