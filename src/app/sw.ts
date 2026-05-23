/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Sesi AD-13 bugfix — bump SW_TAG when a release needs to evict stale runtime
// cache entries (iPhone Safari yang serve cached 302 redirect /m → /login
// dari pre-AD-12). Mengubah konstanta ini = sw.js byte-diff = forced
// reinstall di client → activate listener jalan → entries ke-/m + ke-/login
// di-delete dari semua runtime cache.
const SW_TAG = "ae135-push-banner-reset";
const STALE_PATH_PATTERNS = [
  /\/m(\/|$|\?)/,
  /\/login(\/|$|\?)/,
  /\/icon-staff-/,
  /\/manifest-staff/,
  /\/manifest\.webmanifest/,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      console.info("[SW]", SW_TAG, "evicting stale /m + /login cache entries");
      const names = await caches.keys();
      await Promise.all(
        names.map(async (name) => {
          const cache = await caches.open(name);
          const reqs = await cache.keys();
          await Promise.all(
            reqs
              .filter((r) =>
                STALE_PATH_PATTERNS.some((p) => p.test(new URL(r.url).pathname)),
              )
              .map((r) => cache.delete(r)),
          );
        }),
      );
    })(),
  );
});

/* Sesi AE-123 — Web Push event handler.
 *
 * Payload format yang server kirim (JSON):
 *   { title, body, url?, tag? }
 *
 * `tag` digunakan untuk consolidate notif yang sama (mis. tag="setoran-pending"
 * → notif baru replace notif lama supaya owner tidak banjir tab notif).
 * `url` = path yang dibuka saat user klik notif (default /dashboard).
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: {
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
  } = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Mahakan POS", body: event.data.text() };
  }
  const title = payload.title ?? "Mahakan POS";
  const options: NotificationOptions & { tag?: string } = {
    body: payload.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag ?? "mahakan-notif",
    data: { url: payload.url ?? "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification as Notification).data as
    | { url?: string }
    | undefined;
  const targetUrl = data?.url ?? "/dashboard";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      /* Focus tab yang sudah buka admin kalau ada, navigate ke targetUrl. */
      for (const client of allClients) {
        if (client.url.includes("/dashboard")) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await (
                client as WindowClient & {
                  navigate?: (url: string) => Promise<WindowClient>;
                }
              ).navigate?.(targetUrl);
            } catch {
              /* ignore navigate fail (cross-origin or unsupported). */
            }
          }
          return;
        }
      }
      /* No existing tab → buka tab baru. */
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
