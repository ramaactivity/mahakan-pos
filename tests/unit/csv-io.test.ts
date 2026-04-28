import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, writeCsv } from "@/../scripts/_shared/csv-io";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "csv-io-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("parseCsv", () => {
  it("parses simple csv with header", () => {
    const path = join(tmp, "t.csv");
    writeFileSync(path, "name,qty\nAyam,3\nBeans,16\n", "utf-8");
    const r = parseCsv(path);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { name: "Ayam", qty: "3" },
      { name: "Beans", qty: "16" },
    ]);
    expect(r.rowNumbers).toEqual([2, 3]);
  });

  it("strips UTF-8 BOM", () => {
    const path = join(tmp, "bom.csv");
    writeFileSync(path, "﻿name,qty\nAyam,3\n", "utf-8");
    const r = parseCsv(path);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ name: "Ayam", qty: "3" }]);
  });

  it("trims whitespace from cells and headers", () => {
    const path = join(tmp, "t.csv");
    writeFileSync(path, "  name  , qty \n  Ayam  ,  3  \n", "utf-8");
    const r = parseCsv(path);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ name: "Ayam", qty: "3" }]);
  });

  it("handles embedded comma via quoted cell", () => {
    const path = join(tmp, "t.csv");
    writeFileSync(path, 'name,notes\nAyam,"Note with, comma"\n', "utf-8");
    const r = parseCsv(path);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ name: "Ayam", notes: "Note with, comma" }]);
  });

  it("handles embedded double-quote via escaped \"\"", () => {
    const path = join(tmp, "t.csv");
    writeFileSync(path, 'name,notes\nAyam,"He said ""hi"""\n', "utf-8");
    const r = parseCsv(path);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ name: "Ayam", notes: 'He said "hi"' }]);
  });

  it("skips fully empty lines", () => {
    const path = join(tmp, "t.csv");
    writeFileSync(path, "name,qty\nAyam,3\n\n\nBeans,16\n", "utf-8");
    const r = parseCsv(path);
    expect(r.rows).toHaveLength(2);
  });

  it("returns error when file does not exist", () => {
    const r = parseCsv(join(tmp, "missing.csv"));
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/File not found/);
  });
});

describe("writeCsv round-trip", () => {
  it("writes and re-parses cleanly", () => {
    const path = join(tmp, "rt.csv");
    writeCsv(
      path,
      [
        { name: "Ayam", qty: "3" },
        { name: "Beans", qty: "16" },
      ],
      { headers: ["name", "qty"] },
    );
    const r = parseCsv(path);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { name: "Ayam", qty: "3" },
      { name: "Beans", qty: "16" },
    ]);
  });

  it("preserves embedded commas and quotes via round-trip", () => {
    const path = join(tmp, "rt.csv");
    writeCsv(
      path,
      [{ name: "Ayam", notes: 'Comma, and "quote"' }],
      { headers: ["name", "notes"] },
    );
    const r = parseCsv<{ name: string; notes: string }>(path);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].notes).toBe('Comma, and "quote"');
  });

  it("emits headers in specified order with empty cells for missing keys", () => {
    const path = join(tmp, "rt.csv");
    writeCsv(
      path,
      [{ name: "Ayam", qty: "3" }],
      { headers: ["name", "qty", "notes"] },
    );
    const raw = readFileSync(path, "utf-8");
    expect(raw.split("\n")[0]).toBe("name,qty,notes");
    // Empty notes cell should be empty string.
    expect(raw).toContain("Ayam,3,");
  });

  it("refuses on existing file when refuseOnExist=true", () => {
    const path = join(tmp, "exists.csv");
    writeFileSync(path, "x,y\n", "utf-8");
    expect(() =>
      writeCsv(path, [{ x: "1", y: "2" }], {
        headers: ["x", "y"],
        refuseOnExist: true,
      }),
    ).toThrow(/File exists/);
  });

  it("appends trailing newline", () => {
    const path = join(tmp, "rt.csv");
    writeCsv(path, [{ a: "1" }], { headers: ["a"] });
    expect(readFileSync(path, "utf-8").endsWith("\n")).toBe(true);
  });
});
