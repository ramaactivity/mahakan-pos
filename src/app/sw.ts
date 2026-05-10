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
const SW_TAG = "ae24-pwa-installable";
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
