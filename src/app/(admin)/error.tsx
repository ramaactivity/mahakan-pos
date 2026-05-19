"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

/* Sesi AE-63 phase7 — heuristic: detect chunk-load error dari Next.js
 * lazy import (mis. setelah deploy baru, browser cached stale HTML
 * referencing old chunk hash → 404 → ChunkLoadError). */
function isChunkLoadError(error: Error): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.name === "ChunkLoadError" ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("failed to fetch dynamically imported module")
  );
}

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloadingAfterDeploy, setReloadingAfterDeploy] = useState(false);

  useEffect(() => {
    /* Sesi AE-63 hotfix-2 — fuller logging supaya owner-side debug bisa
     * tahu error real-nya. Sebelumnya hanya log Error object yang
     * ke-truncate di console. POST ke server endpoint juga supaya
     * masuk Vercel logs. */
    console.error("[admin error] message:", error.message);
    console.error("[admin error] name:", error.name);
    console.error("[admin error] digest:", error.digest);
    console.error("[admin error] stack:", error.stack);

    /* Sesi AE-63 phase7 — chunk-load error = stale browser cache after
     * deploy. Auto-reload (force-fetch new HTML + bundle) supaya staff
     * tidak terjebak "back office bermasalah" looping. */
    if (typeof window !== "undefined" && isChunkLoadError(error)) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setReloadingAfterDeploy(true);
      /* eslint-enable react-hooks/set-state-in-effect */
      /* Reload after small delay supaya state setter sempat paint. */
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
      return;
    }

    if (typeof window !== "undefined") {
      /* Sesi AE-63 phase7 — endpoint pindah dari /_internal (private folder
       * di Next.js app router → 404) ke /internal (routable). */
      fetch("/api/internal/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          name: error.name,
          digest: error.digest,
          stack: error.stack,
          path: window.location.pathname,
          userAgent: navigator.userAgent,
        }),
      }).catch(() => {
        /* swallow — endpoint mungkin belum ada */
      });
    }
  }, [error]);

  /* Force-reload via window.location supaya benar-benar fetch HTML baru +
   * bundle baru. Link href + Router.refresh tidak cukup karena Next.js
   * keep stale chunk cache. */
  function fullReload() {
    if (typeof window === "undefined") return;
    window.location.href = "/dashboard";
  }

  if (reloadingAfterDeploy) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <RefreshCw className="size-4 animate-spin" aria-hidden />
          <span>Memuat versi terbaru…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-600">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-neutral-900">
              Back office bermasalah
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              Ada masalah saat memuat panel admin. Coba lagi, data tidak akan
              hilang.
            </p>
            {/* Sesi AE-63 phase7 — tampilkan error message asli supaya owner
              * bisa screenshot dan kirim ke dev (sebelumnya generic copy).
              * Stack tidak ditampilkan (terlalu noisy untuk staff). */}
            {error.message ? (
              <details className="mt-3 rounded-md bg-neutral-50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                  Detail teknis (untuk dev)
                </summary>
                <p className="mt-2 font-mono text-[11px] leading-snug text-neutral-700 break-words">
                  {error.message}
                </p>
                {error.digest ? (
                  <p className="mt-1 font-mono text-[10px] text-neutral-500">
                    Ref: {error.digest}
                  </p>
                ) : null}
              </details>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={fullReload}
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2"
          >
            Muat ulang
          </button>
          <Button onClick={reset}>Coba lagi</Button>
        </div>
      </div>
    </main>
  );
}
