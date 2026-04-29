import "server-only";

import { aliasedTable, and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import type { AuditEventType } from "./types";

export type AuditLogRow = {
  id: string;
  eventType: string;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  approverId: string | null;
  approverName: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export type ListAuditLogsOptions = {
  eventType?: AuditEventType | "all";
  userId?: string;
  entityType?: string;
  entityId?: string;
  /** ISO date string YYYY-MM-DD (WIB day) — both inclusive */
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
};

/**
 * Fetch audit log rows with user + approver joined.
 * Owner-only by access policy — caller must enforce.
 */
export async function fetchAuditLogs(opts: ListAuditLogsOptions = {}): Promise<{
  rows: AuditLogRow[];
  total: number;
}> {
  const conds: SQL[] = [];
  if (opts.eventType && opts.eventType !== "all") {
    conds.push(eq(auditLogs.eventType, opts.eventType));
  }
  if (opts.userId) conds.push(eq(auditLogs.userId, opts.userId));
  if (opts.entityType) conds.push(eq(auditLogs.entityType, opts.entityType));
  if (opts.entityId) conds.push(eq(auditLogs.entityId, opts.entityId));
  if (opts.fromDate) {
    conds.push(gte(auditLogs.createdAt, new Date(`${opts.fromDate}T00:00:00+07:00`)));
  }
  if (opts.toDate) {
    conds.push(lte(auditLogs.createdAt, new Date(`${opts.toDate}T23:59:59.999+07:00`)));
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  // Cap raised to 5000 to support CSV export in addition to paginated viewer
  // (which never asks for more than PAGE_SIZE=50). 5000 covers ~3-4 months
  // for single-outlet ~50 events/day; exporters narrow date range if more.
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 5000);
  const offset = Math.max(opts.offset ?? 0, 0);

  const actor = aliasedTable(users, "u_actor");
  const approver = aliasedTable(users, "u_approver");

  const rows = await db
    .select({
      id: auditLogs.id,
      eventType: auditLogs.eventType,
      createdAt: auditLogs.createdAt,
      userId: auditLogs.userId,
      approverId: auditLogs.approverId,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      payload: auditLogs.payload,
      metadata: auditLogs.metadata,
      userName: actor.name,
      userRole: actor.role,
      approverName: approver.name,
    })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.userId))
    .leftJoin(approver, eq(approver.id, auditLogs.approverId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);

  return {
    rows: rows.map((r) => ({
      ...r,
      payload: (r.payload as Record<string, unknown> | null) ?? null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    })),
    total: count,
  };
}
