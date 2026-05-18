import { describe, it, expect } from "vitest";
import {
  CORRECTION_POST_CLOSE_WINDOW_MS,
  getCorrectableTransactionWindow,
} from "@/features/transactions/correction-window";

const NOW = new Date("2026-05-18T10:00:00.000Z");

function shiftOpen(id = "shift-1", outletId = "outlet-1") {
  return {
    id,
    status: "open" as const,
    closedAt: null,
    outletId,
  };
}

function shiftClosed(
  closedAt: Date,
  id = "shift-1",
  outletId = "outlet-1",
) {
  return {
    id,
    status: "closed" as const,
    closedAt,
    outletId,
  };
}

describe("getCorrectableTransactionWindow — sesi AE-62r", () => {
  it("eligible: trx dari shift yang masih open", () => {
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-1", outletId: "outlet-1" },
      shift: shiftOpen(),
      now: NOW,
    });
    expect(res.eligible).toBe(true);
    expect(res.source).toBe("kasir_active_shift");
    expect(res.reason).toBeNull();
  });

  it("eligible: trx dari shift closed <24h (1 jam lalu)", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-1", outletId: "outlet-1" },
      shift: shiftClosed(oneHourAgo),
      now: NOW,
    });
    expect(res.eligible).toBe(true);
    expect(res.source).toBe("kasir_post_close");
  });

  it("eligible: tepat di batas 24h (23h 59m)", () => {
    const justUnder = new Date(
      NOW.getTime() - CORRECTION_POST_CLOSE_WINDOW_MS + 60 * 1000,
    );
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-1", outletId: "outlet-1" },
      shift: shiftClosed(justUnder),
      now: NOW,
    });
    expect(res.eligible).toBe(true);
    expect(res.source).toBe("kasir_post_close");
  });

  it("reject: shift closed >24h (25 jam lalu) → WINDOW_EXPIRED", () => {
    const longAgo = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-1", outletId: "outlet-1" },
      shift: shiftClosed(longAgo),
      now: NOW,
    });
    expect(res.eligible).toBe(false);
    expect(res.source).toBeNull();
    expect(res.reason).toBe("WINDOW_EXPIRED");
  });

  it("reject: trx.shiftId tidak match shift yang dipass → SHIFT_MISMATCH", () => {
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-other", outletId: "outlet-1" },
      shift: shiftOpen(),
      now: NOW,
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("SHIFT_MISMATCH");
  });

  it("reject: outlet mismatch → OUTLET_MISMATCH", () => {
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-1", outletId: "outlet-other" },
      shift: shiftOpen(),
      now: NOW,
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("OUTLET_MISMATCH");
  });

  it("reject: shift closed tapi closedAt null → CLOSED_WITHOUT_TIMESTAMP", () => {
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-1", outletId: "outlet-1" },
      shift: {
        id: "shift-1",
        status: "closed",
        closedAt: null,
        outletId: "outlet-1",
      },
      now: NOW,
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("CLOSED_WITHOUT_TIMESTAMP");
  });

  it("reject: closedAt di masa depan (clock drift defensif) → CLOSED_AT_FUTURE", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000);
    const res = getCorrectableTransactionWindow({
      trx: { shiftId: "shift-1", outletId: "outlet-1" },
      shift: shiftClosed(future),
      now: NOW,
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("CLOSED_AT_FUTURE");
  });
});
