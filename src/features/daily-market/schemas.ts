import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = z
  .number()
  .int("Nominal harus bilangan bulat rupiah")
  .positive("Nominal harus lebih dari 0")
  .max(999_999_999_999, "Nominal terlalu besar");

/**
 * Sesi AE-245 — satu baris bahan di nota pasar.
 *
 * `subtotal` boleh dikosongkan; server mengisinya `qty × unitCost`. Kalau
 * dikirim, DIA yang menang (aturan AE-216): harga satuan wajib bulat, jadi
 * perkaliannya membuang sisa pembulatan dan nota Rp 227.000 bisa tercatat
 * Rp 226.880 tanpa ada yang menyadarinya.
 */
export const marketItemSchema = z.object({
  ingredientId: z.uuid("Bahan tidak valid"),
  qty: z
    .number()
    .positive("Jumlah harus lebih dari 0")
    .max(1_000_000, "Jumlah terlalu besar"),
  /** Satuan belanja; kosong = pakai satuan dasar bahannya. */
  unit: z.string().trim().max(40).nullish(),
  unitCost: z
    .number()
    .int("Harga satuan harus bilangan bulat rupiah")
    .min(0, "Harga satuan tidak boleh minus")
    .max(999_999_999_999, "Harga satuan terlalu besar"),
  subtotal: z
    .number()
    .int("Subtotal harus bilangan bulat rupiah")
    .positive("Subtotal harus lebih dari 0")
    .max(999_999_999_999, "Subtotal terlalu besar")
    .optional(),
});

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
  /* Sesi AE-245 — bahan yang dibeli berikut qty & harganya. Boleh kosong:
   * belanja pasar kadang isinya hal yang memang tidak ada di master
   * (parkir, plastik, kuli angkut) — itu tetap jadi beban, bukan persediaan. */
  items: z.array(marketItemSchema).max(50, "Maksimal 50 bahan per catatan").optional(),
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
export type MarketItemInput = z.input<typeof marketItemSchema>;
export type ReverseInput = z.input<typeof reverseSchema>;
