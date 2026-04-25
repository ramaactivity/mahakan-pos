import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * GET /api/v1/auth/pin-users — list active users with a PIN set, for the
 * tablet POS PIN-login screen avatar grid.
 *
 * Public (no session required) so unauthenticated tablet can render. Returns
 * minimal info (id, name, role) — no email/contact. Failed PIN attempts are
 * tracked server-side via users.failedAttempts to throttle brute-force.
 */
export async function GET() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        isNull(users.deletedAt),
        isNotNull(users.pinHash),
      ),
    );

  return NextResponse.json({ items: rows });
}
