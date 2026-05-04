import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/db";
import { employees } from "@/db/schema";
import {
  buildFriendlyFilename,
  isDriveConfigured,
  uploadToDrive,
} from "@/lib/google-drive/uploader";

/**
 * POST /api/v1/employee-documents/upload — sesi AA #2 extension.
 *
 * Migrated dari Vercel Blob direct-upload ke Google Drive (folder
 * "DOKUMEN HR/{Nama Karyawan}/" auto-created per karyawan). Server
 * resolves employee name via DB based on employeeId — biar tidak ada
 * tampering nama dari client.
 *
 * Multipart/form-data fields:
 *   file        — File object (PDF/JPG/PNG/WebP, max 10 MB)
 *   employeeId  — UUID of the employee
 *
 * Response: { url: string, folderPath: string }
 *
 * Required env vars: GOOGLE_OAUTH_* + GOOGLE_DRIVE_ROOT_PARENT_ID.
 * RBAC: requires `employee.update` permission.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
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
    if (!hasPermission(session.user.role, "employee.update")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak punya hak upload dokumen karyawan",
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
    const employeeId = form.get("employeeId");
    // Optional metadata for filename composition (sesi AA hotfix #2 —
    // auto-rename). If absent, fallback to generic label.
    const docType = form.get("docType");
    const docTitle = form.get("docTitle");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: "field 'file' wajib" },
        },
        { status: 400 },
      );
    }
    if (typeof employeeId !== "string" || employeeId.length < 8) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "field 'employeeId' wajib (UUID)",
          },
        },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "FILE_TOO_LARGE", message: "Ukuran maksimal 10 MB" },
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
            message: "Tipe file harus PDF / JPG / PNG / WebP",
          },
        },
        { status: 400 },
      );
    }

    // Resolve employee name from DB — server-side source of truth, prevents
    // client tampering with folder name. Outlet scope inherits from session.
    const [emp] = await db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        outletId: employees.outletId,
      })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!emp) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Karyawan tidak ditemukan" },
        },
        { status: 404 },
      );
    }
    if (emp.outletId !== session.user.outletId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Karyawan tidak di outlet kamu",
          },
        },
        { status: 403 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const labelFromDocType =
      typeof docType === "string" && docType.trim().length > 0
        ? docType.trim()
        : "DOK";
    const titleSlug = typeof docTitle === "string" ? docTitle : null;
    const customFilename = buildFriendlyFilename({
      label: labelFromDocType,
      parts: [emp.fullName, titleSlug],
      uploaderName: session.user.name,
      originalName: file.name,
      contentType: file.type,
    });
    const result = await uploadToDrive({
      module: "hr",
      context: { employeeId: emp.id, employeeName: emp.fullName },
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
