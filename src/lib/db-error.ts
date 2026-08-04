/**
 * Sesi AE-76 — DB error introspection helpers.
 *
 * Drizzle wraps DB errors as `DrizzleQueryError` with this shape:
 *   - message: "Failed query: <SQL>\nparams: <args>"   ← TIDAK ada reason
 *   - cause:   <original PG error>                      ← reason ada di sini
 *
 * Original PG error (dari node-postgres / @neondatabase/serverless) punya:
 *   - message: human-readable reason (mis. 'duplicate key value violates ...')
 *   - code:    SQLSTATE 5-char (mis. '23505', '23503', '42P01')
 *   - constraint, detail, hint, schema, table, column (opsional)
 *
 * Before sesi AE-76, fireJournalHook + retry-queue capture e.message saja —
 * jadi owner cuma lihat "Failed query: insert into..." tanpa tahu reason
 * (unique violation? FK violation? schema mismatch?). Ini bikin journal retry
 * gagal tidak bisa di-diagnose tanpa SSH ke Vercel logs.
 *
 * Helper di sini extract reason + SQLSTATE dari e.cause supaya audit log
 * + retry queue lastError berisi info yang actionable.
 */

interface PgLikeError {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
  hint?: unknown;
  schema?: unknown;
  table?: unknown;
  column?: unknown;
}

export interface ExtractedDbError {
  /** Reason yang user-actionable. Fallback ke e.message kalau cause kosong. */
  reason: string;
  /** SQLSTATE code 5-char, kalau ada. */
  sqlstate: string | null;
  /** Constraint name (untuk unique/check/FK violation). */
  constraint: string | null;
  /** Detail dari PG (sering berisi key values). */
  detail: string | null;
  /** Full multi-line string kombinasi reason + state + constraint + detail. */
  formatted: string;
}

const SQLSTATE_REGEX = /^[0-9A-Z]{5}$/;

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickPgFields(e: unknown): PgLikeError | null {
  if (e == null || (typeof e !== "object" && typeof e !== "function")) {
    return null;
  }
  return e as PgLikeError;
}

/**
 * Walk e.cause chain (depth-bounded) to find the first PG-shaped error.
 * Returns the e itself if no cause or already PG-shaped.
 */
function findPgCause(e: unknown, depth = 0): unknown {
  if (depth > 5) return e;
  const obj = pickPgFields(e);
  if (!obj) return e;
  if (typeof obj.code === "string" && SQLSTATE_REGEX.test(obj.code)) return e;
  /* drizzle DrizzleQueryError starts with "Failed query:" — has .cause */
  const cause = (obj as { cause?: unknown }).cause;
  if (cause != null && cause !== e) {
    return findPgCause(cause, depth + 1);
  }
  return e;
}

/**
 * Extract richer error info from drizzle-wrapped DB errors.
 *
 * Use saat catch error dari db.insert / db.update / db.transaction supaya
 * audit log + retry queue dapat reason yang actionable, bukan cuma SQL.
 */
export function extractDbError(e: unknown): ExtractedDbError {
  const root = e instanceof Error ? e : null;
  const cause = findPgCause(e);
  const pg = pickPgFields(cause);

  const sqlstate =
    pg && typeof pg.code === "string" && SQLSTATE_REGEX.test(pg.code)
      ? pg.code
      : null;
  const constraint = pg ? asString(pg.constraint) : null;
  const detail = pg ? asString(pg.detail) : null;

  /* Prefer PG reason (mis. "duplicate key value violates unique constraint")
   * over drizzle wrapper message ("Failed query: ..."). */
  let reason: string;
  if (cause !== e && pg && typeof pg.message === "string" && pg.message.trim().length > 0) {
    reason = pg.message.trim();
  } else if (root) {
    reason = root.message;
  } else {
    reason = String(e);
  }

  /* Build a one-string formatted summary that fits audit log + lastError
   * field (500 char cap). Order: reason | SQLSTATE | constraint | detail. */
  const parts: string[] = [reason];
  if (sqlstate) parts.push(`[SQLSTATE ${sqlstate}]`);
  if (constraint) parts.push(`constraint=${constraint}`);
  if (detail) parts.push(`detail=${detail}`);
  const formatted = parts.join(" | ");

  return { reason, sqlstate, constraint, detail, formatted };
}

/**
 * Sesi AE-182 — apakah error ini sekadar masalah koneksi sesaat (bukan
 * masalah data)? Kalau ya, operasi idempotent boleh diulang otomatis.
 *
 * Sumber error yang kita lihat di produksi (audit 2026-08-04):
 *   - "Connection terminated unexpectedly" — socket WS ke Neon putus saat
 *     instance serverless dibekukan / Neon auto-suspend.
 *   - "Client has encountered a connection error and is not queryable"
 *   - timeout ambil koneksi dari pool (connectionTimeoutMillis).
 *   - SQLSTATE kelas 08 (connection exception) + 57P01 (admin shutdown) +
 *     40001/40P01 (serialization failure / deadlock — aman diulang).
 */
const TRANSIENT_SQLSTATES = new Set([
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /connection terminated/i,
  /connection error/i,
  /not queryable/i,
  /timeout exceeded when trying to connect/i,
  /connection timeout/i,
  /socket hang up/i,
  /econnreset/i,
  /epipe/i,
  /fetch failed/i,
  /terminating connection/i,
  /server closed the connection/i,
];

export function isTransientDbError(e: unknown): boolean {
  const info = extractDbError(e);
  if (info.sqlstate) {
    if (TRANSIENT_SQLSTATES.has(info.sqlstate)) return true;
    /* Kelas 08 = connection exception (08000, 08003, 08006, 08001, 08004). */
    if (info.sqlstate.startsWith("08")) return true;
    /* SQLSTATE lain = error data → jangan diulang. */
    return false;
  }
  const haystack = `${info.reason} ${e instanceof Error ? e.message : ""}`;
  return TRANSIENT_MESSAGE_PATTERNS.some((re) => re.test(haystack));
}

/** Quick check: is this a PG unique-violation? */
export function isUniqueViolation(e: unknown): boolean {
  const info = extractDbError(e);
  return info.sqlstate === "23505";
}

/** Quick check: is this a PG FK-violation? */
export function isForeignKeyViolation(e: unknown): boolean {
  const info = extractDbError(e);
  return info.sqlstate === "23503";
}

/** Quick check: is this a check-constraint violation? */
export function isCheckViolation(e: unknown): boolean {
  const info = extractDbError(e);
  return info.sqlstate === "23514";
}
