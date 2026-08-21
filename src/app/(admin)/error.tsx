"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import {
  copyClientErrorToClipboard,
  isChunkLoadError,
  reportClientError,
} from "@/lib/client-error-report";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloadingAfterDeploy, setReloadingAfterDeploy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
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

    /* Sesi AE-213 — satu jalur pelaporan: console + POST ke
     * /api/internal/client-error (Vercel logs) + simpanan lokal supaya
     * owner tetap bisa menyalin errornya walau layarnya sudah ditutup. */
    reportClientError({
      message: error.message,
      name: error.name,
      digest: error.digest,
      stack: error.stack,
      scope: "admin:shell",
    });
  }, [error]);

  async function onCopy() {
    const ok = await copyClientErrorToClipboard({
      message: error.message,
      name: error.name,
      digest: error.digest,
      stack: error.stack,
      scope: "admin:shell",
    });
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 4000);
  }

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
              <details className="mt-3 rounded-md bg-neutral-50 px-3 py-2" open>
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
          {/* Sesi AE-213 — dulu detail errornya cuma bisa dibaca, jadi laporan
            * ke dev selalu berupa screenshot dengan detail yang terlipat.
            * Sekarang satu ketuk = teks lengkap siap dikirim. */}
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2"
          >
            {copied ? (
              <ClipboardCheck className="size-4" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {copied ? "Tersalin" : "Salin detail"}
          </button>
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
