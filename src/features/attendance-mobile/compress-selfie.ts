/**
 * Sesi AE-42 — client-side JPEG compression yang preserve EXIF.
 *
 * Why ini ada:
 *   Vercel Hobby plan limit body size 4.5 MB. Modern HP camera selfie
 *   bisa 3-8 MB. Tanpa compression, request gagal di edge dengan HTML
 *   error 413 ("Request Entity Too Large"), bukan JSON — UI crash di
 *   `res.json()` parse.
 *
 * Why preserve EXIF:
 *   Server (`lib/exif-check.ts`) wajib `DateTimeOriginal` di EXIF buat
 *   anti-fraud (reject upload-from-gallery / foto lama). Canvas
 *   re-encode strip EXIF by default → server reject. Solusi: ambil
 *   APP1 segment dari original bytes, inject lagi ke output compressed.
 *
 * No dependency — implementasi pakai Canvas API + manual byte ops.
 */

const APP_MARKER_PREFIX = 0xff;
const APP1_MARKER = 0xe1;
const SOS_MARKER = 0xda; // Start of scan

/**
 * Find dan extract APP1 EXIF segment dari JPEG buffer.
 * Returns segment bytes (termasuk marker + length prefix) atau null.
 *
 * Layout JPEG:
 *   FFD8 (SOI) — 2 bytes
 *   FFE1 (APP1) <len-hi> <len-lo> "Exif\0\0" <tiff-data>
 *   FFEx ... (other app segments, e.g. APP0/JFIF)
 *   FFDB (DQT), FFC0 (SOF), FFDA (SOS, start of compressed data)
 *
 * Kita scan segment markers sampai ketemu APP1 dengan "Exif" prefix.
 * Stop kalau SOS (compressed data) — EXIF selalu sebelum SOS.
 */
function extractExifApp1(buf: Uint8Array): Uint8Array | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== APP_MARKER_PREFIX) return null; // malformed
    const marker = buf[i + 1]!;
    if (marker === SOS_MARKER) return null; // reached image data
    // Marker length (big-endian) berada di byte 2-3 setelah marker
    if (i + 4 > buf.length) return null;
    const len = (buf[i + 2]! << 8) | buf[i + 3]!;
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (marker === APP1_MARKER) {
      // Verify "Exif\0\0" identifier (6 bytes setelah len)
      if (
        i + 10 <= buf.length &&
        buf[i + 4] === 0x45 && // E
        buf[i + 5] === 0x78 && // x
        buf[i + 6] === 0x69 && // i
        buf[i + 7] === 0x66 && // f
        buf[i + 8] === 0x00 &&
        buf[i + 9] === 0x00
      ) {
        return buf.slice(i, i + 2 + len);
      }
    }
    i += 2 + len;
  }
  return null;
}

/** Insert APP1 EXIF segment right after SOI (FFD8). */
function injectExifApp1(jpegBuf: Uint8Array, app1: Uint8Array): Uint8Array {
  if (jpegBuf.length < 2 || jpegBuf[0] !== 0xff || jpegBuf[1] !== 0xd8) {
    return jpegBuf;
  }
  const out = new Uint8Array(jpegBuf.length + app1.length);
  out[0] = 0xff;
  out[1] = 0xd8;
  out.set(app1, 2);
  out.set(jpegBuf.slice(2), 2 + app1.length);
  return out;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal load image untuk compress"));
    img.src = src;
  });
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encode gagal"))),
      "image/jpeg",
      quality,
    );
  });
}

export interface CompressOptions {
  /** Target max byte size — default 1.5 MB (well below Vercel 4.5 MB limit). */
  maxBytes?: number;
  /** Max width/height dalam pixel — default 1280 (cukup buat verifikasi muka). */
  maxDimension?: number;
  /** Starting JPEG quality (0-1) — default 0.85. */
  startQuality?: number;
  /** Lowest acceptable quality — default 0.4. */
  minQuality?: number;
}

export interface CompressResult {
  file: File;
  /** Original bytes for diagnostic / UI display. */
  originalSize: number;
  /** Final compressed bytes. */
  compressedSize: number;
  /** True kalau berhasil preserve EXIF dari original. */
  exifPreserved: boolean;
}

/**
 * Compress JPEG file dengan preserve EXIF. Resize kalau dimensi lebih
 * besar dari `maxDimension`. Iteratively reduce quality sampai output
 * <= `maxBytes` atau mentok di `minQuality`.
 *
 * Output: File baru type=image/jpeg, name di-suffix `.compressed.jpg`.
 * Original File tidak di-mutate.
 *
 * Kalau input bukan JPEG atau gagal compress, return original file
 * (defensive — biar absen tetap jalan meski compression gagal).
 */
export async function compressSelfieJpeg(
  input: File,
  opts: CompressOptions = {},
): Promise<CompressResult> {
  const maxBytes = opts.maxBytes ?? 1.5 * 1024 * 1024;
  const maxDimension = opts.maxDimension ?? 1280;
  const startQuality = opts.startQuality ?? 0.85;
  const minQuality = opts.minQuality ?? 0.4;

  const originalSize = input.size;

  /* Sesi AE-200 — dulu ada early-return di sini untuk file kecil non-image
   * yang melaporkan `exifPreserved: true` tanpa pernah melihat byte-nya.
   * Itu klaim palsu (file non-JPEG tidak punya EXIF) dan bikin peringatan
   * "foto ini akan ditolak" di SelfieCapture tidak muncul di HP yang
   * mengirim file bertipe kosong. Sekarang semua file dibaca dulu, lalu
   * keputusan EXIF-nya diambil dari byte asli. */
  let originalBytes: Uint8Array;
  try {
    originalBytes = new Uint8Array(await input.arrayBuffer());
  } catch {
    return {
      file: input,
      originalSize,
      compressedSize: originalSize,
      exifPreserved: false,
    };
  }

  // Extract EXIF dari original (kalau JPEG).
  const app1 = extractExifApp1(originalBytes);

  // Kalau original sudah kecil + EXIF ada, skip compress.
  if (originalSize <= maxBytes) {
    return {
      file: input,
      originalSize,
      compressedSize: originalSize,
      exifPreserved: app1 !== null,
    };
  }

  // Load image untuk re-encode via canvas.
  const objectUrl = URL.createObjectURL(input);
  let img: HTMLImageElement;
  try {
    img = await loadImage(objectUrl);
  } catch {
    URL.revokeObjectURL(objectUrl);
    // Defensive: kalau gagal load (corrupt file?), kasih balik original
    // — biar server yang reject dengan pesan lebih jelas.
    return {
      file: input,
      originalSize,
      compressedSize: originalSize,
      exifPreserved: false,
    };
  }
  URL.revokeObjectURL(objectUrl);

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      file: input,
      originalSize,
      compressedSize: originalSize,
      exifPreserved: false,
    };
  }
  // Avoid black background — fill white (selfie biasanya gak tembus).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // Iteratively reduce quality sampai cukup kecil.
  let quality = startQuality;
  let blob: Blob | null = null;
  let lastBlob: Blob | null = null;
  // Reserve sedikit untuk EXIF segment (typically 1-8 KB).
  const exifOverhead = app1 ? app1.length + 32 : 0;
  const targetBytes = Math.max(64 * 1024, maxBytes - exifOverhead);

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      blob = await canvasToBlob(canvas, quality);
    } catch {
      break;
    }
    lastBlob = blob;
    if (blob.size <= targetBytes) break;
    if (quality <= minQuality) break;
    quality = Math.max(minQuality, quality - 0.12);
  }

  const finalBlob = lastBlob ?? blob;
  if (!finalBlob) {
    return {
      file: input,
      originalSize,
      compressedSize: originalSize,
      exifPreserved: false,
    };
  }

  let outBytes: Uint8Array = new Uint8Array(await finalBlob.arrayBuffer());
  let exifPreserved = false;
  if (app1) {
    try {
      // Drop existing APP1 from canvas-encoded output (canvas typically
      // gak tulis APP1 EXIF tapi some browser nulis APP0/APP14). Cuma
      // inject — duplikat APP1 di-handle oleh parser yang ambil yang
      // pertama, jadi inject di posisi pertama works.
      outBytes = injectExifApp1(outBytes, app1);
      exifPreserved = true;
    } catch {
      // fall back ke output tanpa EXIF — biar server yg reject jelas.
    }
  }

  // Copy ke ArrayBuffer baru supaya tipe File constructor strict checks
  // di TypeScript 5.7 (ArrayBufferView<ArrayBuffer> bukan ArrayBufferLike).
  const finalBuf = new Uint8Array(outBytes.length);
  finalBuf.set(outBytes);
  const compressedFile = new File(
    [finalBuf],
    input.name.replace(/\.[^.]+$/, "") + ".compressed.jpg",
    { type: "image/jpeg", lastModified: input.lastModified },
  );

  return {
    file: compressedFile,
    originalSize,
    compressedSize: compressedFile.size,
    exifPreserved,
  };
}
