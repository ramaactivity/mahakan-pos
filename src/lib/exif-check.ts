import "server-only";

import exifr from "exifr";
import { formatDuration } from "@/lib/duration";

/**
 * Phase 4 (sesi AB) — anti-fraud check untuk selfie absensi.
 *
 * Kebijakan owner: blok upload-from-gallery — selfie HARUS ditangkap dari
 * kamera saat absen. Mobile browser dengan `<input capture="user">` umumnya
 * embed EXIF DateTimeOriginal saat capture. File yang di-upload dari galeri
 * juga punya EXIF DateTimeOriginal, tapi timestamp-nya bisa lama atau
 * tidak masuk akal.
 *
 * Strategi server-side:
 *   1. Validate JPEG signature (FF D8 FF di first 3 bytes)
 *   2. Parse EXIF — kalau DateTimeOriginal tidak ada → reject (gallery file
 *      yang sudah di-edit / strip EXIF)
 *   3. Validate DateTimeOriginal dalam window MAX_AGE_MS dari now → reject
 *      kalau lebih lama (foto lama yang di-upload-ulang)
 *
 * SESI AD-9 BUG FIX (D):
 * Karyawan WIB capture jam 14:00 (= 07:00 UTC). EXIF stored as
 * "2026:05:09 14:00:00" tanpa timezone offset. exifr di Vercel server (UTC)
 * interpretasi naive sebagai 14:00 UTC → Date object real-time = 21:00 WIB.
 * Server now() = 07:00 UTC = 14:00 WIB. Selisih palsu = 7 jam = 420 menit.
 *
 * Fix: subtract WIB offset (7 jam) dari exifr's parsed Date untuk align ke
 * actual UTC moment. Asumsi: semua karyawan Mahakan operate di WIB
 * (Cisarua). Kalau ke depan ada outlet TZ lain, harus extract dari
 * EXIF OffsetTimeOriginal tag (kalau phone provide).
 */

export interface ExifCheckResult {
  ok: boolean;
  reason?: string;
  /** When ok=true, the parsed timestamp from EXIF — for audit log. */
  capturedAt?: Date;
  /** Sesi AE-62aa — GPS coords dari EXIF (kalau phone embed). Dipakai oleh
   * clock-mobile untuk cross-check vs submitted gpsLat/gpsLng. NULL = phone
   * tidak embed GPS (privacy mode, atau JPEG re-encoded yang strip GPS).
   * Caller decide reject-or-allow saat GPS absent. */
  exifGps?: { lat: number; lng: number } | null;
}

/** Max age (in milliseconds) untuk EXIF DateTimeOriginal sebelum dianggap stale.
 *  10 menit (diperpanjang dari 5 menit setelah sesi AD-9) untuk handle
 *  network upload latency + slow phone shutter di hp lama. */
const MAX_AGE_MS = 10 * 60 * 1000;

/** Asia/Jakarta WIB UTC+7 offset. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export async function validateSelfieEXIF(
  buffer: Buffer,
  now: Date = new Date(),
): Promise<ExifCheckResult> {
  if (buffer.length < 3) {
    return { ok: false, reason: "File terlalu kecil (bukan gambar)" };
  }
  // JPEG signature
  if (
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[2] !== 0xff
  ) {
    return { ok: false, reason: "File bukan JPEG (kamera kasih JPEG)" };
  }

  let parsed:
    | {
        DateTimeOriginal?: Date | string;
        OffsetTimeOriginal?: string;
        /* Sesi AE-62aa — extract GPS untuk cross-check anti-spoofing. */
        latitude?: number;
        longitude?: number;
      }
    | null = null;
  try {
    parsed = await exifr.parse(buffer, {
      pick: [
        "DateTimeOriginal",
        "OffsetTimeOriginal",
        "GPSLatitude",
        "GPSLongitude",
        "GPSLatitudeRef",
        "GPSLongitudeRef",
      ],
      gps: true,
    });
  } catch {
    return {
      ok: false,
      reason: "Gagal baca EXIF — pastikan foto dari kamera, bukan upload galeri",
    };
  }

  if (!parsed || !parsed.DateTimeOriginal) {
    return {
      ok: false,
      reason:
        "EXIF DateTimeOriginal tidak ada — foto bukan dari kamera saat ini (kemungkinan upload galeri)",
    };
  }

  const rawCaptured =
    parsed.DateTimeOriginal instanceof Date
      ? parsed.DateTimeOriginal
      : new Date(parsed.DateTimeOriginal);

  if (Number.isNaN(rawCaptured.getTime())) {
    return {
      ok: false,
      reason: "EXIF DateTimeOriginal format tidak valid",
    };
  }

  // Apply WIB offset correction: exifr interprets naive "YYYY:MM:DD HH:mm:ss"
  // as server-local-time (UTC on Vercel). Camera was actually WIB. Subtract
  // 7h so the Date represents the actual UTC instant of capture.
  // If phone provided OffsetTimeOriginal (newer phones), use that instead.
  const offset = parsed.OffsetTimeOriginal;
  let captured: Date;
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    // Phone reported its TZ offset (e.g. "+07:00"). Compute exact correction.
    const sign = offset[0] === "-" ? -1 : 1;
    const [hh, mm] = offset.slice(1).split(":").map(Number);
    const offsetMs = sign * (hh * 60 + mm) * 60_000;
    captured = new Date(rawCaptured.getTime() - offsetMs);
  } else {
    // No TZ info → assume Asia/Jakarta WIB (Mahakan ops in Cisarua).
    captured = new Date(rawCaptured.getTime() - WIB_OFFSET_MS);
  }

  const ageMs = Math.abs(now.getTime() - captured.getTime());
  if (ageMs > MAX_AGE_MS) {
    return {
      ok: false,
      reason: `Foto terlalu lama (${formatDuration(ageMs)}) — capture ulang dari kamera`,
    };
  }

  /* Sesi AE-62aa — extract GPS lat/lng kalau phone embed di EXIF. exifr
   * dengan opsi gps:true return `latitude`+`longitude` sebagai decimal.
   *
   * Sesi AE-121 fix — banyak Android (Xiaomi MIUI, Samsung OneUI) embed
   * GPS tag dengan value (0, 0) saat permission lokasi OFF untuk camera
   * (tapi browser geolocation tetap jalan via system service). "Null
   * Island" (0°, 0°) di laut lepas Gulf of Guinea = sentinel for "GPS
   * tag exists but unset". Treat as null (= "no GPS embedded") supaya
   * tidak hard-fail karyawan legit yang phone-nya quirky. Real photos
   * tidak pernah persis di Null Island (radius 1km off-shore Africa). */
  const lat = parsed.latitude;
  const lng = parsed.longitude;
  const hasValidExifGps =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    /* Reject Null Island sentinel — exact (0,0) atau within ~1km. */
    !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) &&
    /* Sanity: real coords must be in valid range. exifr should already
     * clamp but be defensive in case GPSLatitudeRef parsing miss. */
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;
  const exifGps = hasValidExifGps
    ? { lat: lat as number, lng: lng as number }
    : null;

  return { ok: true, capturedAt: captured, exifGps };
}
