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

describe("audit export rows (AE-234)", async () => {
  const { buildAuditSheets } = await import("@/features/admin/sections/audit-export");
  it("flattens an open bill edit and lists it in the reduced sheet", () => {
    const sheets = buildAuditSheets([
      {
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
      },
    ]);
    const row = sheets[0]!.rows[0]!;
    expect(row["Jam (WIB)"]).toBe("23.25.31");
    expect(row.Selisih).toBe(-8000);
    expect(row["Item Dihapus"]).toBe("1× Pablo Eskopi (iced)");
    expect(sheets[1]!.name).toBe("Bill Diedit Turun");
  });
});
