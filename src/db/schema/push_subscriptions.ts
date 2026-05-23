import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { outlets } from "./outlets";

/**
 * Sesi AE-123 — Web Push subscription registry.
 *
 * Per browser instance pakai 1 row. User bisa subscribe dari multiple
 * device (desktop chrome + tablet safari) → multiple row per user.
 * Endpoint unique (PushSubscription endpoint is the immutable identifier).
 *
 * Lifecycle:
 *   - Subscribe: row created via /api/v1/push/subscribe (POST)
 *   - Unsubscribe: row deleted via /api/v1/push/subscribe (DELETE) atau
 *     auto-cleanup kalau push() throw 410 Gone / 404 (browser revoked).
 *   - Send: server pull rows by user_id atau outlet_id, loop push().
 *
 * Keys p256dh + auth = encryption material yang browser provide saat
 * pushManager.subscribe(). Server pakai untuk encrypt payload via web-push
 * library (VAPID + AES-GCM). Tidak di-rotate, tapi user revoke kapan saja.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Browser-provided endpoint URL (FCM/Mozilla/Apple push service). */
    endpoint: text("endpoint").notNull(),
    /** P-256 ECDH public key (base64-url encoded). */
    p256dh: text("p256dh").notNull(),
    /** Auth secret (base64-url encoded). */
    auth: text("auth").notNull(),
    /** User-Agent saat subscribe — untuk debugging multi-device. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Updated saat browser refresh subscription (rare). */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ux_push_sub_endpoint").on(t.endpoint)],
);
