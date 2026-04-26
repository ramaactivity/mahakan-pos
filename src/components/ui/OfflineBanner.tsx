"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

/**
 * Slim banner shown at the top of authed shells when navigator reports
 * the device is offline. Phase 1: informational only — offline-queued
 * transactions land in M17.3 (Dexie + sync).
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-warning-100 px-4 py-2 text-xs font-medium text-warning-500"
    >
      <WifiOff className="size-4" aria-hidden />
      <span>
        Offline — transaksi yang dibuat saat offline akan ter-sync otomatis
        saat online.
      </span>
    </div>
  );
}
