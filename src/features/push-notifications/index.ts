/**
 * Sesi AE-123 — Web Push notification module.
 *
 * Pengaturan:
 *   - VAPID keys di Vercel env: NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY
 *   - VAPID subject (mailto:) di env VAPID_SUBJECT
 *   - Kalau env tidak di-set, semua function gracefully no-op (server log
 *     warning). UI subscribe tetap tampil tapi tombol disabled.
 *
 * Untuk generate VAPID keys (Rama jalankan di terminal-nya, sekali saja):
 *   npx web-push generate-vapid-keys
 *   → publicKey, privateKey (catat keduanya)
 *   → Vercel env NEXT_PUBLIC_VAPID_PUBLIC_KEY = publicKey
 *   → Vercel env VAPID_PRIVATE_KEY = privateKey
 *   → Vercel env VAPID_SUBJECT = "mailto:owner@mahakan.local" (atau email valid)
 *   → Redeploy supaya env diakses build.
 */
export {
  sendPushToUser,
  sendPushToOutletVerifiers,
  isWebPushConfigured,
} from "./server";
export type { PushPayload } from "./server";
