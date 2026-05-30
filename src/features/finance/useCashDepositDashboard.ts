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
    /* Sesi AE-163 — hemat Fluid CPU: 60→120s. Setoran proses async (bukan
     * real-time), badge telat ≤2 menit masih oke. refetchInterval otomatis
     * pause saat window blur. */
    refetchInterval: 120 * 1000,
    /* Matikan refetch saat tab di-focus — dulu true bikin burst tiap owner
     * pindah dari POS ke admin. Interval 120s sudah cukup. */
    refetchOnWindowFocus: false,
  });
}
