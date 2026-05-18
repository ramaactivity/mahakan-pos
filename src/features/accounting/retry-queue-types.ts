/**
 * Sesi AE-62w — pure types/constants untuk journal retry queue.
 * Split dari retry-queue.ts ("use server") karena file actions tidak boleh
 * export non-async fn (Next.js rule).
 */

import type { journalRetryQueue } from "@/db/schema";

export const RETRY_QUEUE_HOOK_LABELS = [
  "pos_sale",
  "pos_void",
  "pos_refund",
  "expense_create",
  "income_create",
  "opname_adjustment",
] as const;

export type RetryQueueHookLabel = (typeof RETRY_QUEUE_HOOK_LABELS)[number];

export function isRetryableHookLabel(
  label: string,
): label is RetryQueueHookLabel {
  return (RETRY_QUEUE_HOOK_LABELS as readonly string[]).includes(label);
}

export type JournalRetryQueueRow = typeof journalRetryQueue.$inferSelect;

export interface ListJournalQueueOptions {
  status?: "pending" | "resolved" | "abandoned" | "all";
  limit?: number;
}

export interface JournalRetryQueueListRow extends JournalRetryQueueRow {
  lastRetryByName: string | null;
  resolvedByName: string | null;
  abandonedByName: string | null;
  hookDisplayName: string;
}

export interface EnqueueJournalFailureInput {
  outletId: string;
  hookLabel: RetryQueueHookLabel;
  hookArgs: Record<string, unknown>;
  sourceType?: string;
  sourceId?: string;
  error: unknown;
}
