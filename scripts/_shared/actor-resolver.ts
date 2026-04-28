/**
 * Resolves the user ID to attribute import/export audit entries to.
 * Looks up by `SEED_OWNER_EMAIL` env var (same pattern as scripts/list-users
 * + db/seed). Falls back to null (audit logger accepts null userId).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export async function resolveActorUserId(): Promise<string | null> {
  const email = process.env.SEED_OWNER_EMAIL;
  if (!email) return null;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row?.id ?? null;
}
