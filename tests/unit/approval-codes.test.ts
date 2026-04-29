import { describe, expect, it } from "vitest";
// Pull pure helpers directly from `types` to avoid the actions.ts barrel
// which connects to Postgres at module load.
import {
  DEFAULT_CODE_TTL_MS,
  FAILED_ATTEMPTS_LOCKOUT_THRESHOLD,
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
  it("TTL is 10 minutes", () => {
    expect(DEFAULT_CODE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("lockout threshold is 5 failures", () => {
    expect(FAILED_ATTEMPTS_LOCKOUT_THRESHOLD).toBe(5);
  });
});
