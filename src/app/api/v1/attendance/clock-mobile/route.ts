import { NextResponse } from "next/server";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, employees, outlets, users } from "@/db/schema";
import {
  buildFriendlyFilename,
  isDriveConfigured,
  uploadToDrive,
} from "@/lib/google-drive/uploader";
import { validateSelfieEXIF } from "@/lib/exif-check";
import { haversineDistanceMeters } from "@/lib/haversine";
import { fetchScheduleByEmployeeAndDate } from "@/features/schedules/queries";
import { logAudit } from "@/lib/audit/logger";
import { toJakartaDateOnly } from "@/lib/date";

/**
 * POST /api/v1/attendance/clock-mobile — Phase 4-C (sesi AB).
 *
 * Mobile absensi clock-in / clock-out endpoint. Bypass NextAuth — auth via
 * attendance PIN dari karyawan (terpisah dari users.pin).
 *
 * Multipart fields:
 *   pin          — 4-6 digit attendance PIN
 *   selfie       — JPEG file dari kamera depan (capture="user")
 *   gpsLat       — string number, latitude karyawan saat ini
 *   gpsLng       — string number, longitude
 *   mode         — "in" | "out"
 *   clientRefId  — UUID untuk idempotency dedup (optional but recommended)
 *
 * Validation order:
 *   1. PIN → resolve employee + outlet
 *   2. JPEG sig + EXIF DateTimeOriginal (capture < 5 menit lalu)
 *   3. GPS distance ≤ outlet.attendance.gpsCenter.radiusMeters (default 50m)
 *   4. Idempotency: existing record with same clientRefId in last 60s?
 *   5. For "in": no existing open record (block double-in same day)
 *      For "out": open record exists for today
 *   6. Upload selfie to Drive (hard-fail kalau gagal — owner directive)
 *   7. Insert/update attendance_records + late detect
 *   8. Audit log
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap untuk selfie
const DEFAULT_GPS = { lat: -6.6753234, lng: 106.9298715, radiusMeters: 50 };
const IDEMPOTENCY_WINDOW_MS = 60 * 1000;

function jsonError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

function minutesIntoWibDay(at: Date): number {
  const wibHours = (at.getUTCHours() + 7) % 24;
  const wibMinutes = at.getUTCMinutes();
  return wibHours * 60 + wibMinutes;
}

function timeStringToMinutes(hms: string): number {
  const [h, m] = hms.split(":").map((s) => parseInt(s, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

async function resolveLateGrace(outletId: string): Promise<number> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  const configured = row?.settings?.attendance?.lateGraceMinutes;
  if (typeof configured === "number" && configured >= 0 && configured <= 60) {
    return configured;
  }
  return 5;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDriveConfigured()) {
    return jsonError(
      "DRIVE_NOT_CONFIGURED",
      "Drive belum di-setup — tidak bisa simpan selfie",
      500,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("BAD_REQUEST", "Body harus multipart/form-data", 400);
  }

  const pin = (form.get("pin") ?? "").toString();
  const file = form.get("selfie");
  const gpsLatRaw = (form.get("gpsLat") ?? "").toString();
  const gpsLngRaw = (form.get("gpsLng") ?? "").toString();
  const mode = (form.get("mode") ?? "").toString();
  const clientRefId =
    typeof form.get("clientRefId") === "string"
      ? (form.get("clientRefId") as string)
      : null;

  if (!/^\d{4,6}$/.test(pin)) {
    return jsonError("VALIDATION", "PIN harus 4-6 digit angka", 400);
  }
  if (!(file instanceof File)) {
    return jsonError("BAD_REQUEST", "Selfie wajib di-upload", 400);
  }
  if (file.size > MAX_BYTES) {
    return jsonError("FILE_TOO_LARGE", "Ukuran selfie maksimal 5 MB", 400);
  }
  const gpsLat = parseFloat(gpsLatRaw);
  const gpsLng = parseFloat(gpsLngRaw);
  if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng)) {
    return jsonError(
      "GPS_INVALID",
      "GPS coords tidak valid — aktifkan lokasi di browser",
      400,
    );
  }
  if (mode !== "in" && mode !== "out") {
    return jsonError("BAD_REQUEST", "mode harus 'in' atau 'out'", 400);
  }

  // Resolve karyawan via PIN
  const candidates = await db
    .select({
      id: employees.id,
      outletId: employees.outletId,
      fullName: employees.fullName,
      pinHash: employees.attendancePinHash,
      status: employees.status,
    })
    .from(employees)
    .where(
      and(
        isNotNull(employees.attendancePinHash),
        isNull(employees.deletedAt),
      ),
    );
  const bcrypt = (await import("bcryptjs")).default;
  let matched: (typeof candidates)[number] | null = null;
  for (const e of candidates) {
    if (!e.pinHash) continue;
    if (await bcrypt.compare(pin, e.pinHash)) {
      matched = e;
      break;
    }
  }
  if (!matched) {
    return jsonError(
      "INVALID_PIN",
      "PIN tidak dikenali. Hubungi Owner kalau lupa.",
      401,
    );
  }
  if (matched.status !== "active") {
    return jsonError(
      "EMPLOYEE_NOT_ACTIVE",
      `Karyawan ${matched.fullName} tidak aktif`,
      403,
    );
  }

  // GPS distance check
  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, matched.outletId))
    .limit(1);
  const gpsCenter =
    outletRow?.settings?.attendance?.gpsCenter ?? DEFAULT_GPS;
  const distance = haversineDistanceMeters(
    { lat: gpsLat, lng: gpsLng },
    { lat: gpsCenter.lat, lng: gpsCenter.lng },
  );
  if (distance > gpsCenter.radiusMeters) {
    await logAudit({
      eventType: "attendance.mobile_rejected",
      userId: null,
      entityType: "attendance",
      entityId: matched.id,
      payload: {
        summary: `${matched.fullName} ditolak — di luar radius (${distance}m / ${gpsCenter.radiusMeters}m)`,
        context: { gpsLat, gpsLng, distance, mode },
      },
      metadata: { outletId: matched.outletId, actorRole: "system" },
    }).catch((e) => console.error("[audit attendance reject]", e));
    return jsonError(
      "GPS_OUT_OF_RANGE",
      `Anda terlalu jauh dari kedai (${distance}m / batas ${gpsCenter.radiusMeters}m). Pastikan sudah di lokasi.`,
      400,
    );
  }

  // EXIF check
  const buffer = Buffer.from(await file.arrayBuffer());
  const now = new Date();
  const exifResult = await validateSelfieEXIF(buffer, now);
  if (!exifResult.ok) {
    await logAudit({
      eventType: "attendance.mobile_rejected",
      userId: null,
      entityType: "attendance",
      entityId: matched.id,
      payload: {
        summary: `${matched.fullName} ditolak — selfie EXIF tidak valid: ${exifResult.reason}`,
        context: { mode, reason: exifResult.reason },
      },
      metadata: { outletId: matched.outletId, actorRole: "system" },
    }).catch((e) => console.error("[audit attendance reject exif]", e));
    return jsonError(
      "SELFIE_INVALID",
      exifResult.reason ?? "Selfie tidak valid",
      400,
    );
  }

  // Idempotency dedup — kalau ada record dalam 60s dengan clientRefId sama, return existing
  if (clientRefId) {
    const [existing] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.clientRefId, clientRefId),
          gte(
            attendanceRecords.createdAt,
            new Date(Date.now() - IDEMPOTENCY_WINDOW_MS),
          ),
        ),
      )
      .limit(1);
    if (existing) {
      return NextResponse.json({
        ok: true,
        data: {
          recordId: existing.id,
          mode,
          clockedAt: (mode === "out"
            ? existing.clockOutAt ?? existing.clockInAt
            : existing.clockInAt
          ).toISOString(),
          isLate: existing.isLate === "yes",
          minutesLate: existing.lateMinutes,
          duplicate: true,
        },
      });
    }
  }

  // Workflow guard
  const todayWib = toJakartaDateOnly(now);
  const [openRow] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, matched.id),
        isNull(attendanceRecords.clockOutAt),
      ),
    )
    .limit(1);
  if (mode === "in" && openRow) {
    return jsonError(
      "ALREADY_CLOCKED_IN",
      `Kamu masih clock-in (${openRow.clockInAt.toISOString()}). Clock Out dulu.`,
      409,
    );
  }
  if (mode === "out" && !openRow) {
    return jsonError(
      "NOT_CLOCKED_IN",
      "Belum ada Clock In hari ini. Clock In dulu sebelum Clock Out.",
      409,
    );
  }

  // Upload selfie to Drive (hard-fail per owner directive)
  let driveUrl: string;
  let driveFileId: string;
  try {
    const ts = Date.now();
    const safeName = matched.fullName.replace(/[\\/?*<>:|"]/g, "_").slice(0, 60);
    const customFilename = buildFriendlyFilename({
      label: mode === "in" ? "ABSEN_IN" : "ABSEN_OUT",
      parts: [safeName, ts.toString(36)],
      uploaderName: safeName,
      originalName: file.name || "selfie.jpg",
      contentType: file.type || "image/jpeg",
    });
    const result = await uploadToDrive({
      module: "attendance",
      context: {
        employeeId: matched.id,
        employeeName: matched.fullName,
        date: todayWib,
      },
      originalName: file.name || "selfie.jpg",
      contentType: file.type || "image/jpeg",
      data: buffer,
      customFilename,
    });
    driveUrl = result.url;
    driveFileId = result.fileId;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload gagal";
    return jsonError(
      "DRIVE_UPLOAD_FAILED",
      `Gagal upload selfie ke Drive: ${message}. Coba lagi.`,
      500,
    );
  }

  // System actor (clockedInBy / clockedOutBy is users.id NOT NULL — pakai
  // first owner di outlet sebagai placeholder untuk mobile flow).
  const [systemActor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.outletId, matched.outletId))
    .limit(1);
  if (!systemActor) {
    return jsonError(
      "OUTLET_NO_USER",
      "Tidak ada user di outlet — tidak bisa attribute clock event",
      500,
    );
  }

  if (mode === "in") {
    // Late detection
    const schedule = await fetchScheduleByEmployeeAndDate(matched.id, todayWib);
    let isLate: "yes" | "no" | "unknown" = "unknown";
    let lateMinutes: number | null = null;
    if (schedule && !schedule.dayOff && schedule.startTime) {
      const grace = await resolveLateGrace(matched.outletId);
      const scheduledStart = timeStringToMinutes(schedule.startTime);
      const actualStart = minutesIntoWibDay(now);
      const diff = actualStart - scheduledStart;
      if (diff > grace) {
        isLate = "yes";
        lateMinutes = diff;
      } else {
        isLate = "no";
        lateMinutes = 0;
      }
    }

    const [row] = await db
      .insert(attendanceRecords)
      .values({
        outletId: matched.outletId,
        employeeId: matched.id,
        shiftDate: todayWib,
        clockInAt: now,
        clockedInBy: systemActor.id,
        isLate,
        lateMinutes,
        selfieDriveUrl: driveUrl,
        selfieDriveFileId: driveFileId,
        gpsLat,
        gpsLng,
        gpsDistanceMeters: distance,
        clientRefId,
      })
      .returning();

    await logAudit({
      eventType: "attendance.mobile_clock_in",
      userId: null,
      entityType: "attendance",
      entityId: row.id,
      payload: {
        summary: `Mobile clock-in: ${matched.fullName}${isLate === "yes" ? ` (telat ${lateMinutes} mnt)` : ""}`,
        context: { distance, isLate, lateMinutes },
      },
      metadata: { outletId: matched.outletId, actorRole: "system" },
    }).catch((e) => console.error("[audit mobile clock_in]", e));

    return NextResponse.json({
      ok: true,
      data: {
        recordId: row.id,
        mode: "in" as const,
        clockedAt: row.clockInAt.toISOString(),
        isLate: row.isLate === "yes",
        minutesLate: row.lateMinutes,
      },
    });
  }

  // mode === "out"
  if (!openRow) {
    // Defensive — already checked above, but TS needs this guard
    return jsonError("NOT_CLOCKED_IN", "Tidak ada Clock In aktif", 409);
  }
  const workMinutes = Math.round(
    (now.getTime() - openRow.clockInAt.getTime()) / 60_000,
  );
  let overtimeMinutes: number | null = null;
  const schedule = await fetchScheduleByEmployeeAndDate(
    matched.id,
    openRow.shiftDate,
  );
  if (schedule && !schedule.dayOff && schedule.endTime) {
    const scheduledEnd = timeStringToMinutes(schedule.endTime);
    const actualEnd = minutesIntoWibDay(now);
    const diff = actualEnd - scheduledEnd;
    overtimeMinutes = diff > 0 ? diff : 0;
  }

  const [updated] = await db
    .update(attendanceRecords)
    .set({
      clockOutAt: now,
      clockedOutBy: systemActor.id,
      workMinutes,
      overtimeMinutes,
      // Selfie out — kalau record sudah punya selfie_in, kita simpan selfie_out
      // di payload metadata audit only (column hanya 1 url). Tapi best practice:
      // overwrite OR keep first. Owner mau both? Untuk MVP simpan selfie_out
      // di clockOut url field — keep selfie_in URL kalau perlu di audit.
      selfieDriveUrl: driveUrl,
      selfieDriveFileId: driveFileId,
      gpsLat,
      gpsLng,
      gpsDistanceMeters: distance,
      clientRefId: clientRefId ?? openRow.clientRefId,
      updatedAt: now,
    })
    .where(eq(attendanceRecords.id, openRow.id))
    .returning();

  await logAudit({
    eventType: "attendance.mobile_clock_out",
    userId: null,
    entityType: "attendance",
    entityId: updated.id,
    payload: {
      summary: `Mobile clock-out: ${matched.fullName} (${workMinutes} mnt kerja${overtimeMinutes && overtimeMinutes > 0 ? `, OT ${overtimeMinutes} mnt` : ""})`,
      context: { distance, workMinutes, overtimeMinutes },
    },
    metadata: { outletId: matched.outletId, actorRole: "system" },
  }).catch((e) => console.error("[audit mobile clock_out]", e));

  return NextResponse.json({
    ok: true,
    data: {
      recordId: updated.id,
      mode: "out" as const,
      clockedAt: updated.clockOutAt!.toISOString(),
      isLate: updated.isLate === "yes",
      minutesLate: updated.lateMinutes,
      workMinutes,
      overtimeMinutes,
    },
  });
}
