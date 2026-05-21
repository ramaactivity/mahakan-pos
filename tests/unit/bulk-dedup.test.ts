import { describe, expect, it } from "vitest";
import {
  classifyBulkImportRows,
  computeBalanceAdjustments,
} from "@/features/investors/bulk-dedup";

/**
 * Sesi AE-80 follow-up — pure dedup logic tests.
 */

describe("classifyBulkImportRows", () => {
  it("all new rows in insert_only mode", () => {
    const result = classifyBulkImportRows(
      [
        { rowIdx: 1, fullName: "Alice", nik: null },
        { rowIdx: 2, fullName: "Bob", nik: null },
      ],
      [],
      "insert_only",
    );
    expect(result.toInsert).toHaveLength(2);
    expect(result.toUpsert).toHaveLength(0);
    expect(result.skippedDuplicate).toBe(0);
  });

  it("skip duplicate (insert_only) when name match exists", () => {
    const result = classifyBulkImportRows(
      [{ rowIdx: 1, fullName: "Alice", nik: null }],
      [{ id: "u1", fullName: "Alice", nik: null }],
      "insert_only",
    );
    expect(result.toInsert).toHaveLength(0);
    expect(result.skippedDuplicate).toBe(1);
  });

  it("upsert duplicate when matched + mode='upsert'", () => {
    const result = classifyBulkImportRows(
      [{ rowIdx: 1, fullName: "Alice", nik: null }],
      [{ id: "u1", fullName: "Alice", nik: null }],
      "upsert",
    );
    expect(result.toInsert).toHaveLength(0);
    expect(result.toUpsert).toHaveLength(1);
    expect(result.toUpsert[0].existingId).toBe("u1");
    expect(result.skippedDuplicate).toBe(0);
  });

  it("name match is case-insensitive + trim-tolerant", () => {
    const result = classifyBulkImportRows(
      [{ rowIdx: 1, fullName: "  alice  ", nik: null }],
      [{ id: "u1", fullName: "Alice", nik: null }],
      "insert_only",
    );
    expect(result.skippedDuplicate).toBe(1);
  });

  it("NIK match has priority over name match", () => {
    const result = classifyBulkImportRows(
      [{ rowIdx: 1, fullName: "Alice Smith", nik: "1234567890123456" }],
      [
        {
          id: "u1",
          fullName: "Alice (different person, same NIK)",
          nik: "1234567890123456",
        },
      ],
      "upsert",
    );
    expect(result.toUpsert).toHaveLength(1);
    expect(result.toUpsert[0].existingId).toBe("u1");
  });

  it("internal-CSV duplicate by NIK skipped (PENDING_INSERT sentinel)", () => {
    const result = classifyBulkImportRows(
      [
        { rowIdx: 1, fullName: "Alice", nik: "1234567890123456" },
        { rowIdx: 2, fullName: "Alice2", nik: "1234567890123456" },
      ],
      [],
      "insert_only",
    );
    /* Row 1 di-insert, row 2 detect NIK sudah PENDING → skip duplicate */
    expect(result.toInsert).toHaveLength(1);
    expect(result.skippedDuplicate).toBe(1);
  });

  it("internal-CSV duplicate by name skipped", () => {
    const result = classifyBulkImportRows(
      [
        { rowIdx: 1, fullName: "Alice", nik: null },
        { rowIdx: 2, fullName: "alice", nik: null },
      ],
      [],
      "insert_only",
    );
    expect(result.toInsert).toHaveLength(1);
    expect(result.skippedDuplicate).toBe(1);
  });

  it("internal-CSV duplicate still skipped di mode upsert (avoid double-update)", () => {
    /* Bahkan di upsert mode, kita tidak boleh upsert 2 baris ke entity yang
     * sama dari 1 file CSV. PENDING_INSERT sentinel ensures row ke-2 skip. */
    const result = classifyBulkImportRows(
      [
        { rowIdx: 1, fullName: "Alice", nik: null },
        { rowIdx: 2, fullName: "alice", nik: null },
      ],
      [],
      "upsert",
    );
    expect(result.toInsert).toHaveLength(1);
    expect(result.toUpsert).toHaveLength(0);
    expect(result.skippedDuplicate).toBe(1);
  });

  it("mix new + existing rows handled correctly", () => {
    const result = classifyBulkImportRows(
      [
        { rowIdx: 1, fullName: "Alice", nik: null },
        { rowIdx: 2, fullName: "Bob", nik: null },
        { rowIdx: 3, fullName: "Carol", nik: null },
      ],
      [{ id: "u1", fullName: "Alice", nik: null }],
      "upsert",
    );
    expect(result.toInsert).toHaveLength(2);
    expect(result.toUpsert).toHaveLength(1);
    expect(result.skippedDuplicate).toBe(0);
  });

  it("empty rows produces empty result", () => {
    const result = classifyBulkImportRows([], [], "insert_only");
    expect(result.toInsert).toHaveLength(0);
    expect(result.toUpsert).toHaveLength(0);
    expect(result.skippedDuplicate).toBe(0);
  });
});

describe("computeBalanceAdjustments", () => {
  it("returns only rows with balance change", () => {
    const adjustments = computeBalanceAdjustments([
      { existingId: "u1", oldBalance: 0, newBalance: 100 },
      { existingId: "u2", oldBalance: 50, newBalance: 50 }, // no change
      { existingId: "u3", oldBalance: 200, newBalance: 100 },
    ]);
    expect(adjustments).toHaveLength(2);
    expect(adjustments[0]).toEqual({ holderId: "u1", delta: 100, newBalance: 100 });
    expect(adjustments[1]).toEqual({ holderId: "u3", delta: -100, newBalance: 100 });
  });

  it("skips rows where newBalance is null (not updated)", () => {
    const adjustments = computeBalanceAdjustments([
      { existingId: "u1", oldBalance: 0, newBalance: null },
      { existingId: "u2", oldBalance: 0, newBalance: undefined },
    ]);
    expect(adjustments).toHaveLength(0);
  });

  it("delta signed correctly for decrement", () => {
    const adjustments = computeBalanceAdjustments([
      { existingId: "u1", oldBalance: 1000, newBalance: 600 },
    ]);
    expect(adjustments[0].delta).toBe(-400);
  });

  it("zero-delta excluded (no movement needed if balance unchanged)", () => {
    const adjustments = computeBalanceAdjustments([
      { existingId: "u1", oldBalance: 500, newBalance: 500 },
    ]);
    expect(adjustments).toHaveLength(0);
  });
});
