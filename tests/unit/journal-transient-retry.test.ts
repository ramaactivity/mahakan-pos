import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Sesi AE-182 — proteksi regresi untuk perbaikan "jurnal hilang senyap".
 *
 * Yang dijaga di sini:
 *   1. Error koneksi sesaat ("Connection terminated unexpectedly") dikenali
 *      sebagai transient → hook diulang sendiri, TIDAK langsung masuk antrian.
 *   2. Error data (imbalance, constraint) TIDAK diulang — buang-buang waktu,
 *      langsung ke antrian supaya owner lihat.
 *   3. Kalau semua percobaan habis, jalur audit + enqueue tetap jalan.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/features/accounting/flag", () => ({
  isAutoJournalEnabled: vi.fn(),
}));
vi.mock("@/features/accounting/posting", () => ({
  recordJournal: vi.fn(),
}));
vi.mock("@/features/accounting/mapping", () => ({}));

const logAuditMock = vi.fn();
vi.mock("@/lib/audit/logger", () => ({ logAudit: logAuditMock }));

const enqueueMock = vi.fn();
vi.mock("@/features/accounting/retry-queue", () => ({
  enqueueFailedJournal: enqueueMock,
}));

const { fireJournalHook } = await import("@/features/accounting/hooks");
const { isTransientDbError } = await import("@/lib/db-error");

beforeEach(() => {
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
  enqueueMock.mockReset();
  enqueueMock.mockResolvedValue({ queueId: "q1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Tunggu sampai kondisi terpenuhi (retry pakai setTimeout betulan). */
async function waitFor(fn: () => boolean, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout menunggu");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("isTransientDbError", () => {
  it("mengenali error koneksi yang terjadi di produksi", () => {
    expect(
      isTransientDbError(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
    expect(
      isTransientDbError(
        new Error(
          "Client has encountered a connection error and is not queryable",
        ),
      ),
    ).toBe(true);
    expect(
      isTransientDbError(
        new Error("timeout exceeded when trying to connect"),
      ),
    ).toBe(true);
  });

  it("SQLSTATE kelas 08 = masalah koneksi", () => {
    const e = Object.assign(new Error("connection_failure"), { code: "08006" });
    expect(isTransientDbError(e)).toBe(true);
  });

  it("error data TIDAK dianggap transient", () => {
    const unique = Object.assign(new Error("duplicate key"), { code: "23505" });
    const badType = Object.assign(
      new Error('invalid input syntax for type bigint: "428126.8473"'),
      { code: "22P02" },
    );
    expect(isTransientDbError(unique)).toBe(false);
    expect(isTransientDbError(badType)).toBe(false);
    expect(isTransientDbError(new Error("JOURNAL_IMBALANCED:d=1,c=2"))).toBe(
      false,
    );
  });

  it("membaca reason dari cause chain ala DrizzleQueryError", () => {
    const pg = Object.assign(new Error("terminating connection due to..."), {
      code: "57P01",
    });
    const wrapped = Object.assign(new Error("Failed query: insert into ..."), {
      cause: pg,
    });
    expect(isTransientDbError(wrapped)).toBe(true);
  });
});

describe("fireJournalHook — retry error sesaat", () => {
  it("gagal sekali karena koneksi lalu sukses → tidak masuk antrian", async () => {
    let calls = 0;
    fireJournalHook(
      async () => {
        calls++;
        if (calls === 1) throw new Error("Connection terminated unexpectedly");
      },
      "pos_sale",
      { outletId: "o1", sourceId: "t1", actorId: "u1" },
      { label: "pos_sale", args: { outletId: "o1" } },
    );
    await waitFor(() => calls >= 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(2);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("koneksi mati terus → 3 percobaan, lalu masuk antrian retry", async () => {
    let calls = 0;
    fireJournalHook(
      async () => {
        calls++;
        throw new Error("Connection terminated unexpectedly");
      },
      "pos_sale",
      { outletId: "o1", sourceId: "t1", actorId: "u1" },
      { label: "pos_sale", args: { outletId: "o1", transactionId: "t1" } },
    );
    await waitFor(() => enqueueMock.mock.calls.length > 0);
    expect(calls).toBe(3);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].eventType).toBe(
      "journal.posting_failed",
    );
    expect(enqueueMock.mock.calls[0][0].hookLabel).toBe("pos_sale");
  });

  it("error data TIDAK diulang — langsung ke antrian", async () => {
    let calls = 0;
    fireJournalHook(
      async () => {
        calls++;
        throw new Error("JOURNAL_IMBALANCED:debit=1000,credit=999");
      },
      "pos_sale",
      { outletId: "o1", sourceId: "t1" },
      { label: "pos_sale", args: {} },
    );
    await waitFor(() => enqueueMock.mock.calls.length > 0);
    expect(calls).toBe(1);
  });
});
