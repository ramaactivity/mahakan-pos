"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { todayWibIso } from "@/features/cash/helpers";
import {
  fetchBillPerformance,
  fetchClosingShiftReport,
  fetchDailySalesReport,
  fetchItemPerformance,
  fetchMenuEngineeringMatrix,
  fetchPnlReport,
  fetchRefundVoidComplimentReport,
  fetchRvcEventDetail,
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
  type BillPerformanceReport,
  type ClosingShiftReport,
  type DailySalesReport,
  type HppReport,
  type ItemPerformanceRow,
  type MenuEngineeringResult,
  type PnlReport,
  type PurchaseRollupReport,
  type RefundVoidComplimentDetail,
  type RefundVoidComplimentKind,
  type RefundVoidComplimentReport,
  type SalesRangeReport,
} from "./types";
import type { PaymentMethod } from "@/features/transactions";

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

/* Sesi AE-55 — Closing Shift Report.
 * Permission: report.shift.view_all (owner+manager+supervisor).
 * Variance threshold dari OutletSettings.thresholds.shiftVarianceAlert
 * (default 5000 kalau tidak set). */
const DEFAULT_VARIANCE_THRESHOLD = 5_000;

export async function getClosingShiftReport(
  from: string,
  to: string,
): Promise<ApiResult<ClosingShiftReport>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.shift.view_all")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat laporan shift");
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("VALIDATION_ERROR", "Tanggal harus YYYY-MM-DD");
  }
  if (from > to) {
    return fail("VALIDATION_ERROR", "Tanggal mulai > tanggal selesai");
  }
  const fromMs = new Date(`${from}T00:00:00+07:00`).getTime();
  const toMs = new Date(`${to}T00:00:00+07:00`).getTime();
  if (toMs - fromMs > 366 * 24 * 60 * 60 * 1000) {
    return fail("VALIDATION_ERROR", "Range maksimal 1 tahun");
  }

  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const threshold =
    outletRow?.settings?.thresholds?.shiftVarianceAlert ??
    DEFAULT_VARIANCE_THRESHOLD;

  return ok(
    await fetchClosingShiftReport(
      session.user.outletId,
      from,
      to,
      threshold,
    ),
  );
}

/* Sesi AE-55 — Per-Bill Report.
 * Permission: report.sales.view. */
const PAYMENT_METHODS: ReadonlyArray<PaymentMethod | "all"> = [
  "all",
  "cash",
  "qris",
  "card_bca",
  "card_bni",
  "card_mandiri",
  "card_bri",
  "card_other",
  "split",
];

export async function getBillPerformanceReport(
  from: string,
  to: string,
  paymentFilter: PaymentMethod | "all" = "all",
): Promise<ApiResult<BillPerformanceReport>> {
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
  const fromMs = new Date(`${from}T00:00:00+07:00`).getTime();
  const toMs = new Date(`${to}T00:00:00+07:00`).getTime();
  if (toMs - fromMs > 92 * 24 * 60 * 60 * 1000) {
    return fail("VALIDATION_ERROR", "Range maksimal 92 hari");
  }
  if (!PAYMENT_METHODS.includes(paymentFilter)) {
    return fail("VALIDATION_ERROR", "Payment filter tidak valid");
  }
  return ok(
    await fetchBillPerformance(
      session.user.outletId,
      from,
      to,
      paymentFilter,
    ),
  );
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

/* Sesi AE-59 — Refund / Void / Compliment Report.
 * Permission: report.sales.view (operational, semua role). */
const RVC_KINDS: ReadonlyArray<RefundVoidComplimentKind> = [
  "refund_full",
  "refund_partial",
  "void",
  "compliment",
];

export async function getRefundVoidComplimentReport(
  from: string,
  to: string,
  kindFilter?: RefundVoidComplimentKind[],
): Promise<ApiResult<RefundVoidComplimentReport>> {
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
  const fromMs = new Date(`${from}T00:00:00+07:00`).getTime();
  const toMs = new Date(`${to}T00:00:00+07:00`).getTime();
  if (toMs - fromMs > 92 * 24 * 60 * 60 * 1000) {
    return fail("VALIDATION_ERROR", "Range maksimal 92 hari");
  }
  // Validate kind enum jika kindFilter di-pass
  if (kindFilter) {
    for (const k of kindFilter) {
      if (!RVC_KINDS.includes(k)) {
        return fail("VALIDATION_ERROR", `Kind tidak valid: ${k}`);
      }
    }
    if (kindFilter.length === 0) {
      return fail("VALIDATION_ERROR", "Pilih min 1 jenis event");
    }
  }
  return ok(
    await fetchRefundVoidComplimentReport(
      session.user.outletId,
      from,
      to,
      kindFilter,
    ),
  );
}

export async function getRvcEventDetail(
  eventId: string,
  kind: RefundVoidComplimentKind,
): Promise<ApiResult<RefundVoidComplimentDetail | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "report.sales.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat detail event");
  }
  if (!RVC_KINDS.includes(kind)) {
    return fail("VALIDATION_ERROR", `Kind tidak valid: ${kind}`);
  }
  if (!eventId || typeof eventId !== "string") {
    return fail("VALIDATION_ERROR", "Event ID wajib");
  }
  return ok(
    await fetchRvcEventDetail(session.user.outletId, eventId, kind),
  );
}
