/**
 * Build a human-readable, sortable filename for Drive uploads. Pure
 * function — no DB / I/O — so it's testable + reusable across modules.
 *
 * Format:
 *   {YYYYMMDD-HHmm}_{LABEL}_{slug parts joined by `_`}_by_{Uploader}.{ext}
 *
 * Example outputs:
 *   20260504-1112_KTP_Galih-Rama-Pratama_KTP-Pribadi_by_Rama.jpg
 *   20260504-1456_NOTA_2026-05-04_by_Rama.jpg
 *   20260504-1500_STRUK_2026-05-04_by_Rama.png
 *
 * Behavior:
 * - Timestamp pakai Asia/Jakarta wall clock (Owner orientation), padded
 *   ke menit precision — bagus untuk sortir lexicographic di Drive UI.
 * - LABEL = uppercase tag (KTP, NOTA, STRUK, etc.) untuk filter cepat.
 * - slug parts: any context strings — dibersihkan, dipotong per-bagian.
 * - Uploader = nama dari session user, di-slug.
 * - ext: prefer ext dari originalName; fallback dari contentType.
 *
 * Output max ~150 chars total. Drive support sampai 255, jadi aman.
 *
 * Sesi AA hotfix #2: ganti pattern lama `{ts}_{originalName}` yang
 * pakai nama file user (kayak "WhatsApp_Image_2026-05-03_at_19.31.37.jpeg")
 * jadi nama yang self-describing dan mudah ditrack di Drive.
 */
export function buildFriendlyFilename(opts: {
  label: string;
  parts?: Array<string | null | undefined>;
  uploaderName?: string | null;
  originalName: string;
  contentType?: string;
  /** Override clock — only for tests. */
  now?: Date;
}): string {
  const ts = jakartaTimestamp(opts.now ?? new Date());
  const labelClean = slug(opts.label, 20).toUpperCase();
  const partsClean = (opts.parts ?? [])
    .map((p) => (p ? slug(p, 40) : null))
    .filter((p): p is string => p !== null && p.length > 0);
  const uploaderClean = opts.uploaderName
    ? `_by_${slug(opts.uploaderName, 24)}`
    : "";
  const ext = extractExt(opts.originalName, opts.contentType);
  const middle = partsClean.length > 0 ? `_${partsClean.join("_")}` : "";
  return `${ts}_${labelClean}${middle}${uploaderClean}.${ext}`;
}

function slug(text: string, maxLen: number): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

function jakartaTimestamp(d: Date): string {
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wib.getUTCFullYear();
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const HH = String(wib.getUTCHours()).padStart(2, "0");
  const MM = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${HH}${MM}`;
}

function extractExt(name: string, contentType?: string): string {
  const fromName = name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (contentType) {
    if (contentType === "application/pdf") return "pdf";
    if (contentType === "image/jpeg") return "jpg";
    if (contentType === "image/png") return "png";
    if (contentType === "image/webp") return "webp";
  }
  return "bin";
}
