"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import {
  copyClientErrorToClipboard,
  isChunkLoadError,
  reportClientError,
  type ClientErrorReport,
} from "@/lib/client-error-report";
import {
  adminSectionLabel,
  type AdminSection,
} from "@/features/admin/components/AdminLeftNav";

/**
 * Sesi AE-213 — penahan error untuk isi menu back office.
 *
 * Sebelumnya satu menu yang rusak menjatuhkan seluruh panel: sidebar ikut
 * hilang, jadi owner tidak bisa pindah ke menu lain yang sebenarnya sehat —
 * dan layar errornya tidak menyebut menu mana yang bermasalah. Sekarang
 * kerusakan berhenti di dalam area konten.
 *
 * Errornya tetap dilaporkan (server log + simpanan lokal) dan bisa disalin
 * owner dalam satu ketukan.
 */
export function SectionErrorBoundary({
  section,
  onBackToDashboard,
  children,
}: {
  section: AdminSection;
  onBackToDashboard: () => void;
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      resetKey={section}
      onError={(error, componentStack) => {
        reportClientError({
          message: error.message,
          name: error.name,
          digest: (error as Error & { digest?: string }).digest,
          stack: error.stack,
          componentStack,
          scope: `admin:${section}`,
        });
      }}
      fallback={(error, reset) => (
        <SectionErrorCard
          section={section}
          error={error}
          onRetry={reset}
          onBackToDashboard={onBackToDashboard}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function SectionErrorCard({
  section,
  error,
  onRetry,
  onBackToDashboard,
}: {
  section: AdminSection;
  error: Error;
  onRetry: () => void;
  onBackToDashboard: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const label = adminSectionLabel(section);
  /* Section di-lazy-load, jadi chunk basi sesudah deploy meledak DI SINI —
   * bukan di penahan route yang punya auto-reload. Muat ulang sekali saja
   * (dijaga penanda di sessionStorage) supaya tidak jadi loop kalau chunknya
   * memang benar-benar hilang. */
  const staleChunk = isChunkLoadError(error);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!staleChunk || typeof window === "undefined") return;
    const KEY = "mahakan.chunk-reload.at";
    const last = Number(window.sessionStorage.getItem(KEY) ?? 0);
    /* Sudah pernah muat ulang barusan dan chunknya tetap tidak ada —
     * berhenti, dan tampilkan kartu errornya seperti error biasa. */
    if (Date.now() - last < 60_000) return;
    window.sessionStorage.setItem(KEY, String(Date.now()));
    /* eslint-disable react-hooks/set-state-in-effect */
    setReloading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    window.setTimeout(() => window.location.reload(), 400);
  }, [staleChunk]);

  if (reloading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <RefreshCw className="size-4 animate-spin" aria-hidden />
          <span>Memuat versi terbaru…</span>
        </div>
      </div>
    );
  }

  const report: ClientErrorReport = {
    message: error.message,
    name: error.name,
    digest: (error as Error & { digest?: string }).digest,
    stack: error.stack,
    scope: `admin:${section}`,
  };

  async function onCopy() {
    const ok = await copyClientErrorToClipboard(report);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 4000);
  }

  return (
    <div className="flex h-full items-start justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-600">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-neutral-900">
              Menu {label} bermasalah
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Menu lain tetap bisa dibuka lewat sidebar. Data tidak ada yang
              hilang — yang gagal cuma menampilkannya.
            </p>
            {error.message ? (
              <details className="mt-3 rounded-md bg-neutral-50 px-3 py-2" open>
                <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                  Detail teknis (untuk dev)
                </summary>
                <p className="mt-2 font-mono text-[11px] leading-snug break-words text-neutral-700">
                  {error.message}
                </p>
              </details>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-200"
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
            onClick={onBackToDashboard}
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-200"
          >
            Kembali ke Dashboard
          </button>
          <Button onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden />
            Coba lagi
          </Button>
        </div>
      </div>
    </div>
  );
}
