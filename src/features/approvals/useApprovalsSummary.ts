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
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
