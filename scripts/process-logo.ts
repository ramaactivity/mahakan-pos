/**
 * Convert Logo_Mahakan_Hijau.png (JPEG with black background) to a true
 * PNG with alpha — chroma-keys out the black background while preserving
 * the green logo with anti-aliased edges.
 *
 * Run once: `npx tsx scripts/process-logo.ts`
 */

import sharp from "sharp";
import path from "node:path";

const SRC = path.join(process.cwd(), "public/assets/logo/Logo_Mahakan_Hijau.png");
const DST = path.join(process.cwd(), "public/assets/logo/Logo_Mahakan_Hijau_Transparent.png");

// Luma thresholds for chroma-key
const LUMA_LOW = 25;   // below this = fully transparent (pure black bg)
const LUMA_HIGH = 70;  // above this = fully opaque (logo content)

async function main() {
  const img = sharp(SRC);
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image size");

  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8ClampedArray(data);
  const channels = info.channels;
  let cleared = 0;
  let total = 0;

  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;

    let alpha: number;
    if (luma <= LUMA_LOW) {
      alpha = 0;
    } else if (luma >= LUMA_HIGH) {
      alpha = 255;
    } else {
      alpha = Math.round(((luma - LUMA_LOW) / (LUMA_HIGH - LUMA_LOW)) * 255);
    }

    pixels[i + 3] = alpha;
    if (alpha === 0) cleared++;
    total++;
  }

  await sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(DST);

  const pct = ((cleared / total) * 100).toFixed(1);
  console.log(`✓ Wrote ${DST}`);
  console.log(`  ${cleared}/${total} pixels (${pct}%) made transparent`);
  console.log(`  Output dimensions: ${info.width}x${info.height}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
