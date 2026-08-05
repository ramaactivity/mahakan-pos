import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient for admin + POS surfaces.
 *
 * Defaults tuned for Mahakan operational reality:
 * - Admin reference data (employees, suppliers, COA) doesn't change every minute,
 *   so 5min staleTime keeps revisits instant without seeing spinners.
 * - 30min gcTime keeps memory cache alive across section switches in AdminShell
 *   (which destroys/recreates components on tab change — without this, every
 *   revisit was a cold fetch).
 * - refetchOnWindowFocus disabled: POS staff frequently switch between POS
 *   tab and admin tab; refetch-on-focus would defeat the cache.
 * - refetchOnMount: "always" → still triggers a background refetch when stale,
 *   but immediately returns cached data. Stale-while-revalidate.
 *
 * Per-query overrides allowed: short-lived data (current shift, open bills)
 * should pass `staleTime: 0` to always refetch.
 */
/**
 * Sesi AE-176 — opsi "near-real-time" untuk halaman master yang sering
 * diedit BARENGAN beberapa owner (Inventory, Supplier, Menu). Refetch saat
 * tab difokus (instan begitu balik ke tab) + polling latar. Polling
 * default hanya jalan saat tab fokus (refetchIntervalInBackground=false) →
 * hemat Fluid CPU. JANGAN dipakai di layar dengan input aktif (mis. Opname
 * count) — refetch bisa menimpa ketikan.
 *
 * Audit AE-187 — interval 20s → 60s. Layar master ini menarik full table
 * (mis. 330 bahan) tiap poll; di layar yang ditinggal terbuka seharian itu
 * 3× invocation + egress yang tak perlu. Sinkron antar-owner tetap terasa
 * instan karena refetchOnWindowFocus (begitu balik ke tab langsung fresh).
 */
export const LIVE_QUERY_OPTS = {
  staleTime: 30 * 1000,
  refetchOnWindowFocus: true,
  refetchInterval: 60 * 1000,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
