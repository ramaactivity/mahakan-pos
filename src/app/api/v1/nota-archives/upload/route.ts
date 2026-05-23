import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import {
  buildFriendlyFilename,
  isDriveConfigured,
  uploadToDrive,
} from "@/lib/google-drive/uploader";
import { notaArchiveCategoryValues } from "@/db/schema/nota_archives";

/**
 * POST /api/v1/nota-archives/upload — sesi AE-132.
 *
 * Stateless Drive upload for receipt archive module. Tidak menulis ke
 * DB di sini — caller (server action) yang record metadata + link
 * setelah dapat url + fileId + folderId. Itu memungkinkan:
 *   - Bulk upload: client kirim multi file, dapat array hasil → action
 *     buat 1 nota row + N file rows dalam satu transaksi.
 *   - Retry safe: kalau action fail setelah upload, file di Drive masih
 *     berguna (bisa dipakai uploader lain via file ID).
 *
 * Multipart/form-data fields:
 *   file        — File object (JPG/PNG/WebP/PDF, max 5 MB)
 *   notaDate    — YYYY-MM-DD (drives year/month folder)
 *   category    — one of notaArchiveCategoryValues (drives kategori
 *                 subfolder)
 *
 * Response: { url, folderPath, fileId, folderId, contentType, sizeBytes }
 *
 * RBAC: `nota_archive.create` (semua role).
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Login dulu" },
        },
        { status: 401 },
      );
    }
    if (!hasPermission(session.user.role, "nota_archive.create")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak punya hak upload nota",
          },
        },
        { status: 403 },
      );
    }
    if (!isDriveConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "DRIVE_NOT_CONFIGURED",
            message:
              "Google Drive belum di-setup. Lihat docs/12-DRIVE-INTEGRATION.md.",
          },
        },
        { status: 500 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const notaDate = form.get("notaDate");
    const category = form.get("category");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: "field 'file' wajib" },
        },
        { status: 400 },
      );
    }
    if (
      typeof notaDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(notaDate)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "field 'notaDate' wajib (YYYY-MM-DD)",
          },
        },
        { status: 400 },
      );
    }
    if (
      typeof category !== "string" ||
      !(notaArchiveCategoryValues as readonly string[]).includes(category)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "field 'category' invalid",
          },
        },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "FILE_TOO_LARGE", message: "Ukuran maksimal 5 MB" },
        },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_TYPE",
            message: "Tipe file harus JPG / PNG / WebP / PDF",
          },
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const customFilename = buildFriendlyFilename({
      label: "NOTA",
      parts: [notaDate, category],
      uploaderName: session.user.name,
      originalName: file.name,
      contentType: file.type,
    });
    const result = await uploadToDrive({
      module: "nota_archive",
      context: { date: notaDate, category },
      originalName: file.name,
      contentType: file.type,
      data: buffer,
      customFilename,
    });

    return NextResponse.json({
      success: true,
      data: {
        url: result.url,
        fileId: result.fileId,
        folderId: result.folderId,
        folderPath: result.folderPath,
        folderUrl: result.folderUrl,
        contentType: file.type,
        sizeBytes: file.size,
        originalName: file.name,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload gagal";
    return NextResponse.json(
      { success: false, error: { code: "UPLOAD_ERROR", message } },
      { status: 500 },
    );
  }
}
