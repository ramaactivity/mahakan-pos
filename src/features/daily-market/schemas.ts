import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = z
  .number()
  .int("Nominal harus bilangan bulat rupiah")
  .positive("Nominal harus lebih dari 0")
  .max(999_999_999_999, "Nominal terlalu besar");

export const topupSchema = z.object({
  amount: money,
  bankAccountId: z.uuid("Rekening asal tidak valid"),
  courierName: z.string().trim().min(2, "Nama kurir minimal 2 huruf").max(80),
  entryDate: z.string().regex(ISO_DATE, "Tanggal harus YYYY-MM-DD").optional(),
  description: z.string().trim().max(200).optional(),
  receiptImageUrl: z.string().trim().max(500).nullish(),
});

export const spendSchema = z.object({
  amount: money,
  categoryId: z.uuid("Kategori belanja tidak valid"),
  courierName: z.string().trim().min(2, "Nama kurir minimal 2 huruf").max(80),
  description: z.string().trim().min(3, "Keterangan minimal 3 huruf").max(200),
  entryDate: z.string().regex(ISO_DATE, "Tanggal harus YYYY-MM-DD").optional(),
  receiptImageUrl: z.string().trim().max(500).nullish(),
});

export const reverseSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(3, "Alasan minimal 3 huruf").max(200),
});

export type TopupInput = z.input<typeof topupSchema>;
export type SpendInput = z.input<typeof spendSchema>;
export type ReverseInput = z.input<typeof reverseSchema>;
