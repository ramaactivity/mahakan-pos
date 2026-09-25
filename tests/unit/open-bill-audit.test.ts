import { describe, expect, it } from "vitest";
import {
  diffAuditLines,
  formatChanges,
  toAuditLines,
} from "@/features/transactions/open-bill-audit";

describe("open bill audit diff (AE-234)", () => {
  it("shows an item swap that keeps item count equal", () => {
    const before = toAuditLines([
      { itemName: "Pablo Eskopi", variant: "iced", quantity: 1, subtotal: 24000 },
    ]);
    const after = toAuditLines([
      { itemName: "Americano", variant: "iced", quantity: 1, subtotal: 16000 },
    ]);
    const d = diffAuditLines(before, after);
    expect(formatChanges(d.removed)).toBe("1× Pablo Eskopi (iced)");
    expect(formatChanges(d.added)).toBe("1× Americano (iced)");
  });

  it("nets quantity changes and ignores unchanged lines", () => {
    const d = diffAuditLines(
      [{ name: "Americano", qty: 2, subtotal: 32000 }, { name: "Air", qty: 1, subtotal: 5000 }],
      [{ name: "Americano", qty: 1, subtotal: 16000 }, { name: "Air", qty: 1, subtotal: 5000 }],
    );
    expect(d.removed).toEqual([{ name: "Americano", qty: 1 }]);
    expect(d.added).toEqual([]);
  });
});

describe("audit export records (AE-234)", async () => {
  const { toAuditRecords, auditRecordToCsvRow, buildAuditStyledSheets } = await import(
    "@/features/admin/sections/audit-export"
  );
  const row = {
    id: "1",
    eventType: "transaction.open_bill.edit",
    createdAt: new Date("2026-09-24T16:25:31Z"),
    userId: null,
    userName: "Galih",
    userRole: "manager",
    approverId: null,
    approverName: null,
    entityType: "transaction",
    entityId: "t1",
    payload: {
      summary: "x",
      before: { total: 24000, customerName: "Kapras", items: [{ name: "Pablo Eskopi (iced)", qty: 1, subtotal: 24000 }] },
      after: { total: 16000, customerName: "Kapras", items: [{ name: "Americano (iced)", qty: 1, subtotal: 16000 }] },
      context: { transactionNumber: "TRX-20260924-0003", removed: [{ name: "Pablo Eskopi (iced)", qty: 1 }], added: [] },
    },
    metadata: null,
  };

  it("uses WIB date/time, human labels and flags the reduction", () => {
    const [x] = toAuditRecords([row]);
    expect(x!.dateText).toBe("24/09/2026");
    expect(x!.time).toBe("23:25:31");
    expect(x!.date.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(x!.activity).toBe("Edit bill");
    expect(x!.delta).toBe(-8000);
    expect(x!.tone).toBe("danger");
    expect(auditRecordToCsvRow(x!)["Item Dihapus"]).toBe("1× Pablo Eskopi (iced)");
  });

  it("builds summary, log and reduced sheets", () => {
    const sheets = buildAuditStyledSheets(toAuditRecords([row]), {
      from: "2026-09-01",
      to: "2026-09-25",
      filter: "semua aktivitas",
    });
    expect(sheets.map((s) => s.name)).toEqual(["Ringkasan", "Audit Log", "Bill Diedit Turun"]);
  });
});
