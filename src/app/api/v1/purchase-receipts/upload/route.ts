import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import {
  isDriveConfigured,
  uploadPurchaseReceiptToDrive,
} from "@/lib/google-drive/uploader";

/**
 * POST /api/v1/purchase-receipts/upload — sesi AA #2 (Opsi B).
 *
 * Receives multipart/form-data dengan field:
 *   file         — File object (JPG/PNG/WebP/PDF, max 5 MB)
 *   purchaseDate — YYYY-MM-DD (drives the year/month subfolder)
 *
 * Uploads ke Google Drive folder "NOTA MAHAKAN/{YYYY}/{NN. MONTH}/"
 * matching Owner's existing nota archive structure. File made shareable
 * (anyone-with-link reader) — Owner copy-paste URL ke akuntan tanpa
 * Mahakan POS login.
 *
 * Response shape: { url: string, folderPath: string }
 *
 * REPLACES the previous Vercel Blob direct-upload flow. The 4.5 MB
 * Next.js body limit applies (was bypassed dengan client-direct upload
 * to Blob). Receipts biasanya < 1 MB so this is safe.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *   GOOGLE_DRIVE_NOTA_PARENT_ID
 * See docs/12-DRIVE-INTEGRATION.md untuk panduan setup.
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
    if (!hasPermission(session.user.role, "purchase.create")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak punya hak upload bukti pembelian",
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
    const purchaseDate = form.get("purchaseDate");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: "field 'file' wajib" },
        },
        { status: 400 },
      );
    }
    if (typeof purchaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "field 'purchaseDate' wajib (YYYY-MM-DD)",
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
    const result = await uploadPurchaseReceiptToDrive({
      purchaseDate,
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
