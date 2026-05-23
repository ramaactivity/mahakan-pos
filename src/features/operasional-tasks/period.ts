/**
 * Sesi AE-131 — Period key helpers untuk Operasional Checklist.
 *
 * Daily, Weekly, Monthly checklist memakai 1 string sebagai bucket period:
 *   - daily   "YYYY-MM-DD"   (WIB)
 *   - weekly  "YYYY-Www"      (ISO week, Mon-anchored)
 *   - monthly "YYYY-MM"
 *
 * Semua perhitungan TZ-anchored ke Asia/Jakarta supaya tidak ada drift saat
 * server UTC vs cron Vercel di-trigger pas pergantian hari WIB.
 */

import type {
  OperasionalFrequency,
  OperasionalSection,
} from "@/db/schema/operasional_tasks";

const WIB_OFFSET_MIN = 7 * 60;

/** Returns Date adjusted ke "wall clock WIB" tapi tetap di-construct dari epoch. */
function toWibParts(date: Date): {
  year: number;
  month: number; // 1-12
  day: number;
  weekdayMon0: number; // 0 = Mon ... 6 = Sun
} {
  const utc = date.getTime();
  const wibMs = utc + WIB_OFFSET_MIN * 60 * 1000;
  const wibDate = new Date(wibMs);
  const year = wibDate.getUTCFullYear();
  const month = wibDate.getUTCMonth() + 1;
  const day = wibDate.getUTCDate();
  // getUTCDay: 0 = Sun, 1 = Mon ... 6 = Sat. Convert ke 0 = Mon, 6 = Sun.
  const weekdayMon0 = (wibDate.getUTCDay() + 6) % 7;
  return { year, month, day, weekdayMon0 };
}

export function dailyKey(date: Date = new Date()): string {
  const { year, month, day } = toWibParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function monthlyKey(date: Date = new Date()): string {
  const { year, month } = toWibParts(date);
  return `${year}-${pad2(month)}`;
}

/**
 * ISO 8601 week-numbering: Mon = week start, week 1 = the week containing
 * the year's first Thursday. Standard untuk kalender ops/HR Indonesia.
 */
export function weeklyKey(date: Date = new Date()): string {
  /* Anchor ke WIB-noon dari date supaya UTC ↔ WIB tidak misalign saat
   * date di-pass adalah midnight UTC. */
  const utc = date.getTime();
  const wibMs = utc + WIB_OFFSET_MIN * 60 * 1000;
  const d = new Date(wibMs);
  /* Ambil ISO week: ge ke Kamis pada minggu yang sama. */
  // Hari saat ini di week (Mon=1..Sun=7)
  const dayNum = ((d.getUTCDay() + 6) % 7) + 1;
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + (4 - dayNum));
  const isoYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Day = ((new Date(jan4).getUTCDay() + 6) % 7) + 1;
  const week1Monday = jan4 - (jan4Day - 1) * 86_400_000;
  /* Anchor diff antar Thursday (week-of-current vs week-1-Thursday)
   * supaya hasilnya selalu integer × 7 days saat dibagi 7. */
  const week1Thursday = week1Monday + 3 * 86_400_000;
  const weekNum =
    Math.round((thursday.getTime() - week1Thursday) / (7 * 86_400_000)) + 1;
  return `${isoYear}-W${pad2(weekNum)}`;
}

export function currentPeriodKey(
  frequency: OperasionalFrequency,
  date: Date = new Date(),
): string {
  if (frequency === "daily") return dailyKey(date);
  if (frequency === "weekly") return weeklyKey(date);
  return monthlyKey(date);
}

/**
 * Format period key untuk display di UI / WA message.
 * Daily: "Senin, 23 Mei 2026"
 * Weekly: "Minggu 21, 2026 (19–25 Mei)"
 * Monthly: "Mei 2026"
 */
export function formatPeriodLabel(
  frequency: OperasionalFrequency,
  key: string,
): string {
  if (frequency === "daily") return formatDailyLabel(key);
  if (frequency === "weekly") return formatWeeklyLabel(key);
  return formatMonthlyLabel(key);
}

function formatDailyLabel(key: string): string {
  // key = "YYYY-MM-DD"
  const [y, m, d] = key.split("-").map((n) => Number(n));
  if (!y || !m || !d) return key;
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayName = INDONESIAN_DAYS[(date.getUTCDay() + 6) % 7];
  const monthName = INDONESIAN_MONTHS[m - 1];
  return `${dayName}, ${d} ${monthName} ${y}`;
}

function formatWeeklyLabel(key: string): string {
  // key = "YYYY-Www"
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return key;
  const year = Number(match[1]);
  const week = Number(match[2]);
  /* Find Monday of ISO week */
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = ((new Date(jan4).getUTCDay() + 6) % 7) + 1;
  const week1MondayMs = jan4 - (jan4Day - 1) * 86_400_000;
  const mondayMs = week1MondayMs + (week - 1) * 7 * 86_400_000;
  const monday = new Date(mondayMs);
  const sunday = new Date(mondayMs + 6 * 86_400_000);

  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth();
  const left = `${monday.getUTCDate()}${
    sameMonth ? "" : ` ${INDONESIAN_MONTHS_SHORT[monday.getUTCMonth()]}`
  }`;
  const right = `${sunday.getUTCDate()} ${INDONESIAN_MONTHS_SHORT[sunday.getUTCMonth()]}`;
  return `Minggu ${week}, ${year} (${left}–${right})`;
}

function formatMonthlyLabel(key: string): string {
  // key = "YYYY-MM"
  const [y, m] = key.split("-").map((n) => Number(n));
  if (!y || !m) return key;
  return `${INDONESIAN_MONTHS[m - 1]} ${y}`;
}

const INDONESIAN_DAYS = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
];
const INDONESIAN_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const INDONESIAN_MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export const FREQUENCY_LABELS: Record<OperasionalFrequency, string> = {
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
};

export const SECTION_LABELS: Record<OperasionalSection, string> = {
  bar: "Bar",
  kitchen: "Kitchen",
  general: "Umum",
};
