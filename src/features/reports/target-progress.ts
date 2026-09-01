"use server";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { outlets, transactions } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  startOfWibDateUtc,
  todayWibIso,
} from "@/features/cash/helpers";
import { fail, ok, type ApiResult } from "@/features/reports/types";
import { resolveMonthlyTarget } from "./target-history-pure";

/**
 * Sesi AE-62ah — Server helper untuk progress target pendapatan vs realisasi.
 *
 * Tiga skala:
 *  - daily: revenue hari ini (WIB) vs targets.dailyRevenue
 *  - weekly: revenue 7 hari terakhir (rolling, today inclusive) vs targets.weeklyRevenue
 *  - monthly: revenue MTD (dari tgl 1 bulan ini WIB) vs targets.monthlyRevenue
 *
 * Sumber revenue: transactions WHERE status IN (paid, partially_refunded),
 * `total - refundedAmount` per row (mirror fetchDailySalesReport).
 *
 * Dipakai oleh:
 *  - BO Dashboard "Target Pendapatan" card
 *  - POS header MotivasiBar (kasir-facing)
 *  - POS mini-dashboard
 */
export interface TargetScale {
  /** Realisasi pendapatan rupiah (net = total - refundedAmount). */
  actual: number;
  /** Target dari outlet.settings.targets, null kalau belum di-set. */
  target: number | null;
  /** Persentase 0..200+ (clamped 0..999 untuk display). null kalau target null. */
  pct: number | null;
  /** Selisih: target - actual. negative = over target. null kalau target null. */
  remaining: number | null;
}

export interface TargetProgressData {
  daily: TargetScale & { dateLabel: string };
  weekly: TargetScale & { fromDate: string; toDate: string };
  monthly: TargetScale & { monthLabel: string; fromDate: string; toDate: string };
}

function isoBefore(ymd: string, daysBack: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - daysBack);
  return utc.toISOString().slice(0, 10);
}

function firstOfMonthIso(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** Compute revenue WIB window [fromYmd 00:00, toYmd 24:00). */
async function fetchRevenueInRange(
  outletId: string,
  fromYmd: string,
  toYmd: string,
): Promise<number> {
  const start = startOfWibDateUtc(fromYmd);
  const endInclusive = startOfWibDateUtc(toYmd);
  const end = new Date(endInclusive.getTime() + 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${transactions.total} - ${transactions.refundedAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        gte(transactions.createdAt, start),
        lt(transactions.createdAt, end),
        sql`${transactions.status} IN ('paid', 'partially_refunded')`,
      ),
    );
  return Number(row?.revenue ?? 0);
}

function computeScale(
  actual: number,
  target: number | undefined | null,
): TargetScale {
  if (target == null || target <= 0) {
    return { actual, target: null, pct: null, remaining: null };
  }
  const pct = Math.min(999, Math.round((actual / target) * 100));
  return { actual, target, pct, remaining: target - actual };
}

export async function getTargetProgress(): Promise<
  ApiResult<TargetProgressData>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Tidak login");

  const today = todayWibIso();
  const weekFrom = isoBefore(today, 6); // rolling 7 hari (hari ini + 6 sebelumnya)
  const monthFrom = firstOfMonthIso(today);

  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const targets = outletRow?.settings?.targets ?? {};

  const [dailyRev, weeklyRev, monthlyRev] = await Promise.all([
    fetchRevenueInRange(session.user.outletId, today, today),
    fetchRevenueInRange(session.user.outletId, weekFrom, today),
    fetchRevenueInRange(session.user.outletId, monthFrom, today),
  ]);

  const dateLabel = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(`${today}T00:00:00+07:00`));

  const monthLabel = new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(`${monthFrom}T00:00:00+07:00`));

  return ok({
    daily: {
      ...computeScale(dailyRev, targets.dailyRevenue),
      dateLabel,
    },
    weekly: {
      ...computeScale(weeklyRev, targets.weeklyRevenue),
      fromDate: weekFrom,
      toDate: today,
    },
    monthly: {
      ...computeScale(monthlyRev, targets.monthlyRevenue),
      monthLabel,
      fromDate: monthFrom,
      toDate: today,
    },
  });
}


/**
 * Sesi AE-223 — target bulanan untuk SATU bulan tertentu.
 *
 * `fromHistory=true` berarti angkanya memang dikunci untuk bulan itu.
 * `false` berarti kita hanya punya target yang berlaku SEKARANG — pemanggil
 * WAJIB mengatakannya ke pembaca, karena membandingkan pencapaian Agustus ke
 * target September menghasilkan persentase yang terlihat resmi tapi salah.
 */
export async function getMonthlyTargetFor(month: string): Promise<
  ApiResult<{ target: number | null; fromHistory: boolean }>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Tidak login");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return fail("VALIDATION_ERROR", "Bulan harus format YYYY-MM");
  }

  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const targets = outletRow?.settings?.targets ?? {};

  return ok(resolveMonthlyTarget(month, targets));
}
