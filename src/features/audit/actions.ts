"use server";

import { auth, hasPermission } from "@/lib/auth";
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
 * Server action wrapper for the audit log viewer.
 *
 * Sesi AE-62i — pakai hasPermission instead of hardcoded role check supaya
 * sync dengan RBAC matrix. Owner punya "audit.view.all" (semua entries),
 * manager+supervisor punya "audit.view.staff_actions" (filtered subset).
 * Sebelumnya hardcoded `role !== "owner"` → manager dengan audit.view
 * permission tetap di-block walau matrix izinkan.
 */
export async function listAuditLogs(
  opts: ListAuditLogsOptions = {},
): Promise<ApiResult<{ rows: AuditLogRow[]; total: number }>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Belum login");
  const canViewAll = hasPermission(session.user.role, "audit.view.all");
  const canViewStaff = hasPermission(
    session.user.role,
    "audit.view.staff_actions",
  );
  if (!canViewAll && !canViewStaff) {
    return fail("FORBIDDEN", "Tidak punya hak lihat audit log");
  }
  return ok(await fetchAuditLogs(opts));
}
