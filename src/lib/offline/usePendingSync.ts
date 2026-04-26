"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { countPendingTransactions } from "./queue";
import { syncPendingTransactions } from "./sync";

/**
 * Watches navigator.onLine and the pending queue size; triggers a sync
 * pass whenever the device transitions online. Returns the current
 * pending count so callers can render a badge.
 */
export function usePendingSync(): { pendingCount: number; syncing: boolean } {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const n = await countPendingTransactions();
      setPendingCount(n);
    } catch {
      setPendingCount(0);
    }
  }, []);

  useEffect(() => {
    // Initial refresh from external IDB source — setState inside effect is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    async function trySync() {
      const n = await countPendingTransactions();
      if (cancelled || n === 0) {
        if (!cancelled) setPendingCount(n);
        return;
      }
      setSyncing(true);
      try {
        const summary = await syncPendingTransactions();
        if (!cancelled) {
          if (summary.succeeded > 0) {
            toast.success(
              `${summary.succeeded} transaksi offline ter-sync`,
            );
          }
          if (summary.failed > 0) {
            toast.error(
              `${summary.failed} transaksi gagal sync — lihat console`,
            );
            for (const e of summary.errors) console.error("[sync]", e);
          }
        }
      } finally {
        if (!cancelled) {
          setSyncing(false);
          await refreshCount();
        }
      }
    }
    void trySync();
    return () => {
      cancelled = true;
    };
  }, [online, refreshCount]);

  return { pendingCount, syncing };
}
