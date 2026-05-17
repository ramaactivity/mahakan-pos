import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { outlets, users } from "@/db/schema";

/**
 * GET /api/v1/auth/pin-users?outlet=<uuid> — list active users with a PIN
 * set, for the tablet POS PIN-login screen avatar grid.
 *
 * Public (no session required) so unauthenticated tablet can render. Returns
 * minimal info (id, name, role) — no email/contact. Failed PIN attempts are
 * tracked server-side via users.failedAttempts to throttle brute-force.
 *
 * Sesi AE-62i — outlet scoping. Sebelumnya endpoint return SEMUA users di
 * sistem (no outlet filter) → di multi-outlet future user enumeration
 * exposed. Sekarang:
 *  - Required: ?outlet=<uuid> query param
 *  - Backward compat: kalau cuma 1 outlet di system, auto-pick (mahakan
 *    single-outlet sekarang). Multi-outlet → wajib query param.
 */
export async function GET(request: NextRequest) {
  const outletParam = request.nextUrl.searchParams.get("outlet");

  let outletId: string | null = outletParam;

  if (!outletId) {
    // Backward-compat: jika cuma 1 outlet di system, pick yang itu.
    // Mencegah enumerate multi-outlet di future tanpa breaking single-outlet
    // tablet sekarang.
    const allOutlets = await db
      .select({ id: outlets.id })
      .from(outlets)
      .limit(2);
    if (allOutlets.length === 1) {
      outletId = allOutlets[0].id;
    } else if (allOutlets.length > 1) {
      return NextResponse.json(
        {
          error:
            "Multi-outlet detected — ?outlet=<id> query param required",
        },
        { status: 400 },
      );
    } else {
      return NextResponse.json({ items: [] });
    }
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.outletId, outletId),
        eq(users.status, "active"),
        isNull(users.deletedAt),
        isNotNull(users.pinHash),
      ),
    );

  return NextResponse.json({ items: rows });
}
