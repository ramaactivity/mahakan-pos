import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatLateness,
  formatTimeAgoFriendly,
} from "@/lib/duration";

describe("formatDuration", () => {
  it("kurang 1 menit", () => {
    expect(formatDuration(30_000)).toBe("kurang 1 menit");
  });
  it("5 menit", () => {
    expect(formatDuration(5 * 60_000)).toBe("5 menit");
  });
  it("1 jam 30 menit", () => {
    expect(formatDuration(90 * 60_000)).toBe("1 jam 30 menit");
  });
  it("1 hari", () => {
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe("1 hari");
  });
});

describe("formatLateness", () => {
  it("tepat waktu", () => {
    expect(formatLateness(0)).toBe("tepat waktu");
  });
  it("telat 15 menit", () => {
    expect(formatLateness(15)).toBe("telat 15 menit");
  });
  it("lebih awal 10 menit", () => {
    expect(formatLateness(-10)).toBe("lebih awal 10 menit");
  });
});

describe("formatTimeAgoFriendly", () => {
  // Anchor "now" = 2026-05-28 (Kamis) 15:00 WIB = 2026-05-28T08:00:00.000Z UTC
  const NOW_UTC_MS = new Date("2026-05-28T08:00:00.000Z").getTime();

  it("baru saja (<1 menit)", () => {
    const past = new Date(NOW_UTC_MS - 30_000);
    expect(formatTimeAgoFriendly(past, NOW_UTC_MS)).toBe("baru saja");
  });

  it("X menit lalu (<60 menit)", () => {
    const past = new Date(NOW_UTC_MS - 15 * 60_000);
    expect(formatTimeAgoFriendly(past, NOW_UTC_MS)).toBe("15 menit lalu");
  });

  it("X jam lalu (<24 jam, hari sama)", () => {
    // 3 jam lalu — masih hari Kamis WIB
    const past = new Date(NOW_UTC_MS - 3 * 60 * 60_000);
    expect(formatTimeAgoFriendly(past, NOW_UTC_MS)).toBe("3 jam lalu");
  });

  it("kemarin HH:mm (calendar day = today-1 WIB)", () => {
    // Rabu 2026-05-27 16:00 WIB = 2026-05-27T09:00:00Z (23 jam lalu)
    const past = new Date("2026-05-27T09:00:00.000Z");
    const result = formatTimeAgoFriendly(past, NOW_UTC_MS);
    expect(result).toMatch(/^kemarin \d{2}[.:]\d{2}/);
  });

  it("nama-hari HH:mm (2-6 hari lalu)", () => {
    // Senin 2026-05-25 14:00 WIB = 2026-05-25T07:00:00Z (3 hari lalu)
    const past = new Date("2026-05-25T07:00:00.000Z");
    const result = formatTimeAgoFriendly(past, NOW_UTC_MS);
    expect(result).toMatch(/^Senin /);
  });

  it("nama-hari lalu HH:mm (7-13 hari lalu)", () => {
    // 10 hari lalu = 2026-05-18 (Senin) 14:00 WIB
    const past = new Date("2026-05-18T07:00:00.000Z");
    const result = formatTimeAgoFriendly(past, NOW_UTC_MS);
    expect(result).toMatch(/^Senin lalu /);
  });

  it("DD/MM HH:mm (>=14 hari, dalam tahun yang sama)", () => {
    // 30 hari lalu — april 2026
    const past = new Date("2026-04-28T07:00:00.000Z");
    const result = formatTimeAgoFriendly(past, NOW_UTC_MS);
    expect(result).toMatch(/^\d{2}\/\d{2} /);
  });
});
