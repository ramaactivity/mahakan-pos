import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Sesi AE-46 — fireJournalHook visibility test. Mock logAudit module
 * untuk verify audit entry written saat hook fail. Mock juga "server-only"
 * + dependencies di hooks.ts supaya bisa import dalam env Vitest (Node).
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
vi.mock("@/lib/audit/logger", () => ({
  logAudit: logAuditMock,
}));

// Import AFTER mock setup.
const { fireJournalHook } = await import("@/features/accounting/hooks");

beforeEach(() => {
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
  // Suppress console.error noise.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper untuk await microtasks (fire-and-forget detach + then-catch).
async function flushPromises() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("fireJournalHook", () => {
  it("success — no audit log written", async () => {
    fireJournalHook(async () => {}, "pos_sale");
    await flushPromises();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("failure — write audit log dengan journal.posting_failed", async () => {
    fireJournalHook(async () => {
      throw new Error("journal mapping failed");
    }, "pos_sale");
    await flushPromises();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.eventType).toBe("journal.posting_failed");
    expect(call.entityType).toBe("journal_entry");
    expect(call.payload?.summary).toMatch(/Journal post gagal/);
    expect(call.payload?.context?.sourceType).toBe("pos_sale");
    expect(call.payload?.context?.rawError).toBe("journal mapping failed");
  });

  it("failure dengan context — sourceId + outletId + actorId di-pass", async () => {
    fireJournalHook(
      async () => {
        throw new Error("DB constraint violation");
      },
      "purchase_create",
      {
        sourceId: "purchase-123",
        outletId: "outlet-abc",
        actorId: "user-xyz",
      },
    );
    await flushPromises();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.entityId).toBe("purchase-123");
    expect(call.userId).toBe("user-xyz");
    expect(call.metadata?.outletId).toBe("outlet-abc");
    expect(call.payload?.context?.sourceId).toBe("purchase-123");
  });

  it("failure tanpa context — defensive defaults (null entityId/userId)", async () => {
    fireJournalHook(async () => {
      throw new Error("anything");
    }, "shift_variance");
    await flushPromises();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.entityId).toBeNull();
    expect(call.userId).toBeNull();
    expect(call.metadata?.actorRole).toBe("system");
  });

  it("stackPreview di payload — limit 5 baris untuk hemat space", async () => {
    fireJournalHook(async () => {
      // Synthetic deep error
      function deep(n: number): void {
        if (n === 0) throw new Error("deep error");
        deep(n - 1);
      }
      deep(20);
    }, "pos_refund");
    await flushPromises();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const stack = logAuditMock.mock.calls[0][0].payload?.context?.stackPreview;
    expect(stack).toBeTruthy();
    // Stack preview maksimal 5 baris (split by newline)
    expect((stack as string).split("\n").length).toBeLessThanOrEqual(5);
  });

  it("non-Error throw — message coerce ke string", async () => {
    fireJournalHook(async () => {
      throw "plain string error";
    }, "expense_create");
    await flushPromises();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.payload?.context?.rawError).toBe("plain string error");
  });
});
