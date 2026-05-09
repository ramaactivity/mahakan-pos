import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import {
  buildFriendlyFilename,
  isDriveConfigured,
  uploadToDrive,
} from "@/lib/google-drive/uploader";

/**
 * POST /api/v1/setoran-receipts/upload — sesi AE-8.
 *
 * Receives multipart/form-data dengan field:
 *   file        — File object (JPG/PNG/WebP/PDF, max 5 MB)
 *   depositDate — YYYY-MM-DD (drives the year/month subfolder)
 *
 * Uploads ke Google Drive folder
 *   "BUKTI SETORAN/BUKTI SETORAN {YYYY}/{NN. MONTH}/"
 * paralel pattern Owner's NOTA MAHAKAN archive. File made shareable
 * (anyone-with-link reader). Photo URL stamped ke cash_deposits.photo_url.
 *
 * Same 4.5 MB Next.js body limit. Bank slips typically < 1 MB so safe.
 *
 * Required env vars (sama dengan upload module lain):
 *   GOOGLE_OAUTH_CLIENT_ID / SECRET / REFRESH_TOKEN
 *   GOOGLE_DRIVE_ROOT_PARENT_ID
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
    if (!hasPermission(session.user.role, "cash_deposit.create")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak punya hak upload bukti setoran",
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
              "Google Drive belum di-setup. Owner perlu set env vars di Vercel — lihat docs/12-DRIVE-INTEGRATION.md.",
          },
        },
        { status: 500 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const depositDate = form.get("depositDate");
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
      typeof depositDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(depositDate)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "field 'depositDate' wajib (YYYY-MM-DD)",
          },
        },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: "Ukuran maksimal 5 MB",
          },
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
      label: "BUKTI",
      parts: [depositDate],
      uploaderName: session.user.name,
      originalName: file.name,
      contentType: file.type,
    });
    const result = await uploadToDrive({
      module: "setoran",
      context: { date: depositDate },
      originalName: file.name,
      contentType: file.type,
      data: buffer,
      customFilename,
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
