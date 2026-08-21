/**
 * Sesi AE-213 — satu jalur pelaporan error client.
 *
 * Dulu hanya `(admin)/error.tsx` yang melapor, dan laporannya cuma mendarat
 * di Vercel function logs — yang tidak bisa dibuka owner. Kalau owner sudah
 * menutup layar errornya, jejaknya hilang sama sekali dan diagnosa mulai
 * dari nol ("errornya apa?" → "sudah saya tutup").
 *
 * Jadi tiap error sekarang: (1) dikirim ke server seperti biasa, dan (2)
 * disimpan ringkas di localStorage supaya bisa disalin owner kapan pun,
 * lewat tombol "Salin detail". Tiga terakhir saja — ini alat bantu lapor,
 * bukan arsip.
 */

const STORAGE_KEY = "mahakan.client-errors.v1";
const MAX_STORED = 3;

export interface ClientErrorReport {
  message: string;
  name?: string;
  digest?: string;
  stack?: string;
  componentStack?: string;
  /** Bagian aplikasi tempat error muncul, mis. "admin:accounting". */
  scope?: string;
  path?: string;
  at?: string;
  userAgent?: string;
}

export function reportClientError(input: ClientErrorReport): void {
  if (typeof window === "undefined") return;

  const report: ClientErrorReport = {
    ...input,
    at: input.at ?? new Date().toISOString(),
    path: input.path ?? window.location.pathname + window.location.hash,
    userAgent: input.userAgent ?? navigator.userAgent,
  };

  /* console dulu — kalau POST/localStorage gagal, jejaknya tetap ada. */
  console.error("[client-error]", report);

  try {
    const stored = readRecentClientErrors();
    stored.unshift(report);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(stored.slice(0, MAX_STORED)),
    );
  } catch {
    /* localStorage penuh / private mode — abaikan, bukan alasan gagal. */
  }

  void fetch("/api/internal/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {
    /* best-effort: offline atau endpoint tidak ada. */
  });
}

export function readRecentClientErrors(): ClientErrorReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClientErrorReport[]) : [];
  } catch {
    return [];
  }
}

/** Teks siap-kirim ke dev (WhatsApp/email) — bukan JSON mentah. */
export function formatClientErrorForCopy(report: ClientErrorReport): string {
  const lines = [
    `Error: ${report.message}`,
    report.name ? `Jenis: ${report.name}` : null,
    report.scope ? `Bagian: ${report.scope}` : null,
    report.path ? `Halaman: ${report.path}` : null,
    report.digest ? `Ref: ${report.digest}` : null,
    report.at ? `Waktu: ${report.at}` : null,
    report.userAgent ? `Perangkat: ${report.userAgent}` : null,
    report.stack ? `\nStack:\n${report.stack}` : null,
    report.componentStack ? `\nKomponen:\n${report.componentStack}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

export async function copyClientErrorToClipboard(
  report: ClientErrorReport,
): Promise<boolean> {
  const text = formatClientErrorForCopy(report);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Fallback: browser lama / tanpa izin clipboard. */
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Sesi AE-63 phase7 (dipindah ke sini sesi AE-213) — deteksi error chunk
 * Next.js: browser masih memegang HTML lama yang menunjuk chunk hash yang
 * sudah hilang setelah deploy → 404 → ChunkLoadError. Bukan bug aplikasi,
 * cukup muat ulang.
 *
 * Dipakai dua penahan sekaligus: `(admin)/error.tsx` dan penahan per-menu
 * (`SectionErrorBoundary`) — section di-lazy-load, jadi chunk yang basi
 * meledak DI DALAM penahan per-menu dan tidak pernah sampai ke penahan
 * route.
 */
export function isChunkLoadError(error: Error): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.name === "ChunkLoadError" ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("error loading dynamically imported module")
  );
}
