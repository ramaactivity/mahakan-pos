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
  // Sesi AE — accept decimal qty (mis. 0.5 kg, 0.25 L) supaya staff bisa
  // input pecahan langsung di Catat Pembelian, mirror flow Google Sheets
  // yang biasa dipake. Server simpan ke purchase_items.qty_decimal; legacy
  // qty bigint tetap di-populate (round up) untuk backward-compat.
  qty: z
    .number()
    .positive("Qty harus > 0")
    .max(10_000_000_000, "Qty terlalu besar")
    .refine((v) => Number.isFinite(v), "Qty harus angka"),
  unitCost: z
    .number()
    .int()
    .nonnegative("Harga tidak boleh negatif")
    .max(999_999_999, "Harga terlalu besar"),
  // Sesi AE — per-line unit override. NULL/undefined = pakai master
  // ingredient unit. Snapshot text-only, no server-side conversion.
  unit: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .nullable()
    .optional(),
  /** Sesi AE-57 — FK ke purchase_request_items.id. Server validate exist +
   * outlet-match + outstanding qty cap. */
  purchaseRequestItemId: z.uuid().nullable().optional(),
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
     * di /api/v1/purchase-receipts/upload route.
     *
     * LEGACY (pre-AE-129) — biarkan untuk backward compat client lama; server
     * akan mirror item pertama `receiptImageUrls` ke field ini saat write. */
    receiptImageUrl: z.url().max(500).nullable().optional(),
    /** Sesi AE-129 — multi-nota (Anisa request). Max 5 URLs supaya tidak
     * abuse Drive folder. Tiap URL di-validate (z.url) + length cap. Empty
     * array atau undefined = belum upload nota. */
    receiptImageUrls: z
      .array(z.url().max(500))
      .max(5, "Maksimal 5 foto nota per pembelian")
      .nullable()
      .optional(),
    updateCost: z.boolean().optional().default(true),
    createKasEntry: z.boolean().optional(),
    /** Sesi AE-57 — metadata: dari PR mana purchase ini ditarik. Digunakan
     * untuk audit log. Bukan disimpan di table (per-item linkage cukup). */
    fromPurchaseRequestId: z.uuid().nullable().optional(),
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

/**
 * Sesi AE-188 — Edit PO (owner request).
 *
 * Alasan bisnis: PIC Operasional sering harus proses GR sebelum nota/harga
 * final datang, jadi PO dibuat dengan harga Rp 0 dulu. Setelah nota datang,
 * PO harus bisa diedit dan SEMUA turunannya (nilai GR, expense kas, jurnal)
 * ikut disinkronkan.
 *
 * `id` per item: NULL = baris baru. Baris lama yang tidak dikirim = dihapus.
 * Server menolak tambah/hapus/ubah-qty kalau PO sudah pernah di-GR (nilai
 * fisik sudah masuk ke movement + gr_items) — yang boleh cuma harga.
 */
const updatePurchaseItemSchema = purchaseItemSchema.extend({
  id: z.uuid().nullable().optional(),
});

export const updatePurchaseOrderSchema = z
  .object({
    id: z.uuid(),
    supplierId: z.uuid().nullable(),
    purchaseDate: dateString,
    paymentMethod: paymentMethodEnum,
    paymentTermDays: z.number().int().min(0).max(365).optional().default(0),
    invoiceNo: z.string().trim().max(INVOICE_MAX).nullable().optional(),
    notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    receiptImageUrls: z
      .array(z.url().max(500))
      .max(5, "Maksimal 5 foto nota per pembelian")
      .nullable()
      .optional(),
    items: z
      .array(updatePurchaseItemSchema)
      .min(1, "Minimal 1 item pembelian")
      .max(200, "Terlalu banyak item dalam 1 purchase"),
  })
  .refine(
    (v) => {
      const ids = v.items.map((i) => i.ingredientId);
      return new Set(ids).size === ids.length;
    },
    "Item bahan duplikat dalam 1 purchase",
  )
  .refine(
    (v) => {
      if (v.paymentMethod === "top") return v.paymentTermDays > 0;
      return v.paymentTermDays === 0;
    },
    {
      message: "TOP wajib paymentTermDays > 0; non-TOP harus 0",
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
  /** Sesi AE-188 — tanggal pembayaran (owner request). Dipakai untuk
   * `paid_at`, tanggal expense kas, DAN `entry_date` jurnal umum supaya
   * pelunasan mendarat di periode yang benar (bukan selalu hari ini).
   * Kosong = hari ini WIB (perilaku lama). */
  paymentDate: dateString.optional(),
});

export type { } from "./types";
