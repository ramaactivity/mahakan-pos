/**
 * Sesi AE-124 — Notification category taxonomy + per-user defaults.
 *
 * Pure module (no server-only). Bisa di-import dari client untuk
 * render category list di Settings UI tanpa server roundtrip.
 */

export const NOTIFICATION_CATEGORIES = [
  "attendance",
  "payroll",
  "shift",
  "inventory",
  "finance_close",
  "finance_payment",
  "marketing",
  "system",
  /* Sesi AE-131 — Operasional checklist reminders (daily evening,
   * weekly Sunday, monthly day-28). */
  "operasional",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface CategoryMeta {
  key: NotificationCategory;
  label: string;
  description: string;
  /** Untuk grouping di UI. */
  group: "operasi" | "keuangan" | "lainnya";
}

export const CATEGORY_META: Record<NotificationCategory, CategoryMeta> = {
  attendance: {
    key: "attendance",
    label: "Absensi",
    description:
      "Karyawan telat, lupa clock-in/out, reminder jadwal masuk.",
    group: "operasi",
  },
  payroll: {
    key: "payroll",
    label: "Payroll",
    description:
      "Slip gaji terkirim, payroll periode siap finalize, advance request.",
    group: "operasi",
  },
  shift: {
    key: "shift",
    label: "Shift Kasir",
    description:
      "Shift belum buka/tutup, balance variance, petty cash issue.",
    group: "keuangan",
  },
  inventory: {
    key: "inventory",
    label: "Inventory",
    description:
      "PR baru, stock rendah, opname schedule, TOP supplier jatuh tempo, perubahan harga.",
    group: "operasi",
  },
  finance_close: {
    key: "finance_close",
    label: "Tutup Bulanan & Laporan",
    description:
      "Tutup periode bulanan, journal error, rekonsiliasi aggregator, laporan siap kirim.",
    group: "keuangan",
  },
  finance_payment: {
    key: "finance_payment",
    label: "Setoran & Pembayaran",
    description:
      "Setoran tunai baru menunggu verifikasi, reminder bayar recurring (listrik/air/sewa/gaji).",
    group: "keuangan",
  },
  marketing: {
    key: "marketing",
    label: "Marketing",
    description: "Promo expired, customer milestone, performa kampanye.",
    group: "lainnya",
  },
  system: {
    key: "system",
    label: "Sistem",
    description:
      "Error aplikasi, aktivitas mencurigakan, deployment, security alert.",
    group: "lainnya",
  },
  operasional: {
    key: "operasional",
    label: "Checklist Operasional",
    description:
      "Reminder ceklist harian/mingguan/bulanan (kebersihan, prep, opname).",
    group: "operasi",
  },
};

/**
 * Default categories per user berdasarkan email (mapping Mahakan team)
 * atau fallback ke role. Dipakai saat user belum punya row
 * user_notification_subscriptions — anggap default sesuai mapping ini.
 *
 * Update mapping kalau ada user baru / change responsibility.
 */
const EMAIL_DEFAULTS: Record<string, NotificationCategory[]> = {
  /* Bayu — HR */
  "bayukurnia95@gmail.com": ["attendance", "payroll", "shift"],
  /* Nabila/INAB — Finance */
  "nabilaintan165@gmail.com": [
    "shift",
    "finance_close",
    "finance_payment",
  ],
  /* Cacil/Anisa — Inventory */
  "anisaamaliya6@gmail.com": ["inventory"],
  /* Sekal — CEO (finance + report visibility) */
  "sekalmaulidan33@gmail.com": ["finance_close", "finance_payment"],
  /* Rama — Marketing + Dev (system) + setoran (finance_payment) */
  "rama.activity98@gmail.com": [
    "marketing",
    "system",
    "finance_payment",
    "finance_close",
  ],
  /* pos.mahakan@gmail.com — generic owner, subscribe semua */
  "pos.mahakan@gmail.com": [
    "attendance",
    "payroll",
    "shift",
    "inventory",
    "finance_close",
    "finance_payment",
    "marketing",
    "system",
    "operasional",
  ],
};

const ROLE_DEFAULTS: Record<string, NotificationCategory[]> = {
  owner: ["finance_close", "finance_payment", "system", "operasional"],
  manager: ["shift", "inventory", "attendance", "operasional"],
  supervisor: ["shift", "inventory", "operasional"],
  staff: ["payroll", "attendance", "operasional"],
};

/**
 * Resolve default subscribed categories untuk user. Email override role.
 * Email lowercase-compared untuk safety.
 */
export function getDefaultCategoriesForUser(
  email: string | null,
  role: string,
): Set<NotificationCategory> {
  if (email) {
    const fromEmail = EMAIL_DEFAULTS[email.toLowerCase()];
    if (fromEmail) return new Set(fromEmail);
  }
  const fromRole = ROLE_DEFAULTS[role] ?? [];
  return new Set(fromRole);
}

/**
 * Categories yang BYPASS quiet hours (urgent — security/system).
 * User tetap di-notify meskipun di quiet window.
 */
export const URGENT_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
  "system",
]);

/**
 * Format minutes-of-day (0-1439) jadi HH:MM string untuk UI display.
 */
export function formatMinutesOfDay(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parse HH:MM string ke minutes-of-day. Return null kalau invalid.
 */
export function parseMinutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

/**
 * Apakah waktu `nowMin` (minutes-of-day di TZ user) berada DI DALAM quiet
 * window (start, end)? Handle wrap-around (mis. 22:00-06:00).
 */
export function isInQuietWindow(
  nowMin: number,
  startMin: number,
  endMin: number,
): boolean {
  if (startMin === endMin) return false; // disabled
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  /* Wrap-around: night window. */
  return nowMin >= startMin || nowMin < endMin;
}
