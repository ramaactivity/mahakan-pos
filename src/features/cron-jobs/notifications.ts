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
import {
  currentPeriodKey,
  formatPeriodLabel,
} from "@/features/operasional-tasks/period";
import { getCompletionProgress } from "@/features/operasional-tasks/queries";
import { generateCashlessForOutlet } from "@/features/finance/settlement-generate";

export type CronJob =
  | "attendance-morning"
  | "low-stock-scan"
  | "daily-digest"
  /* Sesi AE-131 — Operasional Checklist reminders. */
  | "operasional-daily-closing"
  | "operasional-weekly-sunday"
  | "operasional-monthly-day28"
  /* Sesi AE-165 — auto-settlement QRIS/EDC harian dari POS. */
  | "cashless-settlement";

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
 * Sesi AE-165 — Job: cashless-settlement (01:00 WIB).
 * Auto-generate settlement QRIS & EDC BCA dari transaksi POS untuk hari
 * KEMARIN (WIB sudah komplit). Idempoten: hari yang sudah ada settlement
 * (CSV/auto) di-skip → aman dijalankan ulang. createdBy = owner outlet.
 * Tidak push notif — murni materialisasi data (+ clear piutang kalau
 * auto-journal ON).
 */
export async function runCashlessSettlementJob(): Promise<CronJobResult> {
  const result: CronJobResult = {
    job: "cashless-settlement",
    outletsProcessed: 0,
    notifSent: 0,
    errors: [],
  };
  try {
    const yDate = new Date(`${todayWibIso()}T00:00:00Z`);
    yDate.setUTCDate(yDate.getUTCDate() - 1);
    const yesterday = yDate.toISOString().slice(0, 10);

    const outletList = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(isNull(outlets.deletedAt));

    for (const outlet of outletList) {
      result.outletsProcessed++;
      try {
        /* createdBy butuh user nyata (FK) — pakai owner aktif pertama. */
        const [owner] = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.outletId, outlet.id),
              eq(users.role, "owner"),
              isNull(users.deletedAt),
            ),
          )
          .limit(1);
        if (!owner) {
          result.errors.push(`outlet ${outlet.id}: tidak ada user owner`);
          continue;
        }
        const gen = await generateCashlessForOutlet({
          outletId: outlet.id,
          createdBy: owner.id,
          actorRole: "system",
          from: yesterday,
          to: yesterday,
        });
        /* notifSent dipakai sebagai counter "settlement dibuat" untuk log. */
        result.notifSent += gen.created.length;
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

/* ============================================================
 * Sesi AE-131 — Operasional Checklist reminders.
 *
 * Tiga reminder slot:
 *  - daily-closing (21:00 WIB): scoped ke staff scheduled today & tidak
 *    day-off. Tujuan: closing reminder kalau daily ceklist < 100%.
 *  - weekly-sunday (Sun 19:00 WIB): broadcast ke operasional subscribers
 *    kalau weekly ceklist < 100%.
 *  - monthly-day28 (tgl 28, 10:00 WIB): broadcast ke operasional subs
 *    kalau monthly ceklist < 100% — cukup awal untuk dikejar.
 *
 * Anti-noise: tag-based dedup (per period_key) + category push respect
 * user opt-out + quiet hours.
 * ============================================================ */

/**
 * Job: operasional-daily-closing.
 * Cek progress daily — push ke staff yang scheduled today (tidak day-off).
 * Yang libur tidak diganggu (per directive owner Rama, sesi AE-131).
 */
export async function runOperasionalDailyClosingJob(): Promise<CronJobResult> {
  const result: CronJobResult = {
    job: "operasional-daily-closing",
    outletsProcessed: 0,
    notifSent: 0,
    errors: [],
  };
  try {
    const todayWib = todayWibIso();
    const outletList = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(isNull(outlets.deletedAt));
    for (const outlet of outletList) {
      result.outletsProcessed++;
      try {
        const progress = await getCompletionProgress(outlet.id, "daily");
        if (progress.total === 0) continue;
        if (progress.done >= progress.total) continue; // 100% — no nag

        /* Cek apakah ada minimal 1 staff yang scheduled today (tidak off).
         * Kalau semua libur (mis. weekly off), skip push — hari ini emang
         * tidak ada operator. */
        const [scheduledCount] = await db
          .select({ c: sql<number>`count(*)::int` })
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
        if ((scheduledCount?.c ?? 0) === 0) continue;

        const missing = progress.total - progress.done;
        const push = await sendCategorizedPush(
          "operasional",
          outlet.id,
          {
            title: `Checklist harian: ${progress.done}/${progress.total}`,
            body: `${missing} tugas belum dicentang. Selesaikan sebelum tutup.`,
            url: "/m/checklist",
            tag: `op-daily-${todayWib}`,
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
 * Job: operasional-weekly-sunday.
 * Broadcast Sunday 19:00 WIB. Push ke operasional subs (Owner+Manager+
 * Supervisor+Staff yang sub). Tidak filter schedule — weekly tasks
 * boleh dikerjain siapa saja yang shift selama minggu itu.
 */
export async function runOperasionalWeeklyJob(): Promise<CronJobResult> {
  const result: CronJobResult = {
    job: "operasional-weekly-sunday",
    outletsProcessed: 0,
    notifSent: 0,
    errors: [],
  };
  try {
    const outletList = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(isNull(outlets.deletedAt));
    const periodKey = currentPeriodKey("weekly");
    const periodLabel = formatPeriodLabel("weekly", periodKey);
    for (const outlet of outletList) {
      result.outletsProcessed++;
      try {
        const progress = await getCompletionProgress(
          outlet.id,
          "weekly",
          periodKey,
        );
        if (progress.total === 0) continue;
        if (progress.done >= progress.total) continue;
        const missing = progress.total - progress.done;
        const push = await sendCategorizedPush(
          "operasional",
          outlet.id,
          {
            title: `Checklist mingguan: ${progress.done}/${progress.total}`,
            body: `${periodLabel} — sisa ${missing} tugas. Tutup minggu dengan bersih.`,
            url: "/m/checklist",
            tag: `op-weekly-${periodKey}`,
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
 * Job: operasional-monthly-day28.
 * Push reminder tanggal 28 jam 10:00 WIB kalau monthly < 100%. Diberi
 * window 3 hari supaya bisa dikejar sebelum akhir bulan.
 */
export async function runOperasionalMonthlyJob(): Promise<CronJobResult> {
  const result: CronJobResult = {
    job: "operasional-monthly-day28",
    outletsProcessed: 0,
    notifSent: 0,
    errors: [],
  };
  try {
    const outletList = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(isNull(outlets.deletedAt));
    const periodKey = currentPeriodKey("monthly");
    const periodLabel = formatPeriodLabel("monthly", periodKey);
    for (const outlet of outletList) {
      result.outletsProcessed++;
      try {
        const progress = await getCompletionProgress(
          outlet.id,
          "monthly",
          periodKey,
        );
        if (progress.total === 0) continue;
        if (progress.done >= progress.total) continue;
        const missing = progress.total - progress.done;
        const push = await sendCategorizedPush(
          "operasional",
          outlet.id,
          {
            title: `Checklist bulanan: ${progress.done}/${progress.total}`,
            body: `${periodLabel} — sisa ${missing} tugas. Sisa ~3 hari sebelum tutup bulan.`,
            url: "/m/checklist",
            tag: `op-monthly-${periodKey}`,
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
 * Determine which job to run based on current WIB time.
 * Return null kalau jam ini bukan slot job.
 */
export function getJobForCurrentHour(): CronJob | null {
  const now = new Date();
  const wibMs = now.getTime() + 7 * 60 * 60 * 1000;
  const wibDate = new Date(wibMs);
  const wibHour = wibDate.getUTCHours();
  const wibDay = wibDate.getUTCDate(); // 1..31
  const wibDow = wibDate.getUTCDay(); // 0=Sun ... 6=Sat
  if (wibHour === 1) return "cashless-settlement";
  if (wibHour === 6) return "attendance-morning";
  if (wibHour === 8) return "low-stock-scan";
  if (wibHour === 10 && wibDay === 28) return "operasional-monthly-day28";
  if (wibHour === 19 && wibDow === 0) return "operasional-weekly-sunday";
  if (wibHour === 20) return "daily-digest";
  if (wibHour === 21) return "operasional-daily-closing";
  return null;
}

export async function runJob(job: CronJob): Promise<CronJobResult> {
  switch (job) {
    case "cashless-settlement":
      return runCashlessSettlementJob();
    case "attendance-morning":
      return runAttendanceMorningJob();
    case "low-stock-scan":
      return runLowStockScanJob();
    case "daily-digest":
      return runDailyDigestJob();
    case "operasional-daily-closing":
      return runOperasionalDailyClosingJob();
    case "operasional-weekly-sunday":
      return runOperasionalWeeklyJob();
    case "operasional-monthly-day28":
      return runOperasionalMonthlyJob();
  }
}
