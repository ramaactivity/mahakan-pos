"use client";

/**
 * Client-side helper untuk upload nota file ke Drive via API route, lalu
 * return shape yang siap dipassing ke `createNotaArchive` / `addFiles`.
 *
 * Tidak coupled dengan UI tertentu — bisa dipakai di /m/nota staff page
 * + back office "Tambah Nota" modal.
 */

import type { NotaArchiveCategory } from "@/db/schema/nota_archives";
import type { UploadedFile } from "./types";

export interface UploadOneOpts {
  file: File;
  notaDate: string; // YYYY-MM-DD
  category: NotaArchiveCategory;
}

export type UploadOneResult =
  | { ok: true; data: UploadedFile }
  | { ok: false; error: { code: string; message: string } };

export async function uploadNotaFile(
  opts: UploadOneOpts,
): Promise<UploadOneResult> {
  const fd = new FormData();
  fd.append("file", opts.file);
  fd.append("notaDate", opts.notaDate);
  fd.append("category", opts.category);
  try {
    const res = await fetch("/api/v1/nota-archives/upload", {
      method: "POST",
      body: fd,
    });
    const json = (await res.json()) as
      | {
          success: true;
          data: {
            url: string;
            fileId: string;
            folderId: string | null;
            originalName: string;
            contentType: string;
            sizeBytes: number;
            folderPath: string;
            folderUrl: string;
          };
        }
      | { success: false; error: { code: string; message: string } };
    if (!json.success) return { ok: false, error: json.error };
    return {
      ok: true,
      data: {
        url: json.data.url,
        fileId: json.data.fileId,
        folderId: json.data.folderId,
        originalName: json.data.originalName,
        contentType: json.data.contentType,
        sizeBytes: json.data.sizeBytes,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: e instanceof Error ? e.message : "Gagal koneksi",
      },
    };
  }
}

/**
 * Upload N file dengan progress callback. Sequential supaya tidak hammer
 * Drive API rate limit dari 1 device. Return semua yang sukses + list
 * yang gagal.
 */
export async function uploadNotaFiles(
  files: File[],
  opts: Omit<UploadOneOpts, "file">,
  onProgress?: (done: number, total: number) => void,
): Promise<{
  uploaded: UploadedFile[];
  failed: Array<{ file: File; error: { code: string; message: string } }>;
}> {
  const uploaded: UploadedFile[] = [];
  const failed: Array<{ file: File; error: { code: string; message: string } }> = [];
  for (let i = 0; i < files.length; i += 1) {
    const res = await uploadNotaFile({ ...opts, file: files[i] });
    if (res.ok) uploaded.push(res.data);
    else failed.push({ file: files[i], error: res.error });
    onProgress?.(i + 1, files.length);
  }
  return { uploaded, failed };
}
