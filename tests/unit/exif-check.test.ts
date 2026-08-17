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

/** JPEG dengan APP1 EXIF berisi GPS saja (tanpa DateTimeOriginal). */
function jpegWithGps(lat: number, lng: number): Buffer {
  const tiff = Buffer.alloc(128);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // offset IFD0

  // IFD0 @8: satu entry = pointer ke GPS IFD
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10); // GPSInfoIFDPointer
  tiff.writeUInt16LE(4, 12); // LONG
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18); // offset GPS IFD
  tiff.writeUInt32LE(0, 22); // next IFD = none

  // GPS IFD @26: 4 entry (ref + koordinat, urut tag)
  tiff.writeUInt16LE(4, 26);
  const entry = (i: number) => 28 + i * 12;

  tiff.writeUInt16LE(0x0001, entry(0)); // GPSLatitudeRef
  tiff.writeUInt16LE(2, entry(0) + 2); // ASCII
  tiff.writeUInt32LE(2, entry(0) + 4);
  tiff.write(lat >= 0 ? "N\0" : "S\0", entry(0) + 8, "ascii");

  tiff.writeUInt16LE(0x0002, entry(1)); // GPSLatitude
  tiff.writeUInt16LE(5, entry(1) + 2); // RATIONAL
  tiff.writeUInt32LE(3, entry(1) + 4);
  tiff.writeUInt32LE(80, entry(1) + 8);

  tiff.writeUInt16LE(0x0003, entry(2)); // GPSLongitudeRef
  tiff.writeUInt16LE(2, entry(2) + 2);
  tiff.writeUInt32LE(2, entry(2) + 4);
  tiff.write(lng >= 0 ? "E\0" : "W\0", entry(2) + 8, "ascii");

  tiff.writeUInt16LE(0x0004, entry(3)); // GPSLongitude
  tiff.writeUInt16LE(5, entry(3) + 2);
  tiff.writeUInt32LE(3, entry(3) + 4);
  tiff.writeUInt32LE(104, entry(3) + 8);

  tiff.writeUInt32LE(0, 76); // next IFD = none

  // Derajat sebagai pecahan penuh; menit & detik nol.
  const writeCoord = (at: number, value: number) => {
    tiff.writeUInt32LE(Math.round(Math.abs(value) * 10_000), at);
    tiff.writeUInt32LE(10_000, at + 4);
    tiff.writeUInt32LE(0, at + 8);
    tiff.writeUInt32LE(1, at + 12);
    tiff.writeUInt32LE(0, at + 16);
    tiff.writeUInt32LE(1, at + 20);
  };
  writeCoord(80, lat);
  writeCoord(104, lng);

  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
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
    /* Sesi AE-200 — pesannya wajib mengarahkan ke jalur kamera live, bukan
     * menuduh "upload galeri" (HP tertentu memang tidak menulis EXIF). */
    expect(res.reason).toContain("Kamera Live");
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

  /* Sesi AE-200 — sentinel "Null Island" dilebarkan ke ±1°. Satu HP staff
   * menanamkan GPS ~1° dari (0,0) tiap absen; filter lama (±0.01°) tidak
   * menangkapnya sehingga tiap absen menulis baris audit "GPS garbage". */
  it("menganggap GPS di sekitar (0,0) sebagai tidak ada", async () => {
    const res = await validateSelfieEXIF(jpegWithGps(0.5, 0.5), new Date(), {
      requireExif: false,
    });
    expect(res.ok).toBe(true);
    expect(res.exifGps).toBeNull();
  });

  it("tetap membaca GPS asli (koordinat outlet Cisarua)", async () => {
    const res = await validateSelfieEXIF(
      jpegWithGps(-6.6753234, 106.9298715),
      new Date(),
      { requireExif: false },
    );
    expect(res.ok).toBe(true);
    expect(res.exifGps?.lat).toBeCloseTo(-6.6753, 3);
    expect(res.exifGps?.lng).toBeCloseTo(106.9298, 3);
  });
});
