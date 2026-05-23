import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import type { Role } from "@/lib/auth";
import type {
  ListUsersOptions,
  Paginated,
  PublicUser,
  User,
} from "./types";

function toPublicUser(
  u: User,
  pushExtras: { pushDeviceCount: number; pushLatestSubscribedAt: Date | null } = {
    pushDeviceCount: 0,
    pushLatestSubscribedAt: null,
  },
): PublicUser {
  return {
    id: u.id,
    outletId: u.outletId,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    status: u.status as PublicUser["status"],
    failedAttempts: u.failedAttempts,
    lockedUntil: u.lockedUntil,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    deletedAt: u.deletedAt,
    createdBy: u.createdBy,
    updatedBy: u.updatedBy,
    hasPasswordSet: u.passwordHash !== null,
    hasPinSet: u.pinHash !== null,
    pushDeviceCount: pushExtras.pushDeviceCount,
    pushLatestSubscribedAt: pushExtras.pushLatestSubscribedAt,
  };
}

export async function fetchUsers(
  outletId: string,
  viewerRole: Role,
  opts: ListUsersOptions = {},
): Promise<Paginated<PublicUser>> {
  const conds = [eq(users.outletId, outletId), isNull(users.deletedAt)];
  if (opts.role) conds.push(eq(users.role, opts.role));
  if (opts.status) conds.push(eq(users.status, opts.status));
  if (opts.search) {
    const like = `%${opts.search.toLowerCase()}%`;
    conds.push(sql`lower(${users.name}) like ${like}`);
  }
  // Manager can only see Staff (per docs/05-ROLES-RBAC §3)
  if (viewerRole === "manager") conds.push(eq(users.role, "staff"));

  /* Sesi AE-134 — LEFT JOIN aggregate push_subscriptions supaya staff
   * management bisa nampilkan kolom Notif (device count + last subscribed
   * timestamp). GROUP BY semua user kolom karena postgres strict. */
  const rows = await db
    .select({
      user: users,
      pushDeviceCount: sql<number>`count(${pushSubscriptions.id})::int`,
      pushLatestSubscribedAt: sql<Date | null>`max(${pushSubscriptions.createdAt})`,
    })
    .from(users)
    .leftJoin(pushSubscriptions, eq(pushSubscriptions.userId, users.id))
    .where(and(...conds))
    .groupBy(users.id)
    .orderBy(users.role, users.name);

  return {
    items: rows.map((r) =>
      toPublicUser(r.user, {
        pushDeviceCount: r.pushDeviceCount ?? 0,
        pushLatestSubscribedAt: r.pushLatestSubscribedAt,
      }),
    ),
    total: rows.length,
  };
}

export async function fetchUserById(
  id: string,
): Promise<PublicUser | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return row ? toPublicUser(row) : null;
}

export async function countActiveOwners(
  outletId: string,
  excludeUserId?: string,
): Promise<number> {
  const conds = [
    eq(users.outletId, outletId),
    eq(users.role, "owner"),
    eq(users.status, "active"),
    isNull(users.deletedAt),
  ];
  if (excludeUserId) conds.push(ne(users.id, excludeUserId));
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(...conds));
  return c;
}

export async function emailTaken(
  outletId: string,
  email: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.outletId, outletId),
        eq(users.email, email.toLowerCase()),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export { toPublicUser };
