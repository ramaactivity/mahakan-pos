import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * POST /api/v1/purchase-receipts/upload — generate signed token for client
 * upload to Vercel Blob (bukti transfer / nota pembelian).
 *
 * Mirror of expense-receipts/upload + employee-documents/upload pattern.
 * Client → /upload → token → direct browser-to-Blob upload (bypass 4.5MB
 * Next.js server body limit). Sesi AA #2.
 *
 * Allows JPG/PNG/WebP (foto struk/transfer) + PDF (e-receipt dari bank
 * / aggregator yang biasanya kirim PDF). Max 5 MB per file.
 *
 * Requires BLOB_READ_WRITE_TOKEN env var. Requires session with
 * `purchase.create` permission.
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
        if (!hasPermission(session.user.role, "purchase.create")) {
          throw new Error("Tidak punya hak upload bukti pembelian");
        }
        const lower = pathname.toLowerCase();
        const allowed = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
        if (!allowed.some((ext) => lower.endsWith(ext))) {
          throw new Error(
            "Tipe file tidak diizinkan (JPG/PNG/WebP/PDF — foto nota atau bukti transfer)",
          );
        }
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ],
          maximumSizeInBytes: 5 * 1024 * 1024,
          tokenPayload: JSON.stringify({
            actorId: session.user.id,
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async () => {
        // Audit logged at purchase.create / purchase.update; upload itself
        // is pre-record so no audit event here.
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
