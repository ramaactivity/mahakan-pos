import type { InferSelectModel } from "drizzle-orm";
import type { purchases, purchaseItems } from "@/db/schema";

export type Purchase = InferSelectModel<typeof purchases>;
export type PurchaseItem = InferSelectModel<typeof purchaseItems>;
export type PaymentMethod = Purchase["paymentMethod"];
export type PurchaseStatus = Purchase["status"];

export interface PurchaseItemInput {
  ingredientId: string;
  /** Decimal qty (e.g. 0.5 kg, 0.25 L). Sesi AE — boleh decimal. */
  qty: number;
  unitCost: number;
  /** Sesi AE — per-line unit override. NULL/undefined = pakai master
   * ingredient unit (unitSnapshot). Snapshot text-only. */
  unit?: string | null;
  /** Sesi AE-57 — link ke PR item kalau item ini ditarik dari Permintaan
   * Belanja. Server akan bump receivedQty + auto-promote PR status. */
  purchaseRequestItemId?: string | null;
}

export interface CreatePurchaseInput {
  supplierId: string | null;
  purchaseDate: string;     // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  paymentTermDays?: number;
  invoiceNo?: string | null;
  notes?: string | null;
  /** Vercel Blob URL ke foto nota / bukti transfer (sesi AA #2). Legacy
   * single URL; UI baru pakai `receiptImageUrls` (multi). Saat keduanya
   * dikirim, server prefer `receiptImageUrls[0]` untuk mirror legacy. */
  receiptImageUrl?: string | null;
  /** Sesi AE-129 — multi-nota URLs (Anisa request). Max 5. */
  receiptImageUrls?: string[] | null;
  /** Whether to update each ingredient.cost_per_unit master from this
   * purchase's unit cost. Default true. */
  updateCost?: boolean;
  /** Whether to auto-create kas expense. Default: true for non-TOP, false
   * for TOP (TOP creates expense at mark-paid). */
  createKasEntry?: boolean;
  /** Sesi AE-57 — metadata: dari PR mana purchase ini ditarik. Digunakan
   * untuk audit log + cluster traceability. Tidak disimpan ke purchases
   * table (per-item linkage via purchaseRequestItemId cukup). */
  fromPurchaseRequestId?: string | null;
  items: PurchaseItemInput[];
}

/** Sesi AE-188 — item saat EDIT PO. `id` = purchase_items.id yang sudah ada;
 * null/undefined = baris baru. Baris lama yang tidak ikut dikirim dihapus. */
export interface UpdatePurchaseItemInput extends PurchaseItemInput {
  id?: string | null;
}

export interface UpdatePurchaseOrderInput {
  id: string;
  supplierId: string | null;
  purchaseDate: string;
  paymentMethod: PaymentMethod;
  paymentTermDays?: number;
  invoiceNo?: string | null;
  notes?: string | null;
  receiptImageUrls?: string[] | null;
  items: UpdatePurchaseItemInput[];
}

/** Ringkasan efek samping edit PO — dipakai UI untuk toast yang jujur. */
export interface UpdatePurchaseOrderResult {
  id: string;
  totalAmount: number;
  /** Jumlah GR yang nilainya ikut disesuaikan. */
  receiptsResynced: number;
  /** Jumlah expense kas yang dibuat/di-update/di-soft-delete. */
  expensesTouched: number;
  /** Apakah PO sudah pernah di-GR (mode edit harga saja). */
  priceOnly: boolean;
}

export interface CancelPurchaseInput {
  id: string;
  reason: string;
}

export interface MarkPaidInput {
  id: string;
  paymentMethod: PaymentMethod;
  /** Sesi AE-188 — tanggal pembayaran (YYYY-MM-DD WIB). Kosong = hari ini. */
  paymentDate?: string;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export type ApiFailure = {
  success: false;
  error: { code: string; message: string; field?: string };
};

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiFailure {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface PurchaseListItem extends Purchase {
  supplierName: string | null;
  itemCount: number;
}

export interface PurchaseDetail extends Purchase {
  supplierName: string | null;
  items: Array<
    PurchaseItem & {
      currentUnit: string;
      currentSection: string | null;
    }
  >;
  createdByName: string | null;
  paidByName: string | null;
  cancelledByName: string | null;
}

export interface ListPurchasesOptions {
  status?: PurchaseStatus;
  supplierId?: string;
  paymentMethod?: PaymentMethod;
  dateFrom?: string;     // YYYY-MM-DD
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface TopOutstandingItem {
  id: string;
  purchaseDate: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNo: string | null;
  totalAmount: number;
  dueDate: string | null;
  /** Days from today (Asia/Jakarta) to dueDate. Negative = overdue. */
  daysToDue: number | null;
}

/**
 * Sesi AE-184 — riwayat hutang dagang (pembelian TOP), termasuk yang SUDAH
 * lunas. Sebelumnya layar Hutang hanya query `status='pending_payment'`
 * sehingga begitu ditandai lunas catatannya hilang total — tidak bisa lagi
 * ditelusuri kapan dibayar, lewat apa, dan siapa yang menandai.
 */
export type TopHistoryStatus = "pending_payment" | "paid" | "cancelled";

export interface TopHistoryItem {
  id: string;
  purchaseDate: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNo: string | null;
  /** Nilai pembelian yang dipesan. */
  totalAmount: number;
  dueDate: string | null;
  /** Hari menuju jatuh tempo; negatif = lewat. Null kalau bukan TOP/sudah lunas. */
  daysToDue: number | null;
  status: TopHistoryStatus;
  /** Kapan ditandai lunas. */
  paidAt: string | null;
  paidByName: string | null;
  /** Cara bayar saat pelunasan (dari entry kas yang tercatat). */
  settlementMethod: string | null;
  /**
   * Nominal yang benar-benar dibayar. Bisa BEDA dari totalAmount karena
   * pelunasan TOP memakai basis barang yang diterima (GR), bukan yang
   * dipesan — lihat audit AE-181. Null kalau tidak ada entry kas.
   */
  settlementAmount: number | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface TopHistoryOptions {
  /** Default "all". */
  status?: TopHistoryStatus | "all";
  /** Filter tanggal pembelian (inklusif). */
  fromDate?: string;
  toDate?: string;
  supplierId?: string;
  limit?: number;
}

export interface TopHistorySummary {
  outstandingCount: number;
  outstandingAmount: number;
  /**
   * Jatuh tempo dihitung SERVER-SIDE dari seluruh hutang berjalan, bukan dari
   * baris yang sedang ditampilkan — kalau ikut tab, kartu "Lewat jatuh tempo"
   * jadi Rp 0 saat owner membuka tab "Sudah Lunas", padahal hutang telatnya
   * masih ada.
   */
  dueSoonAmount: number;
  overdueAmount: number;
  paidCount: number;
  paidAmount: number;
  cancelledCount: number;
  cancelledAmount: number;
}
