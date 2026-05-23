import "server-only";

/**
 * Sesi AE-125 — Time-based notification jobs untuk cron.
 *
 * Dipanggil dari /api/cron/notifications endpoint via GitHub Actions
 * (hourly). Endpoint determines which job to fire based on current
 * WIB hour. Idempotent (kalau cron fire 2x dalam 1 jam, hasil sama —
 * push notif tag-based di-dedup di browser side).
 *
 * Jobs:
 *   - attendance-morning (06:00 WIB): reminder clock-in untuk staff
 *     yang ada schedule today
 *   - low-stock-scan (08:00 WIB): notif inventory kalau ada bahan di
 *     bawah threshold
 *   - daily-digest (20:00 WIB): summary untuk Finance (sales + pending)
 *
 * Note: anti-noise sudah di-handle di sendCategorizedPush() — quiet
 * hours, snooze, opt-out semua honored.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cashDeposits,
  employees,
  employeeSchedules,
  ingredients,
  outlets,
  users,
} from "@/db/schema";
import { sendCategorizedPush } from "@/features/push-notifications/server";

export type CronJob =
  | "attendance-morning"
  | "low-stock-scan"
  | "daily-digest";

export interface CronJobResult {
  job: CronJob;
  outletsProcessed: number;
  notifSent: number;
  errors: string[];
}

/**
 * Job 1: attendance-morning (06:00 WIB).
 * Notify staff yang punya schedule hari ini supaya jangan telat clock-in.
 * Category: attendance (default subscribed: Bayu HR; staff sendiri).
 *
 * Logic:
 *   1. Resolve today (WIB) date string
 *   2. Per outlet: count schedules today, fire 1 notif ke kategori attendance
 *   3. Notif body summary "X staff jadwal hari ini"
 *
 * Optional enhancement (Phase D): per-staff personal notif. Sekarang batch
 * level outlet supaya tidak spam.
 */
export async function runAttendanceMorningJob(): Promise<CronJobResult> {
  const result: CronJobResult = {
    job: "attendance-morning",
    outletsProcessed: 0,
    notifSent: 0,
    errors: [],
  };
  try {
    const todayWib = todayWibIso();
    const outletList = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(isNull(outlets.deletedAt));

    for (const outlet of outletList) {
      result.outletsProcessed++;
      try {
        /* Count schedules for today di outlet ini. */
        const todayShifts = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(employeeSchedules)
          .innerJoin(
            employees,
            eq(employees.id, employeeSchedules.employeeId),
          )
          .where(
            and(
              eq(employees.outletId, outlet.id),
              eq(employeeSchedules.scheduleDate, todayWib),
              eq(employeeSchedules.dayOff, false),
            ),
          );
        const count = todayShifts[0]?.count ?? 0;
        if (count === 0) continue;

        const push = await sendCategorizedPush(
          "attendance",
          outlet.id,
          {
            title: `Jadwal kerja hari ini`,
            body: `${count} karyawan terjadwal masuk. Pastikan clock-in tepat waktu.`,
            url: "/dashboard#hr_operations",
            tag: `attendance-morning-${todayWib}`,
          },
        );
        result.notifSent += push.sent;
      } catch (e) {
        result.errors.push(
          `outlet ${outlet.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  }
  return result;
}

/**
 * Job 2: low-stock-scan (08:00 WIB).
 * Notify inventory kalau ada bahan di bawah reorder threshold.
 * Category: inventory (default: Cacil).
 *
 * Logic:
 *   1. Per outlet: count ingredients dengan currentStock < reorderThreshold
 *   2. Kalau ada, fire notif dengan count + top 3 nama bahan
 */
export async function runLowStockScanJob(): Promise<CronJobResult> {
  const result: CronJobResult = {
    job: "low-stock-scan",
    outletsProcessed: 0,
    notifSent: 0,
    errors: [],
  };
  try {
    const outletList = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(isNull(outlets.deletedAt));

    for (const outlet of outletList) {
      result.outletsProcessed++;
      try {
        const lowStock = await db
          .select({
            id: ingredients.id,
            name: ingredients.name,
            currentStock: ingredients.currentStock,
            reorderThreshold: ingredients.reorderThreshold,
          })
          .from(ingredients)
          .where(
            and(
              eq(ingredients.outletId, outlet.id),
              isNull(ingredients.deletedAt),
              eq(ingredients.isActive, true),
              lt(ingredients.currentStock, ingredients.reorderThreshold),
            ),
          )
          .limit(10);

        if (lowStock.length === 0) continue;

        const top3 = lowStock
          .slice(0, 3)
          .map((i) => i.name)
          .join(", ");
        const more = lowStock.length > 3 ? ` +${lowStock.length - 3} lain` : "";

        const push = await sendCategorizedPush(
          "inventory",
          outlet.id,
          {
            title: `${lowStock.length} bahan stok rendah`,
            body: `${top3}${more}. Pertimbangkan buat PR.`,
            url: "/dashboard#inventory",
            tag: `low-stock-${todayWibIso()}`,
          },
        );
        result.notifSent += push.sent;
      } catch (e) {
        result.errors.push(
          `outlet ${outlet.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  }
  return result;
}

/**
 * Job 3: daily-digest (20:00 WIB).
 * Summary untuk Finance: pending setoran + journal retry queue size.
 * Category: finance_close (default: Inab + Sekal).
 *
 * Logic:
 *   1. Per outlet: count pending setoran + count pending journal retry
 *   2. Kalau ada salah satu > 0, fire digest notif
 */
export async function runDailyDigestJob(): Promise<CronJobResult> {
  const result: CronJobResult = {
    job: "daily-digest",
    outletsProcessed: 0,
    notifSent: 0,
    errors: [],
  };
  try {
    const outletList = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(isNull(outlets.deletedAt));

    for (const outlet of outletList) {
      result.outletsProcessed++;
      try {
        const [pendingSetoran] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(cashDeposits)
          .where(
            and(
              eq(cashDeposits.outletId, outlet.id),
              eq(cashDeposits.status, "pending_verification"),
            ),
          );
        const setoranCount = pendingSetoran?.count ?? 0;

        if (setoranCount === 0) continue; // nothing to digest

        const push = await sendCategorizedPush(
          "finance_close",
          outlet.id,
          {
            title: `Ringkasan harian — review`,
            body: `${setoranCount} setoran tunai menunggu verifikasi. Mohon review sebelum tutup hari.`,
            url: "/dashboard#setoran_tunai",
            tag: `daily-digest-${todayWibIso()}`,
          },
        );
        result.notifSent += push.sent;
      } catch (e) {
        result.errors.push(
          `outlet ${outlet.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  }
  /* Pakai users import supaya tidak unused (future ditambah per-user digest). */
  void users;
  return result;
}

function todayWibIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Determine which job to run based on current WIB hour.
 * Return null kalau jam ini bukan slot job.
 */
export function getJobForCurrentHour(): CronJob | null {
  const now = new Date();
  const wibHour = (now.getUTCHours() + 7) % 24;
  if (wibHour === 6) return "attendance-morning";
  if (wibHour === 8) return "low-stock-scan";
  if (wibHour === 20) return "daily-digest";
  return null;
}

export async function runJob(job: CronJob): Promise<CronJobResult> {
  switch (job) {
    case "attendance-morning":
      return runAttendanceMorningJob();
    case "low-stock-scan":
      return runLowStockScanJob();
    case "daily-digest":
      return runDailyDigestJob();
  }
}
