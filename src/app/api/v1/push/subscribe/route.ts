/**
 * Sesi AE-123 — Web Push subscription endpoints.
 *
 * POST /api/v1/push/subscribe
 *   Body: { endpoint, keys: { p256dh, auth } }
 *   Auth: NextAuth session (any role). User_id + outlet_id derived from session.
 *   Behavior: upsert by endpoint. Browser subscribe → save row. Existing
 *   row (refresh dari browser) di-update userId/outletId (handle re-login).
 *
 * DELETE /api/v1/push/subscribe?endpoint=...
 *   Auth: NextAuth session.
 *   Behavior: hapus row by endpoint (only kalau milik user yang login,
 *   safety scoping).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { auth } from "@/lib/auth";

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sesi expired" } },
      { status: 401 },
    );
  }
  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "JSON invalid" } },
      { status: 400 },
    );
  }
  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const authKey = body.keys?.auth?.trim();
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Payload subscribe tidak lengkap",
        },
      },
      { status: 400 },
    );
  }
  if (endpoint.length > 2048) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Endpoint terlalu panjang",
        },
      },
      { status: 400 },
    );
  }
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  /* Upsert by endpoint (unique index). Kalau row sudah ada (browser refresh),
   * update userId + outletId (handle user re-login di browser yang sama). */
  const [existing] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);

  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({
        userId: session.user.id,
        outletId: session.user.outletId,
        p256dh,
        auth: authKey,
        userAgent,
        updatedAt: new Date(),
      })
      .where(eq(pushSubscriptions.id, existing.id));
    return NextResponse.json({ ok: true, data: { id: existing.id, updated: true } });
  }

  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      userId: session.user.id,
      outletId: session.user.outletId,
      endpoint,
      p256dh,
      auth: authKey,
      userAgent,
    })
    .returning({ id: pushSubscriptions.id });

  return NextResponse.json({ ok: true, data: { id: row.id, updated: false } });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sesi expired" } },
      { status: 401 },
    );
  }
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Endpoint param wajib",
        },
      },
      { status: 400 },
    );
  }
  /* Scope hapus ke user yang login supaya tidak bisa hapus subscription
   * orang lain (kalau attacker tau endpoint). */
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, session.user.id),
      ),
    );

  return NextResponse.json({ ok: true });
}
