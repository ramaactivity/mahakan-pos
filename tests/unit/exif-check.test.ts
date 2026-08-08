import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateSelfieEXIF } from "@/lib/exif-check";

/**
 * Sesi AE-194 — jalur kamera live mengirim JPEG tanpa EXIF sama sekali
 * (canvas tidak menulis metadata). Sejumlah HP juga begitu di jalur file
 * input (iPhone HEIC → Safari convert ke JPEG saat upload). Tes ini
 * mengunci: EXIF wajib di jalur file, opsional di jalur live, tapi
 * pengecekan lain (signature JPEG, umur foto) tidak ikut longgar.
 */

/** JPEG minimal yang sah tapi tanpa segmen EXIF. */
function jpegWithoutExif(): Buffer {
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0 JFIF, len 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xd9, // EOI
  ]);
}

/** JPEG dengan APP1 EXIF berisi DateTimeOriginal (little-endian TIFF). */
function jpegWithDateTimeOriginal(stamp: string): Buffer {
  const tiff = Buffer.alloc(64);
  tiff.write("II", 0, "ascii"); // little-endian
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // offset IFD0

  // IFD0 @8: satu entry = pointer ke Exif sub-IFD
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10); // ExifIFDPointer
  tiff.writeUInt16LE(4, 12); // type LONG
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt32LE(26, 18); // value = offset sub-IFD
  tiff.writeUInt32LE(0, 22); // next IFD = none

  // Exif sub-IFD @26: satu entry = DateTimeOriginal
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28); // DateTimeOriginal
  tiff.writeUInt16LE(2, 30); // type ASCII
  tiff.writeUInt32LE(20, 32); // count (19 char + NUL)
  tiff.writeUInt32LE(44, 36); // value offset
  tiff.writeUInt32LE(0, 40); // next IFD = none
  tiff.write(stamp, 44, "ascii"); // 19 char, sisa byte sudah 0

  const header = Buffer.from("Exif\0\0", "ascii");
  const payload = Buffer.concat([header, tiff]);
  const app1 = Buffer.alloc(4);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(payload.length + 2, 2);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    payload,
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe("validateSelfieEXIF", () => {
  it("menolak JPEG tanpa DateTimeOriginal saat EXIF diwajibkan", async () => {
    const res = await validateSelfieEXIF(jpegWithoutExif());
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("DateTimeOriginal");
  });

  it("default-nya tetap mewajibkan EXIF (klien lama tidak ikut longgar)", async () => {
    const res = await validateSelfieEXIF(jpegWithoutExif(), new Date(), {});
    expect(res.ok).toBe(false);
  });

  it("menerima JPEG tanpa EXIF saat requireExif=false (kamera live)", async () => {
    const res = await validateSelfieEXIF(jpegWithoutExif(), new Date(), {
      requireExif: false,
    });
    expect(res.ok).toBe(true);
    expect(res.capturedAt).toBeUndefined();
    expect(res.exifGps).toBeNull();
  });

  it("tetap menolak file yang bukan JPEG walau requireExif=false", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await validateSelfieEXIF(png, new Date(), {
      requireExif: false,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("JPEG");
  });

  it("tetap menolak file terlalu kecil walau requireExif=false", async () => {
    const res = await validateSelfieEXIF(Buffer.from([0xff]), new Date(), {
      requireExif: false,
    });
    expect(res.ok).toBe(false);
  });

  it("tetap menolak foto basi kalau EXIF-nya kebetulan ada, walau requireExif=false", async () => {
    // Tahun 2000 → jauh di luar jendela 10 menit di zona waktu mana pun.
    const res = await validateSelfieEXIF(
      jpegWithDateTimeOriginal("2000:01:01 00:00:00"),
      new Date("2026-08-08T16:13:00Z"),
      { requireExif: false },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("terlalu lama");
  });
});
