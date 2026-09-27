"use client";

import { createTransaction, isOk } from "@/features/transactions";
import {
  deletePending,
  listPendingTransactions,
  markFailed,
  markSyncing,
} from "./queue";

export interface SyncSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ clientRefId: string; message: string }>;
}

let inFlight: Promise<SyncSummary> | null = null;

/**
 * Replay every queued/failed pending transaction. Single-flight: concurrent
 * callers reuse the same promise so the queue isn't double-replayed.
 *
 * Server uses clientRefId UNIQUE for idempotency, so re-attempts that
 * succeeded server-side but failed to clear locally are safe.
 */
export async function syncPendingTransactions(): Promise<SyncSummary> {
  if (inFlight) return inFlight;
  inFlight = runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(): Promise<SyncSummary> {
  const pending = await listPendingTransactions();
  const summary: SyncSummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const row of pending) {
    if (row.state === "syncing") continue;
    if (typeof row.id !== "number") continue;
    summary.attempted += 1;
    try {
      await markSyncing(row.id);
      // Sesi AE-235 — rows queued before the crew picker have no crewId;
      // the flag lets the server accept them instead of dropping a sale.
      const res = await createTransaction({ ...row.payload, fromOfflineQueue: true });
      if (isOk(res)) {
        await deletePending(row.id);
        summary.succeeded += 1;
      } else {
        const message = res.error.message;
        if (isPermanentError(res.error.code)) {
          // Permanent rejection from server (e.g. invalid data, sold-out at
          // the time of replay). Drop from queue so it doesn't retry forever.
          await deletePending(row.id);
        } else {
          await markFailed(row.id, message);
        }
        summary.failed += 1;
        summary.errors.push({ clientRefId: row.clientRefId, message });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync error";
      await markFailed(row.id, message);
      summary.failed += 1;
      summary.errors.push({ clientRefId: row.clientRefId, message });
    }
  }

  return summary;
}

const PERMANENT_ERROR_CODES = new Set([
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "MENU_ITEM_NOT_FOUND",
  "MENU_ITEM_SOLD_OUT",
  "PRICE_MISMATCH",
  "OPEN_PRICE_OUT_OF_RANGE",
  "SUBTOTAL_MISMATCH",
  "DISCOUNT_MISMATCH",
  "TOTAL_MISMATCH",
  "INSUFFICIENT_CASH",
  "CASH_CHANGE_MISMATCH",
  "CASH_FIELDS_INVALID",
  "SHIFT_NOT_FOUND",
  "SHIFT_CLOSED",
  "SHIFT_OWNERSHIP",
  "APPROVER_REQUIRED",
  "APPROVER_TOKEN_INVALID",
]);

function isPermanentError(code: string): boolean {
  return PERMANENT_ERROR_CODES.has(code);
}
