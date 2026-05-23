"use client";

/**
 * Sesi AE-123 — shared hook untuk fetch cash deposit dashboard.
 *
 * Dipakai oleh:
 *   - SetoranTunaiView header (tombol "Setor Semua Rp X")
 *   - AdminLeftNav sidebar badge (pendingCount)
 *   - DashboardHome in-app banner (pending notif)
 *
 * Single source supaya tidak ada multiple network fetch untuk data yang
 * sama. Background refetch 60 detik supaya owner langsung tahu kalau ada
 * setoran pending baru.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchCashDepositDashboard } from "./actions";
import type { CashDepositDashboard } from "./types";

export const cashDepositDashboardQueryKey = [
  "finance",
  "deposit-dashboard",
] as const;

export function useCashDepositDashboard() {
  return useQuery<CashDepositDashboard | null>({
    queryKey: cashDepositDashboardQueryKey,
    queryFn: async () => {
      const res = await fetchCashDepositDashboard();
      if (!res.ok) return null;
      return res.data;
    },
    /* Stale 30s — owner cek dashboard tidak butuh real-time. */
    staleTime: 30 * 1000,
    /* Background refetch 60s — kalau staf bikin setoran baru sambil owner
     * buka admin, badge muncul dalam <1 menit. */
    refetchInterval: 60 * 1000,
    /* Refetch saat tab di-focus kembali. */
    refetchOnWindowFocus: true,
  });
}
