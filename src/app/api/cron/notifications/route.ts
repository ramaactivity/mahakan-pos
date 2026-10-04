/**
 * Sesi AE-125 — Cron endpoint untuk time-based notification jobs.
 *
 * Auth: Bearer <CRON_SECRET> di Authorization header. CRON_SECRET set di
 * Vercel env. GitHub Actions workflow yang fire akan baca dari repo
 * secret CRON_SECRET (mirror).
 *
 * Usage:
 *   GET /api/cron/notifications              → auto-determine job by WIB hour
 *   GET /api/cron/notifications?job=<name>   → force specific job (testing)
 *
 * Response: JSON dengan stats per job.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getJobForCurrentHour,
  runJob,
  type CronJob,
} from "@/features/cron-jobs/notifications";

/* Audit AE-187 — route ini menjalankan journal-sweep + settlement generate,
 * kerja terberat di seluruh app. Tanpa maxDuration eksplisit, plan Hobby
 * bisa memutus function di default 10s → sapuan kepotong di tengah (aman
 * karena idempoten, tapi tak pernah selesai saat data membesar). 60s =
 * batas maksimal Hobby. */
export const maxDuration = 60;

const VALID_JOBS: ReadonlyArray<CronJob> = [
  "attendance-morning",
  "low-stock-scan",
  "daily-digest",
  /* Sesi AE-131 — Operasional checklist reminders. */
  "operasional-daily-closing",
  "operasional-weekly-sunday",
  "operasional-monthly-day28",
  /* Sesi AE-165 — auto-settlement QRIS/EDC harian. */
  "cashless-settlement",
  /* Sesi AE-182 — sapu jurnal kosong (juga jalan otomatis tiap jam). */
  "journal-sweep",
];

export async function GET(request: NextRequest) {
  /* Auth: Bearer CRON_SECRET. */
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_CONFIGURED",
          message: "CRON_SECRET env tidak di-set",
        },
      },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.slice(7) !== secret) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Invalid bearer token" },
      },
      { status: 401 },
    );
  }

  /* Job resolution. */
  const jobParam = request.nextUrl.searchParams.get("job");
  let job: CronJob | null = null;
  if (jobParam) {
    if (!VALID_JOBS.includes(jobParam as CronJob)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_JOB",
            message: `Unknown job: ${jobParam}. Valid: ${VALID_JOBS.join(", ")}`,
          },
        },
        { status: 400 },
      );
    }
    job = jobParam as CronJob;
  } else {
    job = getJobForCurrentHour();
  }

  /* Sesi AE-182 — sapu jurnal kosong jalan SETIAP kali cron menyapa (tiap
   * jam), bukan cuma di slot jam tertentu. Ini jaring pengaman pembukuan:
   * kalau ada transaksi yang jurnalnya belum tercatat, paling lama 1 jam
   * sudah dipulihkan otomatis tanpa owner klik apa pun.
   *
   * Dilewati kalau job yang diminta memang journal-sweep (biar tidak dobel)
   * dan tidak boleh menjatuhkan job utama kalau gagal. */
  /* Sesi AE-250 — settlement QRIS/EDC juga jalan SETIAP kali cron menyapa.
   * Dulu terikat slot jam 01 WIB persis; run Actions yang molor sejam saja
   * membuat hari itu tidak pernah di-settle. Idempoten (hari yang sudah ada
   * di-skip). Dijalankan sebelum sapuan supaya jurnal yang gagal ikut
   * tersapu di run yang sama. */
  let settlement: Awaited<ReturnType<typeof runJob>> | null = null;
  if (jobParam !== "cashless-settlement") {
    try {
      settlement = await runJob("cashless-settlement");
    } catch (e) {
      console.error("[cron cashless-settlement]", e);
    }
  }

  let sweep: Awaited<ReturnType<typeof runJob>> | null = null;
  if (jobParam !== "journal-sweep") {
    try {
      sweep = await runJob("journal-sweep");
    } catch (e) {
      console.error("[cron journal-sweep]", e);
    }
  }

  if (!job) {
    return NextResponse.json({
      ok: true,
      data: { skipped: true, reason: "no job for current hour", settlement, sweep },
    });
  }

  const result = await runJob(job);
  return NextResponse.json({ ok: true, data: { ...result, settlement, sweep } });
}
