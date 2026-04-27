import "server-only";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import type {
  AuditEntityType,
  AuditEventType,
  AuditMetadata,
  AuditPayload,
} from "./types";

export type LogAuditInput = {
  eventType: AuditEventType;
  userId?: string | null;
  approverId?: string | null;
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  payload?: AuditPayload | null;
  metadata?: AuditMetadata | null;
};

/**
 * Write an audit log entry. Designed to be call-and-forget from Server Actions:
 * never throws — failures are logged to stderr and swallowed so they cannot
 * block the business action (which already succeeded by the time we log).
 *
 * For high-frequency actions (transactions, menu writes), prefer awaiting
 * within the same DB request lifecycle to keep ordering predictable;
 * the operation is fast (single INSERT, indexes are minimal).
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      eventType: input.eventType,
      userId: input.userId ?? null,
      approverId: input.approverId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      payload: (input.payload ?? null) as unknown as Record<string, unknown>,
      metadata: (input.metadata ?? null) as unknown as Record<string, unknown>,
    });
  } catch (e) {
    console.error("[audit] write failed", {
      eventType: input.eventType,
      entity: `${input.entityType}:${input.entityId}`,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Compute a shallow diff between two records — only fields that differ are
 * recorded. Useful for `update` events to avoid logging unchanged fields.
 *
 * Note: deep objects compare by JSON.stringify equality, so the diff is
 * coarse-grained for nested settings — that's fine for the audit trail use
 * case (humans skim a UI, not auto-rollback).
 */
export function diffShallow<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): AuditPayload["diff"] {
  const diff: NonNullable<AuditPayload["diff"]> = {};
  for (const key of Object.keys(after)) {
    const a = (before as Record<string, unknown>)[key];
    const b = (after as Record<string, unknown>)[key];
    const eq =
      a === b ||
      (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));
    if (!eq) diff[key] = { before: a, after: b };
  }
  return Object.keys(diff).length > 0 ? diff : undefined;
}
