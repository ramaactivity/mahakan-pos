import { describe, expect, it } from "vitest";
import {
  buildLockWindowErrorMessage,
  findClosedShiftBlockingDate,
} from "@/features/cash/lock-window";

const shift = (
  openedDateWib: string,
  status: "open" | "closed",
) => ({ openedDateWib, status });

describe("findClosedShiftBlockingDate", () => {
  it("no shift at all — return null", () => {
    expect(findClosedShiftBlockingDate("2026-05-14", [])).toBeNull();
  });

  it("only open shift di tanggal yang sama — no block", () => {
    const r = findClosedShiftBlockingDate("2026-05-14", [
      shift("2026-05-14", "open"),
    ]);
    expect(r).toBeNull();
  });

  it("closed shift tapi tanggal berbeda — no block", () => {
    const r = findClosedShiftBlockingDate("2026-05-14", [
      shift("2026-05-13", "closed"),
    ]);
    expect(r).toBeNull();
  });

  it("closed shift di tanggal yang sama — return match", () => {
    const r = findClosedShiftBlockingDate("2026-05-14", [
      shift("2026-05-14", "closed"),
    ]);
    expect(r).not.toBeNull();
    expect(r?.status).toBe("closed");
    expect(r?.openedDateWib).toBe("2026-05-14");
  });

  it("multiple shifts mixed — return first closed match", () => {
    const r = findClosedShiftBlockingDate("2026-05-14", [
      shift("2026-05-14", "open"),
      shift("2026-05-14", "closed"),
      shift("2026-05-15", "closed"),
    ]);
    expect(r?.status).toBe("closed");
    expect(r?.openedDateWib).toBe("2026-05-14");
  });

  it("expense untuk hari ini tapi belum closed — no block (kasir masih bisa edit)", () => {
    const r = findClosedShiftBlockingDate("2026-05-14", [
      shift("2026-05-14", "open"),
      shift("2026-05-12", "closed"),
    ]);
    expect(r).toBeNull();
  });
});

describe("buildLockWindowErrorMessage", () => {
  it("pesan untuk pengeluaran include tanggal + reversing hint", () => {
    const m = buildLockWindowErrorMessage("2026-05-14", "pengeluaran");
    expect(m).toContain("Pengeluaran tanggal 2026-05-14");
    expect(m).toContain("sudah ditutup");
    expect(m).toContain("reversing entry");
  });

  it("pesan untuk pemasukan", () => {
    const m = buildLockWindowErrorMessage("2026-05-14", "pemasukan");
    expect(m).toContain("Pemasukan tanggal 2026-05-14");
    expect(m).toContain("reversing entry");
  });
});
