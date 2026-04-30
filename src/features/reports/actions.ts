"use server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { todayWibIso } from "@/features/cash/helpers";
import {
  fetchDailySalesReport,
  fetchItemPerformance,
  fetchMenuEngineeringMatrix,
  fetchPnlReport,
  fetchSalesRangeReport,
} from "./queries";
import {
  fetchHppReport,
  fetchPurchaseRollupReport,
} from "./inventory-reports";
import {
  fail,
  ok,
  type ApiResult,
  type DailySalesReport,
  type HppReport,
  type ItemPerformanceRow,
  type MenuEngineeringResult,
  type PnlReport,
  type PurchaseRollupReport,
  type SalesRangeReport,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function getDailySalesReport(
  date: string = todayWibIso(),
): Promise<ApiResult<DailySalesReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.sales.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat laporan penjualan");
  }
  if (!ISO_DATE.test(date)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  return ok(await fetchDailySalesReport(session.user.outletId, date));
}

export async function getItemPerformance(
  from: string,
  to: string,
  sort: "qty" | "revenue" | "avg" = "qty",
  limit = 100,
): Promise<ApiResult<ItemPerformanceRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.items.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat performa item");
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  if (limit < 1 || limit > 500) limit = 100;
  return ok(
    await fetchItemPerformance(session.user.outletId, from, to, sort, limit),
  );
}

export async function getMenuEngineeringMatrix(
  from: string,
  to: string,
): Promise<ApiResult<MenuEngineeringResult>> {
  const session = await requireSession();
  // Requires items report perm + cost visibility (since margin reveals cogs).
  if (!hasPermission(session.user.role, "report.items.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat performa item");
  }
  if (!hasPermission(session.user.role, "report.cost_visibility")) {
    return fail("FORBIDDEN", "Margin/HPP hanya untuk Owner");
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  if (from > to) {
    return fail("VALIDATION_ERROR", "Tanggal mulai > tanggal selesai");
  }
  return ok(await fetchMenuEngineeringMatrix(session.user.outletId, from, to));
}

export async function getSalesRangeReport(
  from: string,
  to: string,
): Promise<ApiResult<SalesRangeReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.sales.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat laporan penjualan");
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  if (from > to) {
    return fail("VALIDATION_ERROR", "Tanggal mulai > tanggal selesai");
  }
  // Cap range: 1 year max
  const fromMs = new Date(`${from}T00:00:00+07:00`).getTime();
  const toMs = new Date(`${to}T00:00:00+07:00`).getTime();
  if (toMs - fromMs > 366 * 24 * 60 * 60 * 1000) {
    return fail("VALIDATION_ERROR", "Range maksimal 1 tahun");
  }
  return ok(await fetchSalesRangeReport(session.user.outletId, from, to));
}

export async function getPnlReport(
  from: string,
  to: string,
): Promise<ApiResult<PnlReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.pnl.view")) {
    return fail("FORBIDDEN", "P&L hanya untuk Owner");
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  return ok(await fetchPnlReport(session.user.outletId, from, to));
}

export async function getHppReport(
  from: string,
  to: string,
): Promise<ApiResult<HppReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.hpp.view")) {
    return fail("FORBIDDEN", "Laporan HPP hanya untuk Owner");
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  return ok(await fetchHppReport(session.user.outletId, from, to));
}

export async function getPurchaseRollupReport(
  from: string,
  to: string,
): Promise<ApiResult<PurchaseRollupReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.purchase_rollup.view")) {
    return fail(
      "FORBIDDEN",
      "Tidak punya hak lihat laporan pembelanjaan",
    );
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  return ok(
    await fetchPurchaseRollupReport(session.user.outletId, from, to),
  );
}
