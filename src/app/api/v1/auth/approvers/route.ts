import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * GET /api/v1/auth/approvers — list active Owner/Manager users with PIN set,
 * for the approver-override avatar grid in POS.
 *
 * Requires authenticated session (otherwise the modal shouldn't render).
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED" } },
      { status: 401 },
    );
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
        eq(users.status, "active"),
        isNull(users.deletedAt),
        isNotNull(users.pinHash),
        inArray(users.role, ["owner", "manager"]),
      ),
    );

  return NextResponse.json({ items: rows });
}
