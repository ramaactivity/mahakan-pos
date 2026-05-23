import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import {
  pushSubscriptions,
  userNotificationSubscriptions,
  users,
} from "@/db/schema";
import {
  getDefaultCategoriesForUser,
  isInQuietWindow,
  URGENT_CATEGORIES,
  type NotificationCategory,
} from "./categories";

let vapidConfigured = false;
let vapidWarned = false;

/**
 * Init VAPID keys dari env. Idempotent — dipanggil di setiap send.
 * Return true kalau berhasil setup, false kalau env tidak lengkap.
 */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    if (!vapidWarned) {
      console.warn(
        "[push] VAPID env missing (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT). Push notif disabled.",
      );
      vapidWarned = true;
    }
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
  } catch (e) {
    console.error("[push] setVapidDetails failed:", e);
    return false;
  }
}

export function isWebPushConfigured(): boolean {
  return ensureVapidConfigured();
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path untuk dibuka saat klik notif. Default /dashboard. */
  url?: string;
  /** Tag untuk consolidate (notif baru replace notif lama dengan tag sama). */
  tag?: string;
}

/**
 * Send push ke 1 user (semua subscription mereka — bisa multi-device).
 * Tidak filter category — pakai sendCategorizedPush kalau butuh routing.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; cleaned: number; failed: number }> {
  if (!ensureVapidConfigured()) {
    return { sent: 0, cleaned: 0, failed: 0 };
  }
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return await sendToSubscriptions(subs, payload);
}

/**
 * Send push ke semua user di outlet yang punya role tertentu (default
 * `owner`). Tidak filter category — pakai sendCategorizedPush kalau
 * butuh routing per-category.
 */
export async function sendPushToOutletVerifiers(
  outletId: string,
  payload: PushPayload,
  opts: { roles?: Array<"owner" | "manager"> } = {},
): Promise<{ sent: number; cleaned: number; failed: number }> {
  if (!ensureVapidConfigured()) {
    return { sent: 0, cleaned: 0, failed: 0 };
  }
  const roles = opts.roles ?? ["owner"];
  const verifierUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.outletId, outletId), inArray(users.role, roles)),
    );
  if (verifierUsers.length === 0) {
    return { sent: 0, cleaned: 0, failed: 0 };
  }
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.outletId, outletId),
        inArray(
          pushSubscriptions.userId,
          verifierUsers.map((u) => u.id),
        ),
      ),
    );
  return await sendToSubscriptions(subs, payload);
}

/**
 * Sesi AE-124 — Send push ke semua user di outlet yang SUBSCRIBED ke
 * category tertentu.
 *
 * Subscription logic:
 *   1. Fetch all users di outlet (active, not deleted)
 *   2. Per user, decide subscribed-or-not:
 *      a. Fetch user_notification_subscriptions row untuk (user_id, category)
 *      b. Kalau row ada → ikuti `enabled` field
 *      c. Kalau snooze_until > now → suppress (return false)
 *      d. Kalau row tidak ada → pakai default berdasarkan email/role
 *   3. Filter by quiet hours kecuali category URGENT
 *   4. Fetch push_subscriptions untuk subscribed users
 *   5. Send via web-push
 *
 * Anti-noise:
 *   - Quiet hours (per user) di-honor kecuali URGENT
 *   - Snooze (per user-category) di-honor
 *   - URGENT_CATEGORIES bypass quiet hours
 */
export async function sendCategorizedPush(
  category: NotificationCategory,
  outletId: string,
  payload: PushPayload,
): Promise<{
  sent: number;
  cleaned: number;
  failed: number;
  skippedQuiet: number;
  skippedSnooze: number;
  skippedOptOut: number;
}> {
  if (!ensureVapidConfigured()) {
    return {
      sent: 0,
      cleaned: 0,
      failed: 0,
      skippedQuiet: 0,
      skippedSnooze: 0,
      skippedOptOut: 0,
    };
  }

  /* 1. Fetch all active users di outlet + quiet hours. */
  const outletUsers = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      quietStartMin: users.notificationQuietStartMin,
      quietEndMin: users.notificationQuietEndMin,
    })
    .from(users)
    .where(and(eq(users.outletId, outletId), eq(users.status, "active")));

  if (outletUsers.length === 0) {
    return {
      sent: 0,
      cleaned: 0,
      failed: 0,
      skippedQuiet: 0,
      skippedSnooze: 0,
      skippedOptOut: 0,
    };
  }

  /* 2. Fetch subscription rows untuk semua user di outlet + category ini. */
  const subRows = await db
    .select()
    .from(userNotificationSubscriptions)
    .where(
      and(
        eq(userNotificationSubscriptions.category, category),
        inArray(
          userNotificationSubscriptions.userId,
          outletUsers.map((u) => u.id),
        ),
      ),
    );
  const subByUserId = new Map(subRows.map((r) => [r.userId, r]));

  /* 3. Compute nowMin di WIB (UTC+7). */
  const nowDate = new Date();
  const nowUtcMin = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
  const nowWibMin = (nowUtcMin + 7 * 60) % 1440;
  const nowMs = nowDate.getTime();

  /* 4. Decide per user: subscribed + not in quiet + not snoozed. */
  const targetUserIds: string[] = [];
  let skippedQuiet = 0;
  let skippedSnooze = 0;
  let skippedOptOut = 0;
  const isUrgent = URGENT_CATEGORIES.has(category);

  for (const u of outletUsers) {
    const sub = subByUserId.get(u.id);
    let isSubscribed: boolean;
    if (sub) {
      isSubscribed = sub.enabled;
    } else {
      const defaults = getDefaultCategoriesForUser(u.email, u.role);
      isSubscribed = defaults.has(category);
    }
    if (!isSubscribed) {
      skippedOptOut++;
      continue;
    }
    /* Snooze check. */
    if (sub?.snoozeUntil && sub.snoozeUntil.getTime() > nowMs) {
      skippedSnooze++;
      continue;
    }
    /* Quiet hours check (bypass kalau urgent). */
    if (
      !isUrgent &&
      isInQuietWindow(nowWibMin, u.quietStartMin, u.quietEndMin)
    ) {
      skippedQuiet++;
      continue;
    }
    targetUserIds.push(u.id);
  }

  if (targetUserIds.length === 0) {
    return {
      sent: 0,
      cleaned: 0,
      failed: 0,
      skippedQuiet,
      skippedSnooze,
      skippedOptOut,
    };
  }

  /* 5. Fetch push_subscriptions untuk target users + send. */
  const pushSubs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, targetUserIds));
  const sendResult = await sendToSubscriptions(pushSubs, payload);
  return {
    ...sendResult,
    skippedQuiet,
    skippedSnooze,
    skippedOptOut,
  };
}

async function sendToSubscriptions(
  subs: Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>,
  payload: PushPayload,
): Promise<{ sent: number; cleaned: number; failed: number }> {
  let sent = 0;
  let cleaned = 0;
  let failed = 0;
  const dataStr = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/dashboard",
    tag: payload.tag ?? "mahakan-notif",
  });
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          dataStr,
          { TTL: 60 * 60 * 24 }, // expire push setelah 24 jam
        );
        sent++;
      } catch (e) {
        const statusCode =
          e && typeof e === "object" && "statusCode" in e
            ? (e as { statusCode: number }).statusCode
            : 0;
        /* 410 Gone / 404 Not Found = subscription invalid (browser revoked).
         * Auto-cleanup row. Other error = transient (network/quota), log. */
        if (statusCode === 410 || statusCode === 404) {
          try {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, sub.id));
            cleaned++;
          } catch {
            failed++;
          }
        } else {
          console.error(
            "[push] send fail:",
            statusCode,
            e instanceof Error ? e.message : String(e),
          );
          failed++;
        }
      }
    }),
  );
  return { sent, cleaned, failed };
}
