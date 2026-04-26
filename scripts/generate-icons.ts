/**
 * Generate PWA icons (Android Chrome + Apple touch) from the
 * transparent Mahakan green logo.
 *
 * Outputs (all in `public/`):
 *   icon-192.png            — 192x192, transparent bg, ~90% canvas
 *   icon-512.png            — 512x512, transparent bg, ~90% canvas
 *   icon-maskable-512.png   — 512x512, sage-50 solid bg, ~70% canvas (Android safe zone)
 *   apple-touch-icon.png    — 180x180, sage-50 solid bg, ~80% canvas
 *
 * Run once: `npx tsx scripts/generate-icons.ts`
 */

import sharp from "sharp";
import path from "node:path";

const SRC = path.join(
  process.cwd(),
  "public/assets/logo/Logo_Mahakan_Hijau_Transparent.png",
);
const OUT_DIR = path.join(process.cwd(), "public");

// Sage-50 from globals.css (--color-mahakan-green-50)
const SAGE_50 = { r: 0xf2, g: 0xf6, b: 0xf4, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

type IconSpec = {
  filename: string;
  size: number;
  fillRatio: number; // logo size as fraction of canvas
  bg: typeof SAGE_50;
};

const ICONS: IconSpec[] = [
  { filename: "icon-192.png", size: 192, fillRatio: 0.9, bg: TRANSPARENT },
  { filename: "icon-512.png", size: 512, fillRatio: 0.9, bg: TRANSPARENT },
  { filename: "icon-maskable-512.png", size: 512, fillRatio: 0.7, bg: SAGE_50 },
  { filename: "apple-touch-icon.png", size: 180, fillRatio: 0.8, bg: SAGE_50 },
];

async function makeIcon(spec: IconSpec) {
  const dst = path.join(OUT_DIR, spec.filename);
  const logoBox = Math.round(spec.size * spec.fillRatio);

  // Resize source preserving aspect ratio so the longest side = logoBox
  const resized = await sharp(SRC)
    .resize({
      width: logoBox,
      height: logoBox,
      fit: "inside",
      background: TRANSPARENT,
    })
    .toBuffer();

  // Compose onto a square canvas with the chosen background
  await sharp({
    create: {
      width: spec.size,
      height: spec.size,
      channels: 4,
      background: spec.bg,
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(dst);

  console.log(`✓ ${spec.filename} (${spec.size}x${spec.size}, fill ${Math.round(spec.fillRatio * 100)}%)`);
}

async function main() {
  for (const spec of ICONS) {
    await makeIcon(spec);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
