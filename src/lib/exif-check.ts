import "server-only";

import exifr from "exifr";

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
 *   3. Validate DateTimeOriginal dalam window 5 menit dari now → reject
 *      kalau lebih lama (foto lama yang di-upload-ulang)
 */

export interface ExifCheckResult {
  ok: boolean;
  reason?: string;
  /** When ok=true, the parsed timestamp from EXIF — for audit log. */
  capturedAt?: Date;
}

/** Max age (in milliseconds) untuk EXIF DateTimeOriginal sebelum dianggap stale. */
const MAX_AGE_MS = 5 * 60 * 1000; // 5 menit

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

  let parsed: { DateTimeOriginal?: Date | string } | null = null;
  try {
    parsed = await exifr.parse(buffer, {
      pick: ["DateTimeOriginal"],
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

  const captured =
    parsed.DateTimeOriginal instanceof Date
      ? parsed.DateTimeOriginal
      : new Date(parsed.DateTimeOriginal);

  if (Number.isNaN(captured.getTime())) {
    return {
      ok: false,
      reason: "EXIF DateTimeOriginal format tidak valid",
    };
  }

  const ageMs = Math.abs(now.getTime() - captured.getTime());
  if (ageMs > MAX_AGE_MS) {
    return {
      ok: false,
      reason: `Foto terlalu lama (${Math.round(ageMs / 60_000)} menit) — capture ulang dari kamera`,
    };
  }

  return { ok: true, capturedAt: captured };
}
