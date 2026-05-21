import { describe, expect, it } from "vitest";
import {
  extractDbError,
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from "@/lib/db-error";

/**
 * Sesi AE-76 — Test extraction PG error fields dari drizzle-wrapped errors.
 *
 * Background: Drizzle wrap PG errors sebagai DrizzleQueryError dengan:
 *   - message: "Failed query: <SQL>" (no reason)
 *   - cause:   original PG error (has SQLSTATE + reason + constraint + detail)
 *
 * Helper extractDbError walk e.cause chain → ambil reason + sqlstate +
 * constraint. Sebelum AE-76, audit log + retry-queue lastError cuma store
 * e.message (SQL only) → tidak diagnosable.
 */

function makePgError(opts: {
  message: string;
  code?: string;
  constraint?: string;
  detail?: string;
}): Error {
  const e = new Error(opts.message);
  Object.assign(e, opts);
  return e;
}

function makeDrizzleQueryError(sql: string, params: unknown[], cause: unknown): Error {
  const e = new Error(`Failed query: ${sql}\nparams: ${params.join(",")}`);
  (e as { cause?: unknown }).cause = cause;
  return e;
}

describe("extractDbError", () => {
  it("walks cause chain to surface PG reason for drizzle-wrapped unique violation", () => {
    const pgErr = makePgError({
      message: 'duplicate key value violates unique constraint "ux_je_outlet_source_active"',
      code: "23505",
      constraint: "ux_je_outlet_source_active",
      detail: "Key (outlet_id, source_type, source_id)=(abc, pos_sale, def) already exists.",
    });
    const wrapped = makeDrizzleQueryError(
      'insert into "journal_entries" ...',
      ["abc", "def"],
      pgErr,
    );

    const info = extractDbError(wrapped);
    expect(info.reason).toContain("duplicate key");
    expect(info.sqlstate).toBe("23505");
    expect(info.constraint).toBe("ux_je_outlet_source_active");
    expect(info.detail).toContain("already exists");
    expect(info.formatted).toContain("SQLSTATE 23505");
    expect(info.formatted).toContain("constraint=ux_je_outlet_source_active");
  });

  it("falls back to e.message when no cause set", () => {
    const e = new Error("PERIOD_LOCKED:2026-05");
    const info = extractDbError(e);
    expect(info.reason).toBe("PERIOD_LOCKED:2026-05");
    expect(info.sqlstate).toBeNull();
    expect(info.constraint).toBeNull();
  });

  it("handles non-Error values gracefully (string, number, null)", () => {
    expect(extractDbError("plain string").reason).toBe("plain string");
    expect(extractDbError(42).reason).toBe("42");
    expect(extractDbError(null).reason).toBe("null");
    expect(extractDbError(undefined).reason).toBe("undefined");
  });

  it("walks nested cause chain (depth-bounded)", () => {
    const inner = makePgError({
      message: "FK violation",
      code: "23503",
      constraint: "fk_journal_line_account",
    });
    const mid = new Error("mid wrap");
    (mid as { cause?: unknown }).cause = inner;
    const outer = makeDrizzleQueryError("update ...", [], mid);

    const info = extractDbError(outer);
    expect(info.sqlstate).toBe("23503");
    expect(info.constraint).toBe("fk_journal_line_account");
  });

  it("formatted string includes all available fields, ordered", () => {
    const pgErr = makePgError({
      message: "check constraint violated",
      code: "23514",
      constraint: "ck_jl_xor",
      detail: "debit=100 AND credit=50",
    });
    const wrapped = makeDrizzleQueryError("insert into journal_lines ...", [], pgErr);
    const info = extractDbError(wrapped);
    const parts = info.formatted.split(" | ");
    expect(parts[0]).toBe("check constraint violated");
    expect(parts[1]).toBe("[SQLSTATE 23514]");
    expect(parts[2]).toBe("constraint=ck_jl_xor");
    expect(parts[3]).toBe("detail=debit=100 AND credit=50");
  });

  it("ignores invalid SQLSTATE codes (not 5-char alphanumeric)", () => {
    const fake = new Error("bad");
    Object.assign(fake, { code: "NOT_A_CODE" });
    const info = extractDbError(fake);
    expect(info.sqlstate).toBeNull();
  });

  it("guards against cause self-reference loops", () => {
    const e = new Error("self-ref");
    (e as { cause?: unknown }).cause = e;
    expect(() => extractDbError(e)).not.toThrow();
  });
});

describe("DB error type guards", () => {
  function wrap(code: string): Error {
    const inner = new Error("test");
    Object.assign(inner, { code });
    const outer = new Error("Failed query: ...");
    (outer as { cause?: unknown }).cause = inner;
    return outer;
  }

  it("isUniqueViolation matches 23505", () => {
    expect(isUniqueViolation(wrap("23505"))).toBe(true);
    expect(isUniqueViolation(wrap("23503"))).toBe(false);
  });

  it("isForeignKeyViolation matches 23503", () => {
    expect(isForeignKeyViolation(wrap("23503"))).toBe(true);
    expect(isForeignKeyViolation(wrap("23505"))).toBe(false);
  });

  it("isCheckViolation matches 23514", () => {
    expect(isCheckViolation(wrap("23514"))).toBe(true);
    expect(isCheckViolation(wrap("23505"))).toBe(false);
  });
});
