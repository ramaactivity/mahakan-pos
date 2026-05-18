import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { outlets, users } from "@/db/schema";

/**
 * Sesi AE-62r — extracted DRY helper untuk resolve email recipients
 * (owner) untuk approval code fan-out.
 *
 * Sebelumnya di-inline di:
 *   - src/features/shifts/rebalance-actions.ts (sesi AE-62o)
 *   - src/features/approval-codes/actions.ts (sesi AE-19/B-2)
 *
 * Sekarang shared supaya correction-actions juga bisa reuse tanpa
 * duplicate. Behavior identik dengan inline version.
 *
 * Resolution order:
 *   1. outlet.settings.approval.notifyEmails[] (multi-recipient, primary)
 *   2. outlet.settings.approval.notifyEmail (legacy single string)
 *   3. First active owner user.email (last-resort default)
 */
export async function resolveOwnerEmailRecipients(
  outletId: string,
): Promise<{
  emails: string[];
  primaryOwner: { id: string; name: string; email: string } | null;
} | null> {
  const [outlet] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const approval = (outlet?.settings as
    | { approval?: { notifyEmail?: string; notifyEmails?: string[] } }
    | null)?.approval;

  const [ownerUser] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.outletId, outletId),
        eq(users.role, "owner"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.createdAt))
    .limit(1);

  const collected = new Set<string>();
  if (approval?.notifyEmails && approval.notifyEmails.length > 0) {
    for (const e of approval.notifyEmails) {
      const t = e.trim();
      if (t.includes("@")) collected.add(t);
    }
  }
  if (
    collected.size === 0 &&
    approval?.notifyEmail &&
    approval.notifyEmail.includes("@")
  ) {
    collected.add(approval.notifyEmail.trim());
  }
  if (collected.size === 0 && ownerUser?.email) {
    collected.add(ownerUser.email);
  }
  if (collected.size === 0) return null;
  return {
    emails: Array.from(collected),
    primaryOwner: ownerUser?.email
      ? { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email }
      : null,
  };
}
