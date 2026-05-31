"use client";

import { Skeleton } from "@/components/ui";

/**
 * Sesi AE-171 — skeleton panel POS yang reusable & responsif. Dipakai untuk
 * Suspense fallback (pindah tab) + state loading panel (mis. ShiftPanel),
 * menggantikan spinner. Bentuknya generik (header + ringkasan + list) supaya
 * cocok untuk semua panel & enak dilihat di device apa pun (tablet/HP/desktop).
 */
export function PosPanelSkeleton({
  rows = 5,
  hero = true,
}: {
  /** Jumlah baris list placeholder. */
  rows?: number;
  /** Tampilkan blok ringkasan besar di atas list. */
  hero?: boolean;
}) {
  return (
    <div
      className="flex h-full flex-col gap-4 overflow-hidden p-4 sm:p-6 touch:p-3"
      role="status"
      aria-label="Memuat…"
    >
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-40 max-w-[60%]" />
        <Skeleton className="h-4 w-72 max-w-[85%]" />
      </div>

      {/* Hero / ringkasan */}
      {hero ? <Skeleton className="h-24 w-full rounded-xl" /> : null}

      {/* List rows */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
