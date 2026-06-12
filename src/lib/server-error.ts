/**
 * Server-side error sanitization (sesi AC-5b — ramaactivity/code-review #4).
 *
 * Sebelumnya banyak server action di-catch DB error lalu return raw
 * `e.message` ke client via fail("DB_ERROR", msg). Postgres / drizzle
 * errors leak schema details (table/column names, constraint names,
 * IP/host info via wrapped query strings, etc).
 *
 * Pakai helper ini di tail catch block:
 *
 *   } catch (e) {
 *     return fail("DB_ERROR", logAndSanitize(e, "purchases.create",
 *       "Gagal simpan pembelian"));
 *   }
 *
 * Server log tetap dapat full stack via console.error (Vercel logs
 * captures). Client cuma dapat fallback user-friendly.
 */

const SQLSTATE_REGEX = /^[0-9A-Z]{5}$/;

interface ErrorWithCode {
  code?: unknown;
  message?: unknown;
}

function looksLikeDbError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const ec = e as Error & ErrorWithCode;
  // Postgres SQLSTATE: 5-char alphanumeric (e.g. "42P01", "23505").
  if (typeof ec.code === "string" && SQLSTATE_REGEX.test(ec.code)) return true;
  // Drizzle wraps as "Failed query: SELECT ..." — leaks SQL.
  if (typeof e.message === "string" && e.message.startsWith("Failed query"))
    return true;
  // pg pool / connection errors.
  if (typeof e.message === "string" && /relation|column|constraint|database/i.test(e.message))
    return true;
  return false;
}

/**
 * Log full error to server console + return user-safe fallback string.
 * Custom-thrown "sentinel" Error.message yang ASCII-only (no spaces) di-pass
 * through karena biasanya code path internal yang caller sengaja matching.
 */
/**
 * Sesi AE-180 — cek substring di SELURUH rantai error (`e` + `e.cause` +
 * cause-nya cause, max 5 level). Drizzle >= 0.36 membungkus DB error dalam
 * `DrizzleQueryError` ("Failed query: ...") dengan error Postgres asli di
 * `.cause` — pattern lama `e.message.includes("ux_constraint_name")` tidak
 * pernah match lagi (constraint name cuma ada di cause). Pakai helper ini
 * untuk deteksi unique-violation spesifik sebelum fallback logAndSanitize.
 */
export function errorChainIncludes(e: unknown, needle: string): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur; depth++) {
    if (cur instanceof Error) {
      if (typeof cur.message === "string" && cur.message.includes(needle)) {
        return true;
      }
      cur = cur.cause;
    } else {
      return typeof cur === "string" && cur.includes(needle);
    }
  }
  return false;
}

export function logAndSanitize(
  e: unknown,
  feature: string,
  fallback: string,
): string {
  console.error(`[${feature}]`, e);
  if (looksLikeDbError(e)) return fallback;
  if (e instanceof Error) {
    const msg = e.message;
    // Sentinel pattern: SCREAMING_SNAKE_CASE, no spaces — caller-thrown
    // contract codes that downstream pattern-matches. Safe to expose
    // because they don't leak schema.
    if (/^[A-Z][A-Z0-9_]*$/.test(msg)) return msg;
  }
  return fallback;
}
