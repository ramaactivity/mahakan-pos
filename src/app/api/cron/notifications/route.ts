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

const VALID_JOBS: ReadonlyArray<CronJob> = [
  "attendance-morning",
  "low-stock-scan",
  "daily-digest",
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

  if (!job) {
    return NextResponse.json({
      ok: true,
      data: { skipped: true, reason: "no job for current hour" },
    });
  }

  const result = await runJob(job);
  return NextResponse.json({ ok: true, data: result });
}
