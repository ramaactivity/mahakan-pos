import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import {
  buildFriendlyFilename,
  isDriveConfigured,
  uploadToDrive,
} from "@/lib/google-drive/uploader";

/**
 * POST /api/v1/journal-receipts/upload — sesi AE-206.
 *
 * Bukti transaksi/transfer untuk Entry Jurnal Manual. Filenya naik ke Google
 * Drive folder "BUKTI JURNAL/{YYYY}/{NN. BULAN}/" (dibuat otomatis per bulan
 * mengikuti tanggal entry), lalu URL-nya disimpan di
 * `journal_entries.receipt_image_url`.
 *
 * Multipart/form-data:
 *   file      — JPG/PNG/WebP/PDF, maks 5 MB
 *   entryDate — YYYY-MM-DD (menentukan subfolder tahun/bulan)
 *
 * Response: { url, folderPath }
 *
 * RBAC: `accounting.journal.draft` — sama dengan hak membuat entry manual
 * (owner + manager). Sengaja bukan `.post`: manager yang menyiapkan draft
 * juga perlu melampirkan buktinya.
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
    if (!hasPermission(session.user.role, "accounting.journal.draft")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak punya hak upload bukti jurnal",
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
    const entryDate = form.get("entryDate");
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
      typeof entryDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "field 'entryDate' wajib (YYYY-MM-DD)",
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
      label: "BUKTI JURNAL",
      parts: [entryDate],
      uploaderName: session.user.name,
      originalName: file.name,
      contentType: file.type,
    });
    const result = await uploadToDrive({
      module: "journal",
      context: { date: entryDate },
      originalName: file.name,
      contentType: file.type,
      data: buffer,
      customFilename,
    });

    return NextResponse.json({
      success: true,
      data: { url: result.url, folderPath: result.folderPath },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload gagal";
    return NextResponse.json(
      { success: false, error: { code: "UPLOAD_ERROR", message } },
      { status: 500 },
    );
  }
}
