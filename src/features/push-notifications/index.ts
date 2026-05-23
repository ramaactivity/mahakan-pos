/**
 * Sesi AE-123 + AE-124 — Web Push notification module.
 *
 * Pengaturan VAPID (sekali setup):
 *   - VAPID keys di Vercel env: NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY
 *   - VAPID subject (mailto:) di env VAPID_SUBJECT
 *
 * Pengaturan per-user (Settings → Notifikasi):
 *   - Toggle per category (attendance, payroll, shift, inventory, dll)
 *   - Quiet hours (default 22:00-06:00 WIB, customizable)
 *   - Snooze per category (1h, 8h, 24h, 1 week)
 */
export {
  sendPushToUser,
  sendPushToOutletVerifiers,
  sendCategorizedPush,
  isWebPushConfigured,
} from "./server";
export type { PushPayload } from "./server";

export {
  NOTIFICATION_CATEGORIES,
  CATEGORY_META,
  URGENT_CATEGORIES,
  getDefaultCategoriesForUser,
  isInQuietWindow,
  formatMinutesOfDay,
  parseMinutesOfDay,
} from "./categories";
export type { NotificationCategory, CategoryMeta } from "./categories";

export {
  fetchOwnNotificationSettings,
  setNotificationCategoryEnabled,
  setNotificationCategorySnooze,
  setNotificationQuietHours,
} from "./preferences-actions";
export type {
  UserNotificationPreference,
  UserNotificationSettings,
} from "./preferences-actions";
