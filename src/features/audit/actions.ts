"use server";

import { auth } from "@/lib/auth";
import {
  fetchAuditLogs,
  type AuditLogRow,
  type ListAuditLogsOptions,
} from "@/lib/audit/queries";

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}
function fail(code: string, message: string): ApiResult<never> {
  return { ok: false, code, message };
}

/**
 * Server action wrapper for the audit log viewer (Owner-only).
 */
export async function listAuditLogs(
  opts: ListAuditLogsOptions = {},
): Promise<ApiResult<{ rows: AuditLogRow[]; total: number }>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Belum login");
  if (session.user.role !== "owner") {
    return fail("FORBIDDEN", "Audit log hanya untuk Owner");
  }
  return ok(await fetchAuditLogs(opts));
}
