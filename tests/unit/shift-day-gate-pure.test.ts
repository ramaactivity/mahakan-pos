import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIFT_GATE_THRESHOLDS,
  computeShiftGateVerdict,
  daysBetweenIso,
  hhmmToMinutes,
  parseShiftGateThresholds,
  resolveGateDecision,
  shouldIssueRolloverGrant,
  type ShiftGateThresholds,
} from "@/features/shifts/day-gate-pure";

const T = DEFAULT_SHIFT_GATE_THRESHOLDS;

const at = (hh: number, mm = 0) => hh * 60 + mm;

const verdict = (
  openedWibDate: string | null,
  todayWibDate: string,
  nowWibMinutes: number,
  thresholds: ShiftGateThresholds = T,
) =>
  computeShiftGateVerdict({
    openedWibDate,
    todayWibDate,
    nowWibMinutes,
    thresholds,
  });

describe("hhmmToMinutes", () => {
  it("parses jam WIB yang sah", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("23:30")).toBe(1410);
    expect(hhmmToMinutes(" 01:00 ")).toBe(60);
  });

  it("tolak format ngawur", () => {
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("7:00")).toBeNull();
    expect(hhmmToMinutes("abc")).toBeNull();
    expect(hhmmToMinutes(undefined)).toBeNull();
    expect(hhmmToMinutes(1410)).toBeNull();
  });
});

describe("parseShiftGateThresholds", () => {
  it("pakai default kalau settings kosong", () => {
    expect(parseShiftGateThresholds(undefined)).toEqual(T);
    expect(parseShiftGateThresholds({})).toEqual(T);
  });

  it("buang HANYA kolom yang rusak, bukan seluruh objek", () => {
    const parsed = parseShiftGateThresholds({
      remindAt: "22:00",
      softLockAt: "bukan jam",
      maxSnoozes: 99,
      snoozeMinutes: 20,
    });
    expect(parsed.remindAt).toBe("22:00");
    expect(parsed.softLockAt).toBe(T.softLockAt);
    expect(parsed.maxSnoozes).toBe(T.maxSnoozes);
    expect(parsed.snoozeMinutes).toBe(20);
  });
});

describe("daysBetweenIso", () => {
  it("hitung selisih hari kalender", () => {
    expect(daysBetweenIso("2026-08-22", "2026-08-23")).toBe(1);
    expect(daysBetweenIso("2026-08-21", "2026-08-23")).toBe(2);
    expect(daysBetweenIso("2026-08-23", "2026-08-23")).toBe(0);
  });

  it("lintas bulan + tahun", () => {
    expect(daysBetweenIso("2026-07-31", "2026-08-01")).toBe(1);
    expect(daysBetweenIso("2025-12-31", "2026-01-01")).toBe(1);
  });
});

describe("computeShiftGateVerdict — tidak ada shift", () => {
  it("diam saja kalau tidak ada shift terbuka", () => {
    expect(verdict(null, "2026-08-23", at(23, 45))).toEqual({
      level: "none",
      reason: "none",
      daysStale: 0,
    });
  });
});

describe("computeShiftGateVerdict — shift dibuka hari ini", () => {
  it("siang hari: tidak mengganggu sama sekali", () => {
    expect(verdict("2026-08-23", "2026-08-23", at(14, 0)).level).toBe("none");
    expect(verdict("2026-08-23", "2026-08-23", at(22, 0)).level).toBe("none");
  });

  it("23:30 WIB: pengingat halus, POS tetap jalan", () => {
    const v = verdict("2026-08-23", "2026-08-23", at(23, 30));
    expect(v.level).toBe("remind");
    expect(v.reason).toBe("day_ends_soon");
    expect(v.daysStale).toBe(0);
  });

  it("shift dibuka lepas tengah malam masih dianggap hari ini", () => {
    // Buka 00:10, sekarang 02:00 hari yang sama → tidak ada rem apa pun.
    expect(verdict("2026-08-23", "2026-08-23", at(2, 0)).level).toBe("none");
  });
});

describe("computeShiftGateVerdict — shift lintas tengah malam (REM 2)", () => {
  it("00:00 WIB: popup yang masih bisa ditunda", () => {
    const v = verdict("2026-08-22", "2026-08-23", at(0, 0));
    expect(v.level).toBe("soft");
    expect(v.reason).toBe("past_midnight");
    expect(v.daysStale).toBe(1);
  });

  it("00:30 WIB: masih soft — tamu terakhir belum tentu selesai", () => {
    expect(verdict("2026-08-22", "2026-08-23", at(0, 30)).level).toBe("soft");
  });

  it("01:00 WIB: dikunci, tidak ada tombol tunda", () => {
    const v = verdict("2026-08-22", "2026-08-23", at(1, 0));
    expect(v.level).toBe("hard");
    expect(v.reason).toBe("day_rolled");
  });

  it("owner boleh menyetel keras langsung dari tengah malam", () => {
    const keras: ShiftGateThresholds = {
      ...T,
      softLockAt: "00:00",
      hardLockAt: "00:00",
    };
    expect(verdict("2026-08-22", "2026-08-23", at(0, 0), keras).level).toBe(
      "hard",
    );
  });

  it("owner boleh melonggarkan sampai 02:00", () => {
    const longgar: ShiftGateThresholds = { ...T, hardLockAt: "02:00" };
    expect(verdict("2026-08-22", "2026-08-23", at(1, 30), longgar).level).toBe(
      "soft",
    );
    expect(verdict("2026-08-22", "2026-08-23", at(2, 0), longgar).level).toBe(
      "hard",
    );
  });

  it("soft mulai belakangan: sebelum itu cuma pengingat", () => {
    const geser: ShiftGateThresholds = { ...T, softLockAt: "00:30" };
    expect(verdict("2026-08-22", "2026-08-23", at(0, 10), geser).level).toBe(
      "remind",
    );
    expect(verdict("2026-08-22", "2026-08-23", at(0, 30), geser).level).toBe(
      "soft",
    );
  });
});

describe("computeShiftGateVerdict — gerbang pagi berikutnya (REM 1)", () => {
  it("login jam 10 pagi dengan shift kemarin: langsung terkunci", () => {
    const v = verdict("2026-08-22", "2026-08-23", at(10, 0));
    expect(v.level).toBe("hard");
    expect(v.reason).toBe("day_rolled");
    expect(v.daysStale).toBe(1);
  });

  it("shift Galih 21/08 dilihat tanggal 23/08: terkunci apa pun jamnya", () => {
    for (const menit of [at(0, 0), at(0, 30), at(10, 24), at(23, 59)]) {
      const v = verdict("2026-08-21", "2026-08-23", menit);
      expect(v.level).toBe("hard");
      expect(v.reason).toBe("stale_days");
      expect(v.daysStale).toBe(2);
    }
  });
});

describe("computeShiftGateVerdict — jam tablet ngawur", () => {
  it("tanggal buka di masa depan tidak boleh mengunci POS", () => {
    const v = verdict("2026-08-24", "2026-08-23", at(9, 0));
    expect(v.level).toBe("none");
    expect(v.daysStale).toBe(0);
  });
});

describe("resolveGateDecision", () => {
  const base = { snoozeCount: 0, snoozeUntilMs: 0, nowMs: 1_000, maxSnoozes: 3 };

  it("hard: mengunci dan tombol tunda hilang", () => {
    expect(resolveGateDecision({ ...base, level: "hard" })).toEqual({
      blocking: true,
      canSnooze: false,
    });
  });

  it("hard tetap mengunci walau kasir baru saja menunda", () => {
    expect(
      resolveGateDecision({
        ...base,
        level: "hard",
        snoozeUntilMs: 999_999,
      }).blocking,
    ).toBe(true);
  });

  it("soft: mengunci sampai kasir menunda", () => {
    expect(resolveGateDecision({ ...base, level: "soft" })).toEqual({
      blocking: true,
      canSnooze: true,
    });
    expect(
      resolveGateDecision({ ...base, level: "soft", snoozeUntilMs: 60_000 })
        .blocking,
    ).toBe(false);
  });

  it("soft: jatah tunda habis → popup tidak bisa ditunda lagi", () => {
    const d = resolveGateDecision({ ...base, level: "soft", snoozeCount: 3 });
    expect(d.blocking).toBe(true);
    expect(d.canSnooze).toBe(false);
  });

  it("penundaan yang sudah lewat tidak menahan popup", () => {
    expect(
      resolveGateDecision({
        ...base,
        level: "soft",
        nowMs: 120_000,
        snoozeUntilMs: 60_000,
      }).blocking,
    ).toBe(true);
  });

  it("remind & none tidak pernah memblokir", () => {
    expect(resolveGateDecision({ ...base, level: "remind" }).blocking).toBe(
      false,
    );
    expect(resolveGateDecision({ ...base, level: "none" }).blocking).toBe(false);
  });
});

describe("shouldIssueRolloverGrant — ranjau DAILY_LIMIT", () => {
  it("shift lintas tengah malam berhak atas izin siklus tambahan", () => {
    // Buka 22/08 malam, ditutup 23/08 dini hari karena rem tengah malam.
    // Tanpa izin ini, shift pagi 23/08 ditolak "1x shift per hari per user"
    // dan outlet tidak bisa berjualan sama sekali.
    expect(shouldIssueRolloverGrant("2026-08-22", "2026-08-23")).toBe(true);
  });

  it("shift nginep berhari-hari juga berhak", () => {
    expect(shouldIssueRolloverGrant("2026-08-21", "2026-08-23")).toBe(true);
  });

  it("shift yang buka dan tutup di hari sama TIDAK menambah jatah", () => {
    expect(shouldIssueRolloverGrant("2026-08-23", "2026-08-23")).toBe(false);
  });
});
