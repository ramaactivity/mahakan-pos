import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * POST /api/v1/employee-documents/upload — generate signed token for client
 * upload to Vercel Blob.
 *
 * Used by the EmployeeDocsModal upload flow. Client posts file metadata,
 * we authenticate + authorize, then return a token that lets the browser
 * upload directly to Blob storage (bypasses 4.5MB Next.js server body limit).
 *
 * Requires BLOB_READ_WRITE_TOKEN env var (set in Vercel project settings).
 * Requires session with `employees.manage` permission.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await auth();
        if (!session) throw new Error("Unauthorized");
        if (!hasPermission(session.user.role, "employee.update")) {
          throw new Error("Tidak punya hak upload dokumen karyawan");
        }
        // Validate file extension on the path the client supplied.
        const lower = pathname.toLowerCase();
        const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
        if (!allowed.some((ext) => lower.endsWith(ext))) {
          throw new Error("Tipe file tidak diizinkan (PDF/JPG/PNG/WebP)");
        }
        return {
          allowedContentTypes: [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
          ],
          maximumSizeInBytes: 10 * 1024 * 1024, // 10 MB
          tokenPayload: JSON.stringify({
            actorId: session.user.id,
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async () => {
        // Hook for post-upload audit logging — left as no-op for now since the
        // server action that creates employeeDocument row already logs audit.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload gagal";
    return NextResponse.json(
      { success: false, error: { code: "UPLOAD_ERROR", message } },
      { status: 400 },
    );
  }
}
