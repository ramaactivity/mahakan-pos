import { describe, expect, it } from "vitest";
// Pull pure helpers directly from `types` to avoid the actions.ts barrel
// which connects to Postgres at module load.
import {
  DEFAULT_CODE_TTL_MS,
  FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
  computeApprovalCodeExpiry,
  generateNumericCode6,
  maskEmail,
} from "@/features/approval-codes/types";

describe("generateNumericCode6", () => {
  it("returns a 6-character string of digits only", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateNumericCode6();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(6);
    }
  });

  it("pads leading zeros (range 000000-999999)", () => {
    // Probabilistic: verify enough variation across 1000 samples that we
    // hit codes starting with 0 at least once.
    const samples = Array.from({ length: 1000 }, () => generateNumericCode6());
    const someStartsWithZero = samples.some((c) => c.startsWith("0"));
    expect(someStartsWithZero).toBe(true);
  });

  it("has reasonable variance — not all the same value", () => {
    const samples = new Set(
      Array.from({ length: 100 }, () => generateNumericCode6()),
    );
    // 100 samples from 1M space — collision probability is negligible
    // but tolerate up to 1 collision for paranoia.
    expect(samples.size).toBeGreaterThan(95);
  });
});

describe("maskEmail", () => {
  it("masks typical Gmail address", () => {
    expect(maskEmail("rama.activity98@gmail.com")).toBe("ra…8@g…il.com");
  });

  it("masks short local part minimally", () => {
    expect(maskEmail("a@gmail.com")).toBe("a@g…il.com");
    expect(maskEmail("ab@gmail.com")).toBe("ab@g…il.com");
  });

  it("masks short domain", () => {
    expect(maskEmail("foo@x.com")).toBe("fo…o@x.com");
    expect(maskEmail("foo@xy.com")).toBe("fo…o@xy.com");
  });

  it("returns input unchanged when no @ present", () => {
    expect(maskEmail("notanemail")).toBe("notanemail");
  });

  it("handles uncommon TLDs like .co.id", () => {
    // Last dot is the TLD boundary in this implementation; multi-part TLDs
    // collapse into the right slice. ".co.id" → ".id" as TLD.
    expect(maskEmail("info@mahakancoffee.co.id")).toBe("in…o@m…co.id");
  });

  it("preserves @ separator", () => {
    expect(maskEmail("rama@gmail.com")).toContain("@");
  });
});

describe("constants", () => {
  it("floor TTL is 1 hour (minimum guarantee untuk request menjelang tengah malam)", () => {
    expect(DEFAULT_CODE_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("lockout threshold is 5 failures", () => {
    expect(FAILED_ATTEMPTS_LOCKOUT_THRESHOLD).toBe(5);
  });
});

describe("computeApprovalCodeExpiry", () => {
  // Helper: 23:59:59.999 WIB di hari yang sama (UTC = 16:59:59.999 hari sama).
  function endOfDayWibUtc(jakartaYmd: string): Date {
    return new Date(`${jakartaYmd}T23:59:59.999+07:00`);
  }

  it("request siang hari → expires end-of-day WIB hari itu (10+ jam window)", () => {
    // 2026-05-28 14:00 WIB = 2026-05-28 07:00 UTC
    const now = new Date("2026-05-28T07:00:00.000Z");
    const exp = computeApprovalCodeExpiry(now);
    expect(exp.toISOString()).toBe(endOfDayWibUtc("2026-05-28").toISOString());
  });

  it("request pagi → expires end-of-day WIB hari itu", () => {
    // 2026-05-28 08:00 WIB = 2026-05-28 01:00 UTC
    const now = new Date("2026-05-28T01:00:00.000Z");
    const exp = computeApprovalCodeExpiry(now);
    expect(exp.toISOString()).toBe(endOfDayWibUtc("2026-05-28").toISOString());
  });

  it("request menjelang tengah malam → fallback ke 1 jam floor (lebih panjang dari end-of-day)", () => {
    // 2026-05-28 23:30 WIB = 2026-05-28 16:30 UTC
    // End of day = 16:59:59.999 UTC (29 menit lagi). Floor = +1 jam = 17:30 UTC.
    // Floor menang.
    const now = new Date("2026-05-28T16:30:00.000Z");
    const exp = computeApprovalCodeExpiry(now);
    const floor = new Date(now.getTime() + DEFAULT_CODE_TTL_MS);
    expect(exp.toISOString()).toBe(floor.toISOString());
  });

  it("request tepat di batas (23:00 WIB) → end-of-day masih menang (1 jam sisa = sama)", () => {
    // 2026-05-28 23:00 WIB = 2026-05-28 16:00 UTC
    // End of day = 16:59:59.999 UTC. Floor = 17:00 UTC.
    // Floor menang (lebih besar).
    const now = new Date("2026-05-28T16:00:00.000Z");
    const exp = computeApprovalCodeExpiry(now);
    const floor = new Date(now.getTime() + DEFAULT_CODE_TTL_MS);
    expect(exp.toISOString()).toBe(floor.toISOString());
  });

  it("request 22:00 WIB → end-of-day menang (sisa ~2 jam)", () => {
    // 2026-05-28 22:00 WIB = 2026-05-28 15:00 UTC
    // End of day = 16:59:59.999 UTC. Floor = 16:00 UTC.
    // End of day menang.
    const now = new Date("2026-05-28T15:00:00.000Z");
    const exp = computeApprovalCodeExpiry(now);
    expect(exp.toISOString()).toBe(endOfDayWibUtc("2026-05-28").toISOString());
  });

  it("default arg = new Date()", () => {
    // Smoke test — function callable tanpa argumen.
    const exp = computeApprovalCodeExpiry();
    expect(exp.getTime()).toBeGreaterThan(Date.now());
  });
});
