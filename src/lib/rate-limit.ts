/**
 * Sesi AE-44 — in-memory rate limiter untuk protect API endpoint dari
 * brute force (terutama PIN attempts di /api/v1/attendance/clock-mobile).
 *
 * Mekanisme: sliding window per-key. Setiap failure tambah counter, kalau
 * counter melewati threshold dalam window → lockout sampai resetAt.
 * Counter reset otomatis after window expires atau after manual `clear()`
 * (saat success).
 *
 * Trade-off: in-memory = per-Vercel-serverless-container. Bukan global
 * lockout (cold start = lockout hilang). Praktis cukup karena:
 *   1. Vercel container biasanya hot 5-15 menit (matches window kita).
 *   2. Threat model attendance PIN = low value (cuma fake clock-in).
 *   3. Migration ke Vercel KV / Upstash Redis trivial via swap module
 *      export (deferred ke sesi nanti).
 *
 * Unit-testable: time injectable via `now` param, supaya bisa simulasi
 * window expiry tanpa actual setTimeout.
 */

interface BucketState {
  /** Jumlah failed attempt sejak bucket dibuat. */
  count: number;
  /** Epoch ms kapan bucket reset (lockout berakhir). */
  resetAt: number;
}

export interface RateLimitConfig {
  /** Max gagal sebelum lockout. */
  maxAttempts: number;
  /** Window ms — counter di-reset setelah ini. */
  windowMs: number;
}

export interface RateLimitResult {
  /** True = caller di-lockout, tolak request. */
  locked: boolean;
  /** Sisa attempt sebelum locked. 0 = next fail will trigger lockout. */
  remaining: number;
  /** Epoch ms kapan lockout selesai (kalau locked). */
  resetAt: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 15 * 60_000, // 15 menit
};

/**
 * Module-scoped bucket map. SHARED di seluruh import — supaya semua
 * route call yang sama key di-throttle bareng. Vercel serverless: scope =
 * 1 container instance (warm reuse antar request, lost on cold start).
 */
const buckets = new Map<string, BucketState>();

/**
 * Cek status rate limit untuk key TANPA increment. Pakai sebelum
 * authentication attempt — kalau locked, tolak langsung.
 *
 * @param key — unique identifier per attacker (mis. "attendance:1.2.3.4")
 * @param config — optional override (default 10/15min)
 * @param now — optional time injection untuk testing
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket) {
    return {
      locked: false,
      remaining: config.maxAttempts,
      resetAt: now + config.windowMs,
    };
  }
  // Window expired → bersih (lazy GC). Treat sebagai fresh.
  if (now >= bucket.resetAt) {
    buckets.delete(key);
    return {
      locked: false,
      remaining: config.maxAttempts,
      resetAt: now + config.windowMs,
    };
  }
  const locked = bucket.count >= config.maxAttempts;
  return {
    locked,
    remaining: Math.max(0, config.maxAttempts - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/**
 * Record satu failed attempt untuk key. Increment counter, atau create
 * bucket baru kalau belum ada. Window di-set saat bucket pertama dibuat
 * dan tidak di-extend (fixed window, bukan sliding) — supaya predictable.
 */
export function recordFailedAttempt(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    // New bucket.
    const bucket = { count: 1, resetAt: now + config.windowMs };
    buckets.set(key, bucket);
    return {
      locked: 1 >= config.maxAttempts,
      remaining: Math.max(0, config.maxAttempts - 1),
      resetAt: bucket.resetAt,
    };
  }
  existing.count += 1;
  buckets.set(key, existing);
  return {
    locked: existing.count >= config.maxAttempts,
    remaining: Math.max(0, config.maxAttempts - existing.count),
    resetAt: existing.resetAt,
  };
}

/**
 * Clear counter for key — call ini saat success authentication, supaya
 * legit user yg sempat typo tidak ke-lockout.
 */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Test-only: reset semua state. Jangan dipakai di production code.
 */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}

/**
 * Helper untuk extract client IP dari Next.js Request. Vercel populate
 * x-forwarded-for + x-real-ip headers. Fallback ke "unknown" kalau
 * keduanya tidak ada (treat sebagai 1 IP — defensive, lebih baik over-
 * lockout daripada bypass).
 */
export function extractClientIp(request: Request): string {
  return extractClientIpFromHeaders(request.headers);
}

/**
 * Sama seperti extractClientIp tapi terima Headers-like langsung — dipakai
 * server actions yang dapat headers via next/headers `headers()` (tidak
 * punya Request object). Logic identik: x-forwarded-for first value →
 * x-real-ip → "unknown".
 */
export function extractClientIpFromHeaders(headers: {
  get(name: string): string | null;
}): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for bisa contain chain "client, proxy1, proxy2" —
    // ambil yang paling kiri (asli client).
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
