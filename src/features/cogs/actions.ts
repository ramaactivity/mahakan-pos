"use server";

import { auth, hasPermission } from "@/lib/auth";
import type { ApiOk, ApiFail, ApiResult } from "./cogs-calc";
import { getCogsReport, type CogsReport } from "./queries";

function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): ApiFail {
  return { ok: false, error: { code, message } };
}

/**
 * Fetch COGS + Variance report untuk outlet aktif owner + bulan.
 *
 * @param ym YYYY-MM format (mis. "2026-05")
 */
export async function fetchCogsReport(ym: string): Promise<ApiResult<CogsReport>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi expired");
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses laporan COGS");
  }
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return fail("VALIDATION_ERROR", "Format periode harus YYYY-MM");
  }

  try {
    const report = await getCogsReport({
      outletId: session.user.outletId,
      ym,
    });
    return ok(report);
  } catch (e) {
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Gagal load report",
    );
  }
}

