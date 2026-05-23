import type {
  NotaArchive,
  NotaArchiveCategory,
  NotaArchiveFile,
  NotaArchiveStatus,
} from "@/db/schema/nota_archives";

export type { NotaArchiveCategory, NotaArchiveStatus };

export type ApiResult<T> =
  | { success: true; data: T }
  | {
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
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface PublicNotaFile {
  id: string;
  fileUrl: string;
  driveFileId: string;
  driveFolderId: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: number | null;
  displayOrder: number;
  createdAt: Date;
}

export interface PublicNotaArchive {
  id: string;
  outletId: string;
  notaDate: string; // YYYY-MM-DD
  category: NotaArchiveCategory;
  description: string;
  amount: string | null; // decimal string
  status: NotaArchiveStatus;
  reviewerNote: string | null;
  reviewedAt: Date | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  createdAt: Date;
  createdById: string;
  createdByName: string;
  fileCount: number;
}

export interface PublicNotaArchiveWithFiles extends PublicNotaArchive {
  files: PublicNotaFile[];
}

export interface ListNotaArchivesOptions {
  status?: NotaArchiveStatus;
  category?: NotaArchiveCategory;
  /** Inclusive date bounds (YYYY-MM-DD). */
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  /** Filter ke nota yang dibuat oleh user ini (untuk staff lihat punya sendiri). */
  uploaderId?: string;
  limit?: number;
  offset?: number;
}

export interface UploadedFile {
  url: string;
  fileId: string;
  folderId: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: number;
}

export interface CreateNotaArchiveInput {
  notaDate: string; // YYYY-MM-DD
  category: NotaArchiveCategory;
  description: string;
  amount?: number | null;
  /** Hasil dari /api/v1/nota-archives/upload — minimal 1, max 10. */
  files: UploadedFile[];
}

export interface UpdateNotaArchiveInput {
  id: string;
  notaDate?: string;
  category?: NotaArchiveCategory;
  description?: string;
  amount?: number | null;
}

export interface ReviewNotaArchiveInput {
  id: string;
  status: "reviewed" | "flagged" | "pending_review";
  reviewerNote?: string | null;
}

export interface AddNotaArchiveFilesInput {
  notaArchiveId: string;
  files: UploadedFile[];
}

/** Display label per kategori (UI label). */
export const CATEGORY_LABELS: Record<NotaArchiveCategory, string> = {
  pembelian_cash: "Pembelian Cash",
  pembayaran_top: "Pembayaran TOP/Supplier",
  operasional: "Operasional",
  maintenance: "Maintenance & Perbaikan",
  marketing: "Marketing & Promosi",
  pajak_admin: "Pajak & Administrasi",
  gaji_thr: "Gaji & THR",
  aset: "Aset & Equipment",
  lainnya: "Lainnya",
};

/** Short description that helps staff pick the right category quickly. */
export const CATEGORY_HINTS: Record<NotaArchiveCategory, string> = {
  pembelian_cash: "Belanja bahan/utensil bayar tunai langsung.",
  pembayaran_top: "Bayar nota supplier yang TOP (jatuh tempo).",
  operasional: "Listrik, air, internet, sewa, gas, telepon.",
  maintenance: "Service, perbaikan, gardening.",
  marketing: "Cetak banner, iklan, sosmed promosi.",
  pajak_admin: "Pajak, perizinan, retribusi.",
  gaji_thr: "Slip gaji, THR, bonus karyawan.",
  aset: "Equipment baru, furniture, decor.",
  lainnya: "Yang tidak masuk kategori di atas.",
};

export const CATEGORY_EMOJI: Record<NotaArchiveCategory, string> = {
  pembelian_cash: "💵",
  pembayaran_top: "📅",
  operasional: "⚡",
  maintenance: "🔧",
  marketing: "📣",
  pajak_admin: "📋",
  gaji_thr: "💼",
  aset: "🪑",
  lainnya: "📎",
};

export const STATUS_LABELS: Record<NotaArchiveStatus, string> = {
  pending_review: "Menunggu Review",
  reviewed: "Sudah Dicek",
  flagged: "Perlu Diperhatikan",
};

export function toPublicArchive(
  row: NotaArchive,
  createdByName: string,
  reviewedByName: string | null,
  fileCount: number,
): PublicNotaArchive {
  return {
    id: row.id,
    outletId: row.outletId,
    notaDate: row.notaDate,
    category: row.category as NotaArchiveCategory,
    description: row.description,
    amount: row.amount,
    status: row.status as NotaArchiveStatus,
    reviewerNote: row.reviewerNote,
    reviewedAt: row.reviewedAt,
    reviewedById: row.reviewedBy,
    reviewedByName: reviewedByName,
    createdAt: row.createdAt,
    createdById: row.createdBy,
    createdByName,
    fileCount,
  };
}

export function toPublicFile(row: NotaArchiveFile): PublicNotaFile {
  return {
    id: row.id,
    fileUrl: row.fileUrl,
    driveFileId: row.driveFileId,
    driveFolderId: row.driveFolderId,
    originalName: row.originalName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt,
  };
}
