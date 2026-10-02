import { describe, expect, it } from "vitest";
import {
  amountFromMinutes,
  formatHours,
  resolveHourlyRates,
} from "@/features/payroll/hourly-rate-pure";

describe("resolveHourlyRates", () => {
  it("pakai tarif per jam kalau sudah diisi", () => {
    expect(resolveHourlyRates({ overtimePerHour: 15_000, latePerHour: 6_000 }))
      .toEqual({ overtimePerHour: 15_000, latePerHour: 6_000 });
  });

  it("tarif lama per menit dinaikkan x60, bukan mendadak jadi nol", () => {
    // Outlet yang dulu set Rp 250/menit harus tetap membayar Rp 15.000/jam.
    expect(resolveHourlyRates({ overtimePerMinute: 250, latePerMinute: 100 }))
      .toEqual({ overtimePerHour: 15_000, latePerHour: 6_000 });
  });

  it("tarif baru menang atas tarif lama", () => {
    expect(
      resolveHourlyRates({ overtimePerHour: 20_000, overtimePerMinute: 250 })
        .overtimePerHour,
    ).toBe(20_000);
  });

  it("kosong / nol / rusak = 0 (tidak auto-isi)", () => {
    expect(resolveHourlyRates(null)).toEqual({ overtimePerHour: 0, latePerHour: 0 });
    expect(resolveHourlyRates({ overtimePerHour: 0, overtimePerMinute: 0 }).overtimePerHour).toBe(0);
    expect(resolveHourlyRates({ overtimePerHour: Number.NaN }).overtimePerHour).toBe(0);
  });
});

describe("amountFromMinutes", () => {
  it("menit utuh", () => {
    expect(amountFromMinutes(60, 15_000)).toBe(15_000);
    expect(amountFromMinutes(90, 15_000)).toBe(22_500);
  });

  it("membagi SEKALI di akhir — tarif yang tidak habis dibagi 60 tetap tepat", () => {
    // Rp 10.000/jam = Rp 166,67/menit. Kalau tarifnya dibulatkan dulu jadi
    // 167, 8 jam lembur jadi Rp 80.160 — meleset Rp 160.
    expect(amountFromMinutes(480, 10_000)).toBe(80_000);
  });

  it("menit nol / minus / tarif nol = 0", () => {
    expect(amountFromMinutes(0, 15_000)).toBe(0);
    expect(amountFromMinutes(-30, 15_000)).toBe(0);
    expect(amountFromMinutes(120, 0)).toBe(0);
  });
});

describe("formatHours", () => {
  it("di bawah 1 jam tetap ditulis menit", () => {
    expect(formatHours(45)).toBe("45 menit");
  });

  it("jam dengan satu desimal, koma Indonesia", () => {
    expect(formatHours(60)).toBe("1 jam");
    expect(formatHours(425)).toBe("7,1 jam");
  });

  it("kosong = 0 jam", () => {
    expect(formatHours(null)).toBe("0 jam");
    expect(formatHours(0)).toBe("0 jam");
  });
});
