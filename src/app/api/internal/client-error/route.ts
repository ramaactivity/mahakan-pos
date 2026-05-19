import { NextResponse } from "next/server";

/**
 * Sesi AE-63 hotfix-2 — Catch client-side errors triggered by error
 * boundary di `(admin)/error.tsx`. Logs ke Vercel function logs supaya
 * owner-side debug bisa baca actual error message + stack tanpa harus
 * buka browser console.
 *
 * Endpoint dipanggil best-effort dari error.tsx useEffect. Tidak ada
 * authentication (any session). Cuma log + return 200.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      message?: string;
      name?: string;
      digest?: string;
      stack?: string;
      path?: string;
      userAgent?: string;
    };
    console.error("[client-error]", {
      message: body.message,
      name: body.name,
      digest: body.digest,
      stack: body.stack,
      path: body.path,
      userAgent: body.userAgent,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[client-error endpoint failed]", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
