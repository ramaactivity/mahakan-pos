import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * POST /api/v1/expense-receipts/upload — generate signed token for client
 * upload to Vercel Blob (foto struk pengeluaran).
 *
 * Mirror of employee-documents/upload pattern. Client → /upload → token →
 * direct browser-to-Blob upload (bypass 4.5MB Next.js server body limit).
 *
 * Requires BLOB_READ_WRITE_TOKEN env var. Requires session with `expense.create`.
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
        if (!hasPermission(session.user.role, "expense.create")) {
          throw new Error("Tidak punya hak upload struk");
        }
        // Image-only (foto struk).
        const lower = pathname.toLowerCase();
        const allowed = [".jpg", ".jpeg", ".png", ".webp"];
        if (!allowed.some((ext) => lower.endsWith(ext))) {
          throw new Error(
            "Tipe file tidak diizinkan (JPG/PNG/WebP — foto struk)",
          );
        }
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
          maximumSizeInBytes: 5 * 1024 * 1024, // 5 MB (struk biasanya ≤ 1 MB)
          tokenPayload: JSON.stringify({
            actorId: session.user.id,
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async () => {
        // Audit logged at expense.create / expense.update; upload itself is
        // pre-record so no audit event di sini.
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
