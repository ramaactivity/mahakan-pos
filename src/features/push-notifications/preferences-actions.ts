"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { userNotificationSubscriptions, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  getDefaultCategoriesForUser,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "./categories";

export interface UserNotificationPreference {
  category: NotificationCategory;
  enabled: boolean;
  snoozeUntil: Date | null;
  /** True kalau row tidak ada di DB (pakai default). False kalau user
   * sudah customize. */
  isDefault: boolean;
}

export interface UserNotificationSettings {
  quietStartMin: number;
  quietEndMin: number;
  preferences: UserNotificationPreference[];
}

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Fetch settings notif user yang login. Kombinasi:
 *   - users.notificationQuietStartMin / notificationQuietEndMin
 *   - user_notification_subscriptions row (per category) — atau default
 *     berdasarkan email/role kalau row tidak ada.
 */
export async function fetchOwnNotificationSettings(): Promise<
  ActionResult<UserNotificationSettings>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi expired");

  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      quietStartMin: users.notificationQuietStartMin,
      quietEndMin: users.notificationQuietEndMin,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!u) return fail("NOT_FOUND", "User tidak ditemukan");

  const subRows = await db
    .select()
    .from(userNotificationSubscriptions)
    .where(eq(userNotificationSubscriptions.userId, session.user.id));
  const subByCategory = new Map(subRows.map((r) => [r.category, r]));

  const defaults = getDefaultCategoriesForUser(u.email, u.role);

  const preferences: UserNotificationPreference[] =
    NOTIFICATION_CATEGORIES.map((cat) => {
      const row = subByCategory.get(cat);
      if (row) {
        return {
          category: cat,
          enabled: row.enabled,
          snoozeUntil: row.snoozeUntil,
          isDefault: false,
        };
      }
      return {
        category: cat,
        enabled: defaults.has(cat),
        snoozeUntil: null,
        isDefault: true,
      };
    });

  return ok({
    quietStartMin: u.quietStartMin,
    quietEndMin: u.quietEndMin,
    preferences,
  });
}

/**
 * Set enabled state untuk 1 category (upsert).
 */
export async function setNotificationCategoryEnabled(
  category: NotificationCategory,
  enabled: boolean,
): Promise<ActionResult<{ category: NotificationCategory; enabled: boolean }>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi expired");
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    return fail("VALIDATION_ERROR", "Category tidak dikenal");
  }

  /* Upsert: kalau row ada update, kalau tidak insert. */
  const [existing] = await db
    .select({ id: userNotificationSubscriptions.id })
    .from(userNotificationSubscriptions)
    .where(
      and(
        eq(userNotificationSubscriptions.userId, session.user.id),
        eq(userNotificationSubscriptions.category, category),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(userNotificationSubscriptions)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(userNotificationSubscriptions.id, existing.id));
  } else {
    await db.insert(userNotificationSubscriptions).values({
      userId: session.user.id,
      category,
      enabled,
    });
  }

  return ok({ category, enabled });
}

/**
 * Snooze 1 category untuk durasi tertentu (jam). Set null untuk un-snooze.
 */
export async function setNotificationCategorySnooze(
  category: NotificationCategory,
  durationHours: number | null,
): Promise<
  ActionResult<{ category: NotificationCategory; snoozeUntil: Date | null }>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi expired");
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    return fail("VALIDATION_ERROR", "Category tidak dikenal");
  }
  if (durationHours !== null && (durationHours <= 0 || durationHours > 168)) {
    return fail("VALIDATION_ERROR", "Snooze 1-168 jam (max 1 minggu)");
  }

  const snoozeUntil = durationHours
    ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
    : null;

  const [existing] = await db
    .select({ id: userNotificationSubscriptions.id })
    .from(userNotificationSubscriptions)
    .where(
      and(
        eq(userNotificationSubscriptions.userId, session.user.id),
        eq(userNotificationSubscriptions.category, category),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(userNotificationSubscriptions)
      .set({ snoozeUntil, updatedAt: new Date() })
      .where(eq(userNotificationSubscriptions.id, existing.id));
  } else {
    await db.insert(userNotificationSubscriptions).values({
      userId: session.user.id,
      category,
      enabled: true,
      snoozeUntil,
    });
  }

  return ok({ category, snoozeUntil });
}

/**
 * Update quiet hours (HH:MM start + end). Disabled = start == end.
 */
export async function setNotificationQuietHours(
  startMin: number,
  endMin: number,
): Promise<ActionResult<{ startMin: number; endMin: number }>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi expired");
  if (
    !Number.isInteger(startMin) ||
    !Number.isInteger(endMin) ||
    startMin < 0 ||
    startMin > 1439 ||
    endMin < 0 ||
    endMin > 1439
  ) {
    return fail("VALIDATION_ERROR", "Quiet hours 00:00-23:59");
  }

  await db
    .update(users)
    .set({
      notificationQuietStartMin: startMin,
      notificationQuietEndMin: endMin,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  return ok({ startMin, endMin });
}
