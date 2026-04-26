"use client";

import Dexie, { type Table } from "dexie";
import type { CreateTransactionInput } from "@/features/transactions";

export type PendingState = "queued" | "syncing" | "failed";

export interface PendingTransaction {
  id?: number;
  /** UUID — also used as clientRefId server-side for idempotency. */
  clientRefId: string;
  payload: CreateTransactionInput;
  state: PendingState;
  attempts: number;
  /** Last error message for diagnostics. */
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

class MahakanOfflineDb extends Dexie {
  pendingTransactions!: Table<PendingTransaction, number>;

  constructor() {
    super("mahakan-pos-offline");
    this.version(1).stores({
      pendingTransactions:
        "++id, &clientRefId, state, createdAt, [state+createdAt]",
    });
  }
}

let _db: MahakanOfflineDb | null = null;
function getDb(): MahakanOfflineDb {
  if (!_db) _db = new MahakanOfflineDb();
  return _db;
}

export async function queuePendingTransaction(
  payload: CreateTransactionInput,
): Promise<PendingTransaction> {
  if (!payload.clientRefId) {
    throw new Error("clientRefId required for offline queueing");
  }
  const now = Date.now();
  const row: PendingTransaction = {
    clientRefId: payload.clientRefId,
    payload,
    state: "queued",
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  const id = await getDb().pendingTransactions.add(row);
  return { ...row, id };
}

export async function listPendingTransactions(): Promise<PendingTransaction[]> {
  return getDb()
    .pendingTransactions.orderBy("createdAt")
    .toArray();
}

export async function countPendingTransactions(): Promise<number> {
  return getDb()
    .pendingTransactions.where("state")
    .anyOf("queued", "failed")
    .count();
}

export async function markSyncing(id: number): Promise<void> {
  await getDb().pendingTransactions.update(id, {
    state: "syncing",
    attempts: (await getDb().pendingTransactions.get(id))?.attempts ?? 0 + 1,
    updatedAt: Date.now(),
  });
}

export async function markFailed(
  id: number,
  message: string,
): Promise<void> {
  const current = await getDb().pendingTransactions.get(id);
  await getDb().pendingTransactions.update(id, {
    state: "failed",
    attempts: (current?.attempts ?? 0) + 1,
    lastError: message,
    updatedAt: Date.now(),
  });
}

export async function deletePending(id: number): Promise<void> {
  await getDb().pendingTransactions.delete(id);
}
