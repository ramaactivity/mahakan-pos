/**
 * Sesi AE-217 — REM ANTI-LUPA-TUTUP-SHIFT (logika murni).
 *
 * Masalah yang diobati: Mahakan pakai SATU shift bersama per outlet
 * (ux_shifts_outlet_active). Kalau kasir lupa menutup shift, besoknya TIDAK
 * ada error apa pun — staff yang login diam-diam menempel ke shift kemarin
 * dan terus berjualan di sana. Penjualan dua hari menumpuk di satu shift,
 * kas fisik tidak pernah dihitung, variance jadi ngawur, dan jurnal harian
 * melar melintasi tanggal.
 *
 * Rem-nya BERTINGKAT, bukan palang tunggal, karena 26 dari 82 shift Mahakan
 * memang sah berjalan lewat tengah malam (catatan sesi AE-193). Memaksa tutup
 * tepat pukul 00:00 akan menyerbu kasir yang sedang melayani tamu terakhir.
 *
 *   remind → toast halus, POS jalan normal
 *   soft   → popup menutupi layar, MASIH bisa ditunda kasir
 *   hard   → POS terkunci, tidak ada tombol tunda
 *
 * File ini sengaja tanpa impor apa pun (no DB, no `server-only`, no date lib)
 * supaya bisa diuji dari mana saja — pola yang sama dengan close-pure.ts.
 * Pemanggil yang bertanggung jawab mengubah instant jadi tanggal + menit WIB.
 */

export type ShiftGateLevel = "none" | "remind" | "soft" | "hard";

export type ShiftGateReason =
  /** Tidak ada yang perlu diingatkan. */
  | "none"
  /** Masih hari yang sama, tapi sudah mendekati pergantian hari. */
  | "day_ends_soon"
  /** Sudah lewat tengah malam — shift kemarin masih terbuka. */
  | "past_midnight"
  /** Sudah ganti hari dan lewat batas toleransi. */
  | "day_rolled"
  /** Shift menggantung dua hari atau lebih. Tidak ada alasan yang masuk akal. */
  | "stale_days";

export interface ShiftGateThresholds {
  /** Jam WIB "HH:mm" mulai toast pengingat halus (shift masih hari ini). */
  remindAt: string;
  /** Jam WIB "HH:mm" popup menutupi layar mulai muncul (hari sudah ganti). */
  softLockAt: string;
  /** Jam WIB "HH:mm" POS dikunci total (hari sudah ganti). */
  hardLockAt: string;
  /** Berapa kali kasir boleh menunda popup sebelum langsung dikunci. */
  maxSnoozes: number;
  /** Lama satu penundaan, dalam menit. */
  snoozeMinutes: number;
}

export const DEFAULT_SHIFT_GATE_THRESHOLDS: ShiftGateThresholds = {
  remindAt: "23:30",
  softLockAt: "00:00",
  hardLockAt: "01:00",
  maxSnoozes: 3,
  snoozeMinutes: 15,
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" → menit sejak 00:00. Mengembalikan null kalau formatnya salah. */
export function hhmmToMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = HHMM.exec(raw.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Bersihkan ambang dari outlet settings. Nilai yang tidak masuk akal DIBUANG
 * satu per satu (bukan seluruh objek), supaya satu kolom rusak tidak
 * mematikan seluruh rem.
 */
export function parseShiftGateThresholds(raw: unknown): ShiftGateThresholds {
  const src = (raw ?? {}) as Partial<Record<keyof ShiftGateThresholds, unknown>>;
  const pickTime = (v: unknown, fallback: string): string =>
    hhmmToMinutes(v) === null ? fallback : (v as string).trim();
  const pickInt = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === "number" ? Math.round(v) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const d = DEFAULT_SHIFT_GATE_THRESHOLDS;
  return {
    remindAt: pickTime(src.remindAt, d.remindAt),
    softLockAt: pickTime(src.softLockAt, d.softLockAt),
    hardLockAt: pickTime(src.hardLockAt, d.hardLockAt),
    maxSnoozes: pickInt(src.maxSnoozes, d.maxSnoozes, 0, 20),
    snoozeMinutes: pickInt(src.snoozeMinutes, d.snoozeMinutes, 1, 120),
  };
}

/** Selisih hari kalender antara dua tanggal "YYYY-MM-DD". */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export interface ShiftGateInput {
  /** Tanggal WIB "YYYY-MM-DD" saat shift dibuka. null = tidak ada shift aktif. */
  openedWibDate: string | null;
  /** Tanggal WIB "YYYY-MM-DD" hari ini menurut SERVER (jangan jam tablet). */
  todayWibDate: string;
  /** Menit sejak 00:00 WIB hari ini menurut SERVER. */
  nowWibMinutes: number;
  thresholds: ShiftGateThresholds;
}

export interface ShiftGateVerdict {
  level: ShiftGateLevel;
  reason: ShiftGateReason;
  /** 0 = shift dibuka hari ini, 1 = kemarin, dst. */
  daysStale: number;
}

/**
 * Tangga eskalasi. Satu fungsi ini melayani KEDUA rem yang diminta owner:
 * gerbang "tutup shift kemarin dulu" (hari sudah ganti → hard) dan popup
 * tengah malam (remind → soft → hard).
 */
export function computeShiftGateVerdict(input: ShiftGateInput): ShiftGateVerdict {
  const { openedWibDate, todayWibDate, nowWibMinutes, thresholds } = input;

  if (!openedWibDate) {
    return { level: "none", reason: "none", daysStale: 0 };
  }

  const daysStale = daysBetweenIso(openedWibDate, todayWibDate);

  /* Jam tablet di depan jam server (atau data basi) bisa membuat daysStale
   * negatif. Jangan pernah mengunci POS karena aritmetika yang aneh. */
  if (daysStale <= 0) {
    const remind = hhmmToMinutes(thresholds.remindAt);
    if (remind !== null && nowWibMinutes >= remind) {
      return { level: "remind", reason: "day_ends_soon", daysStale: 0 };
    }
    return { level: "none", reason: "none", daysStale: 0 };
  }

  /* Dua hari atau lebih menggantung: tidak ada skenario operasional yang
   * membenarkannya. Langsung kunci, berapa pun jamnya. */
  if (daysStale >= 2) {
    return { level: "hard", reason: "stale_days", daysStale };
  }

  const soft = hhmmToMinutes(thresholds.softLockAt) ?? 0;
  const hard =
    hhmmToMinutes(thresholds.hardLockAt) ??
    (hhmmToMinutes(DEFAULT_SHIFT_GATE_THRESHOLDS.hardLockAt) as number);

  /* Owner boleh menyetel keras langsung dari tengah malam (hard <= soft). */
  if (nowWibMinutes >= Math.max(hard, soft)) {
    return { level: "hard", reason: "day_rolled", daysStale };
  }
  if (nowWibMinutes >= soft) {
    return { level: "soft", reason: "past_midnight", daysStale };
  }
  return { level: "remind", reason: "past_midnight", daysStale };
}

export interface GateDecisionInput {
  level: ShiftGateLevel;
  /** Berapa kali kasir sudah menunda popup di sesi ini. */
  snoozeCount: number;
  /** Epoch ms sampai kapan penundaan berlaku. 0 = tidak sedang ditunda. */
  snoozeUntilMs: number;
  nowMs: number;
  maxSnoozes: number;
}

export interface GateDecision {
  /** true = popup menutupi layar dan POS tidak boleh dipakai. */
  blocking: boolean;
  /** true = tombol "ingatkan lagi nanti" boleh ditampilkan. */
  canSnooze: boolean;
}

/**
 * Penundaan HANYA berlaku untuk tingkat `soft`. Tingkat `hard` dihitung di
 * server, jadi kasir tidak bisa menunda melewati batas keras hanya dengan
 * menekan tombol berulang kali atau memuat ulang halaman.
 */
export function resolveGateDecision(input: GateDecisionInput): GateDecision {
  if (input.level === "hard") return { blocking: true, canSnooze: false };
  if (input.level !== "soft") return { blocking: false, canSnooze: false };
  const snoozed = input.snoozeUntilMs > input.nowMs;
  return {
    blocking: !snoozed,
    canSnooze: input.snoozeCount < input.maxSnoozes,
  };
}

/**
 * Apakah penutupan shift ini berhak menerbitkan izin rollover?
 *
 * Ya kalau shift melewati pergantian hari kalender WIB — malam seperti itu
 * memakan dua siklus shift, dan tanpa izin tambahan aturan "1× shift per hari
 * per user" akan mengunci kasir dari shift berikutnya di hari yang sama.
 */
export function shouldIssueRolloverGrant(
  openedWibDate: string,
  closedWibDate: string,
): boolean {
  return openedWibDate !== closedWibDate;
}
