import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRateLimitForTests,
  checkRateLimit,
  clearRateLimit,
  extractClientIp,
  recordFailedAttempt,
  type RateLimitConfig,
} from "@/lib/rate-limit";

const CONFIG: RateLimitConfig = { maxAttempts: 3, windowMs: 1000 };

beforeEach(() => {
  __resetRateLimitForTests();
});

describe("rate-limit — checkRateLimit", () => {
  it("fresh key tidak locked", () => {
    const r = checkRateLimit("test", CONFIG, 1000);
    expect(r.locked).toBe(false);
    expect(r.remaining).toBe(3);
  });

  it("under threshold tidak locked", () => {
    recordFailedAttempt("test", CONFIG, 1000);
    recordFailedAttempt("test", CONFIG, 1100);
    const r = checkRateLimit("test", CONFIG, 1200);
    expect(r.locked).toBe(false);
    expect(r.remaining).toBe(1);
  });

  it("at threshold = locked", () => {
    recordFailedAttempt("test", CONFIG, 1000);
    recordFailedAttempt("test", CONFIG, 1100);
    recordFailedAttempt("test", CONFIG, 1200);
    const r = checkRateLimit("test", CONFIG, 1300);
    expect(r.locked).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("over threshold tetap locked", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("test", CONFIG, 1000 + i * 10);
    }
    const r = checkRateLimit("test", CONFIG, 1100);
    expect(r.locked).toBe(true);
    expect(r.remaining).toBe(0);
  });
});

describe("rate-limit — recordFailedAttempt", () => {
  it("first attempt — bucket created dengan count 1", () => {
    const r = recordFailedAttempt("test", CONFIG, 1000);
    expect(r.locked).toBe(false);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBe(2000); // now + windowMs
  });

  it("multiple attempts increment counter", () => {
    recordFailedAttempt("test", CONFIG, 1000);
    recordFailedAttempt("test", CONFIG, 1100);
    const r = recordFailedAttempt("test", CONFIG, 1200);
    expect(r.locked).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.resetAt).toBe(2000); // resetAt fixed, tidak ikut bertambah
  });

  it("window expired — bucket reset, fresh counter", () => {
    recordFailedAttempt("test", CONFIG, 1000); // resetAt = 2000
    recordFailedAttempt("test", CONFIG, 1500);
    recordFailedAttempt("test", CONFIG, 1800);
    expect(checkRateLimit("test", CONFIG, 1900).locked).toBe(true);
    // Tunggu window habis
    const r = recordFailedAttempt("test", CONFIG, 2500);
    expect(r.locked).toBe(false);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBe(3500);
  });
});

describe("rate-limit — clearRateLimit", () => {
  it("reset counter setelah success — legit user yg sempat typo PIN tidak ke-lock", () => {
    recordFailedAttempt("test", CONFIG, 1000);
    recordFailedAttempt("test", CONFIG, 1100);
    clearRateLimit("test");
    const r = checkRateLimit("test", CONFIG, 1200);
    expect(r.locked).toBe(false);
    expect(r.remaining).toBe(3);
  });
});

describe("rate-limit — extractClientIp", () => {
  it("ambil x-forwarded-for paling kiri", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(extractClientIp(req)).toBe("1.2.3.4");
  });

  it("fallback ke x-real-ip kalau x-forwarded-for kosong", () => {
    const req = new Request("https://example.com", {
      headers: { "x-real-ip": "9.8.7.6" },
    });
    expect(extractClientIp(req)).toBe("9.8.7.6");
  });

  it("fallback ke 'unknown' kalau header tidak ada", () => {
    const req = new Request("https://example.com");
    expect(extractClientIp(req)).toBe("unknown");
  });

  it("trim whitespace dari x-forwarded-for entry", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" },
    });
    expect(extractClientIp(req)).toBe("1.2.3.4");
  });
});

describe("rate-limit — isolation per key", () => {
  it("key beda tidak saling pengaruh", () => {
    recordFailedAttempt("ip:1.2.3.4", CONFIG, 1000);
    recordFailedAttempt("ip:1.2.3.4", CONFIG, 1100);
    recordFailedAttempt("ip:1.2.3.4", CONFIG, 1200);
    expect(checkRateLimit("ip:1.2.3.4", CONFIG, 1300).locked).toBe(true);
    expect(checkRateLimit("ip:5.6.7.8", CONFIG, 1300).locked).toBe(false);
  });
});
