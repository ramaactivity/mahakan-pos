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

/**
 * Format "berapa lama dari sekarang" jadi bahasa manusia. Optimized untuk
 * pending queue cards yang sebelumnya pakai raw menit besar (mis. "8916m").
 *
 * Contoh (dengan now=Senin 15:00):
 *   30 detik lalu      → "baru saja"
 *   8 menit lalu       → "8 menit lalu"
 *   3 jam lalu         → "3 jam lalu"
 *   23 jam lalu        → "kemarin 16:00"
 *   2 hari lalu        → "Sabtu 15:00"
 *   8 hari lalu        → "Minggu lalu 15:00"
 *   30 hari+ lalu      → "22/04/2026 15:00"
 *
 * @param past Date di masa lalu (requestedAt, dsb).
 * @param nowMs Milliseconds clock dari parent (untuk testable + tick).
 */
export function formatTimeAgoFriendly(
  past: Date | string,
  nowMs: number = Date.now(),
): string {
  const d = typeof past === "string" ? new Date(past) : past;
  const diffMs = nowMs - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;

  // Compare calendar day di WIB supaya "kemarin" tepat berdasarkan tanggal,
  // bukan strict 24 jam window (pengajuan kemarin jam 16:00 lebih jelas dari
  // "23 jam lalu" walaupun belum genap 24 jam).
  const wibFmt = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const nowYmd = wibFmt.format(new Date(nowMs));
  const pastYmd = wibFmt.format(d);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const yesterdayYmd = wibFmt.format(new Date(nowMs - oneDayMs));

  const timeStr = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  // Hari yang sama → tampilkan jam jam relatif ("X jam lalu") karena masih
  // intuitif.
  if (pastYmd === nowYmd) {
    const diffHour = Math.floor(diffMin / 60);
    return `${diffHour} jam lalu`;
  }
  if (pastYmd === yesterdayYmd) return `kemarin ${timeStr}`;

  const diffDay = Math.floor(diffMs / oneDayMs);
  if (diffDay < 7) {
    const dayName = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
    }).format(d);
    return `${dayName} ${timeStr}`;
  }
  if (diffDay < 14) {
    const dayName = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
    }).format(d);
    return `${dayName} lalu ${timeStr}`;
  }
  // >= 2 minggu: tanggal absolut DD/MM HH:mm; >= 1 tahun include year.
  if (nowYmd.slice(-4) !== pastYmd.slice(-4)) {
    const fullDate = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
    return `${fullDate} ${timeStr}`;
  }
  const dateStr = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
  return `${dateStr} ${timeStr}`;
}
