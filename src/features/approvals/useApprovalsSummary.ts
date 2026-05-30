"use client";

/**
 * Sesi AE-160 — shared hook untuk fetch ringkasan pending approval queue.
 *
 * Dipakai oleh:
 *   - AdminLeftNav sidebar badge (total pending)
 *   - ApprovalsSection header summary chips (per-kind counts)
 *
 * Background refetch 60 detik supaya badge update tanpa user reload kalau
 * staff submit request baru.
 */

import { useQuery } from "@tanstack/react-query";
import { getApprovalQueueSummary } from "./queries";

export interface ApprovalQueueSummary {
  total: number;
  byKind: Record<
    "rebalance" | "correction" | "entry_change" | "void" | "refund",
    number
  >;
}

export const approvalQueueSummaryKey = [
  "approvals",
  "summary",
] as const;

export function useApprovalsSummary(enabled = true) {
  return useQuery<ApprovalQueueSummary | null>({
    queryKey: approvalQueueSummaryKey,
    queryFn: async () => {
      const res = await getApprovalQueueSummary();
      if (!res.success) return null;
      return res.data;
    },
    enabled,
    staleTime: 30 * 1000,
    /* Sesi AE-163 — hemat Fluid CPU: interval 60→90s, dan matikan
     * refetchOnWindowFocus (dulu true → burst refetch tiap pindah tab,
     * padahal staff POS bolak-balik tab terus). refetchInterval otomatis
     * pause saat window blur, jadi background tab tidak nembak server. */
    refetchInterval: 90 * 1000,
    refetchOnWindowFocus: false,
  });
}
