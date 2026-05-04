import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import {
  isDriveConfigured,
  uploadToDrive,
} from "@/lib/google-drive/uploader";

/**
 * POST /api/v1/expense-receipts/upload — sesi AA #2 extension.
 *
 * Migrated dari Vercel Blob direct-upload ke Google Drive (folder
 * "STRUK PENGELUARAN/{YYYY}/{NN. MONTH}/" auto-created per bulan).
 *
 * Multipart/form-data fields:
 *   file        — File object (JPG/PNG/WebP/PDF, max 5 MB)
 *   expenseDate — YYYY-MM-DD (drives the year/month subfolder)
 *
 * Response: { url: string, folderPath: string }
 *
 * Required env vars: GOOGLE_OAUTH_* + GOOGLE_DRIVE_ROOT_PARENT_ID.
 * RBAC: requires `expense.create` permission.
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
        { success: false, error: { code: "UNAUTHORIZED", message: "Login dulu" } },
        { status: 401 },
      );
    }
    if (!hasPermission(session.user.role, "expense.create")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak punya hak upload struk pengeluaran",
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
    const expenseDate = form.get("expenseDate");
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
      typeof expenseDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "field 'expenseDate' wajib (YYYY-MM-DD)",
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
    const result = await uploadToDrive({
      module: "expense",
      context: { date: expenseDate },
      originalName: file.name,
      contentType: file.type,
      data: buffer,
    });

    return NextResponse.json({
      success: true,
      data: {
        url: result.url,
        folderPath: result.folderPath,
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
