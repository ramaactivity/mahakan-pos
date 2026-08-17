/**
 * Sesi AE-200 — penanda perangkat untuk absensi mobile.
 *
 * Kenapa ada: owner melaporkan absen staff "kadang terdeteksi sebagai HP
 * lain", tapi sistem absensi sama sekali tidak pernah mencatat perangkat —
 * jadi laporan itu tidak bisa dibuktikan atau dibantah. Sekarang setiap
 * clock-in/out membawa penanda ringan yang masuk ke audit log, supaya
 * pertanyaan "ini HP yang sama atau bukan?" bisa dijawab dari data.
 *
 * Ini BUKAN alat keamanan dan sengaja tidak dipakai untuk memblokir apa
 * pun: id-nya cuma angka acak di localStorage yang bisa hilang sendiri
 * (hapus data situs, mode penyamaran, ganti browser). Perlakukan sebagai
 * petunjuk, bukan bukti — dan jangan pernah jadikan syarat absen.
 *
 * Catatan penting untuk yang membaca audit: membuka halaman absen dari
 * browser berbeda di HP yang SAMA (mis. lewat aplikasi Mahakan Staff vs
 * Chrome vs browser-dalam-aplikasi WhatsApp) menghasilkan id BERBEDA,
 * karena penyimpanannya terpisah per browser. Jadi id yang berubah TIDAK
 * otomatis berarti ganti HP — cek juga ringkasan `ua`-nya.
 */

const STORAGE_KEY = "mhkn_absen_device_id";

export interface DeviceHint {
  /** Id acak stabil per browser. "-" kalau storage tidak bisa dipakai. */
  id: string;
  /** Ringkasan platform + browser, bukan user-agent mentah. */
  ua: string;
  /** true = dijalankan sebagai aplikasi terpasang (PWA standalone). */
  standalone: boolean;
}

function readOrCreateId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[a-z0-9]{8,32}$/.test(existing)) return existing;
    const fresh = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    /* Private mode / storage diblokir — absen tetap harus jalan. */
    return "-";
  }
}

/** Ringkasan user-agent yang cukup untuk membedakan HP, tanpa menyalin
 *  string UA panjang ke audit log. */
function summarizeUserAgent(ua: string): string {
  const platform =
    /iPhone|iPad|iPod/.test(ua)
      ? `iOS ${(/OS (\d+[_\d]*)/.exec(ua)?.[1] ?? "?").replace(/_/g, ".")}`
      : /Android/.test(ua)
        ? `Android ${/Android (\d+(?:\.\d+)?)/.exec(ua)?.[1] ?? "?"}`
        : "Lainnya";

  const browser = /\b(FBAN|FBAV)\b/.test(ua)
    ? "Facebook in-app"
    : /Instagram/.test(ua)
      ? "Instagram in-app"
      : /\bLine\//.test(ua)
        ? "LINE in-app"
        : /WhatsApp/.test(ua)
          ? "WhatsApp in-app"
          : /SamsungBrowser/.test(ua)
            ? "Samsung Internet"
            : /EdgA?\//.test(ua)
              ? "Edge"
              : /CriOS|Chrome/.test(ua)
                ? "Chrome"
                : /FxiOS|Firefox/.test(ua)
                  ? "Firefox"
                  : /Safari/.test(ua)
                    ? "Safari"
                    : "Browser lain";

  const model = /Android/.test(ua)
    ? (/;\s*([^;)]+?)\s*(?:Build\/|\))/.exec(ua)?.[1] ?? "").slice(0, 32)
    : "";

  return [platform, browser, model].filter(Boolean).join(" · ");
}

/** Kumpulkan penanda perangkat. Aman dipanggil di browser mana pun —
 *  kegagalan apa pun menghasilkan nilai netral, tidak pernah melempar. */
export function collectDeviceHint(): DeviceHint {
  if (typeof window === "undefined") {
    return { id: "-", ua: "server", standalone: false };
  }
  let standalone = false;
  try {
    standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      /* iOS Safari lama tidak punya display-mode. */
      (window.navigator as { standalone?: boolean }).standalone === true;
  } catch {
    standalone = false;
  }
  return {
    id: readOrCreateId(),
    ua: summarizeUserAgent(window.navigator.userAgent ?? ""),
    standalone,
  };
}
