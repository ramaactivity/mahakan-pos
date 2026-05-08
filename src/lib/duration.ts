/**
 * Human-readable duration formatter (Bahasa Indonesia).
 *
 * Kasir + karyawan sering bingung baca durasi dalam menit besar
 * ("420 menit", "219 jam"). Helper ini convert ke format bahasa manusia
 * dengan unit terbesar yang masuk akal.
 *
 * Contoh:
 *   30_000 ms        → "kurang 1 menit"
 *   5 * 60_000       → "5 menit"
 *   90 * 60_000      → "1 jam 30 menit"
 *   420 * 60_000     → "7 jam"
 *   219 * 3_600_000  → "9 hari 3 jam"
 *   25 * 3_600_000   → "1 hari 1 jam"
 *   24 * 3_600_000   → "1 hari"
 */
export function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return "kurang 1 menit";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} menit`;

  const hour = Math.floor(min / 60);
  const restMin = min % 60;
  if (hour < 24) {
    return restMin > 0 ? `${hour} jam ${restMin} menit` : `${hour} jam`;
  }

  const day = Math.floor(hour / 24);
  const restHour = hour % 24;
  return restHour > 0 ? `${day} hari ${restHour} jam` : `${day} hari`;
}

/**
 * Format late/early difference relative to scheduled time.
 *
 * Contoh:
 *   formatLateness(15)  → "telat 15 menit"
 *   formatLateness(0)   → "tepat waktu"
 *   formatLateness(-10) → "lebih awal 10 menit"
 *   formatLateness(75)  → "telat 1 jam 15 menit"
 */
export function formatLateness(diffMinutes: number): string {
  if (diffMinutes === 0) return "tepat waktu";
  const abs = Math.abs(diffMinutes);
  const phrase = formatDuration(abs * 60_000);
  return diffMinutes > 0 ? `telat ${phrase}` : `lebih awal ${phrase}`;
}

/**
 * Format clock-in/out timestamp untuk display (HH.MM WIB).
 * Input: ISO string atau Date.
 */
export function formatClockTimeWib(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(":", ".") + " WIB";
}
