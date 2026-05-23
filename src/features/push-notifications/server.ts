import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";

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
 * Gracefully no-op kalau VAPID tidak di-set. Auto-cleanup subscription
 * kalau 410 Gone / 404 (browser revoked).
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
 * `owner`). Dipakai untuk notif setoran pending: owner harus tahu, manager
 * not necessarily.
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
  /* Find user_ids yang punya role + active di outlet */
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
