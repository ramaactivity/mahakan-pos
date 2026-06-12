import { describe, expect, it } from "vitest";
import { errorChainIncludes } from "@/lib/server-error";

/**
 * Sesi AE-180 — drizzle 0.45 wraps DB errors in DrizzleQueryError dengan
 * Postgres error asli di `.cause`. Deteksi unique-violation harus jalan
 * di seluruh rantai cause, bukan cuma e.message.
 */

describe("errorChainIncludes", () => {
  it("match di message level teratas", () => {
    const e = new Error('duplicate key "ux_internal_debt_parties_outlet_name"');
    expect(errorChainIncludes(e, "ux_internal_debt_parties_outlet_name")).toBe(
      true,
    );
  });

  it("match di .cause (pola DrizzleQueryError)", () => {
    const pgError = new Error(
      'duplicate key value violates unique constraint "ux_internal_debt_parties_outlet_name"',
    );
    const wrapped = new Error('Failed query: insert into "internal_debt_parties" ...', {
      cause: pgError,
    });
    expect(
      errorChainIncludes(wrapped, "ux_internal_debt_parties_outlet_name"),
    ).toBe(true);
  });

  it("match di nested cause level 3", () => {
    const inner = new Error('constraint "ux_creditors_outlet_nik"');
    const mid = new Error("query failed", { cause: inner });
    const outer = new Error("action failed", { cause: mid });
    expect(errorChainIncludes(outer, "ux_creditors_outlet_nik")).toBe(true);
  });

  it("false kalau needle tidak ada di rantai", () => {
    const wrapped = new Error("Failed query: ...", {
      cause: new Error("connection reset"),
    });
    expect(errorChainIncludes(wrapped, "ux_apa_pun")).toBe(false);
  });

  it("handle non-Error / null tanpa crash", () => {
    expect(errorChainIncludes(null, "x")).toBe(false);
    expect(errorChainIncludes("string ux_target", "ux_target")).toBe(true);
    expect(errorChainIncludes(42, "x")).toBe(false);
  });

  it("berhenti di cause cycle (max 5 level, no infinite loop)", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause: unknown }).cause = b;
    expect(errorChainIncludes(a, "tidak-ada")).toBe(false);
  });
});
