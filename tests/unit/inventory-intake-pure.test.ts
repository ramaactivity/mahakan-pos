import { describe, expect, it } from "vitest";
import {
  entryLagDays,
  findMissingDays,
  groupIntakeByDate,
  groupIntakeByIngredient,
  isLateEntry,
  isOverdue,
  jakartaDayOf,
  summarizeIntake,
  type IntakeLine,
} from "@/features/inventory/intake-pure";

function line(over: Partial<IntakeLine> = {}): IntakeLine {
  return {
    id: "l1",
    source: "gr",
    receiptDate: "2026-07-10",
    purchaseId: "p1",
    purchaseDate: "2026-07-10",
    invoiceNo: null,
    supplierName: "Toko A",
    ingredientId: "i1",
    ingredientName: "Gula",
    unit: "Kg",
    qty: 2,
    unitCost: 15000,
    totalCost: 30000,
    paymentMethod: "cash",
    paymentStatus: "paid",
    dueDate: null,
    paidAt: null,
    enteredAt: "2026-07-10T05:00:00.000Z",
    enteredByName: "Anisa",
    hasReceiptPhoto: false,
    ...over,
  };
}

describe("jakartaDayOf", () => {
  it("memakai kalender WIB, bukan UTC", () => {
    // 2026-07-10 19:30 UTC = 2026-07-11 02:30 WIB → hari berikutnya.
    expect(jakartaDayOf("2026-07-10T19:30:00.000Z")).toBe("2026-07-11");
    expect(jakartaDayOf("2026-07-10T16:00:00.000Z")).toBe("2026-07-10");
  });
});

describe("entryLagDays", () => {
  it("0 kalau diinput di hari yang sama (WIB)", () => {
    expect(entryLagDays(line())).toBe(0);
  });

  it("menghitung jeda hari kalender WIB", () => {
    expect(
      entryLagDays(line({ enteredAt: "2026-07-17T03:00:00.000Z" })),
    ).toBe(7);
  });

  it("tidak terpengaruh input sore hari yang di UTC masih hari sebelumnya", () => {
    // 2026-07-10 23:00 WIB = 16:00 UTC hari yang sama → tetap lag 0.
    expect(
      entryLagDays(line({ enteredAt: "2026-07-10T16:00:00.000Z" })),
    ).toBe(0);
  });

  it("negatif kalau nota di-backdate ke masa depan tidak terjadi; backdate mundur = lag positif", () => {
    const backdated = line({
      receiptDate: "2026-06-01",
      enteredAt: "2026-07-14T03:00:00.000Z",
    });
    expect(entryLagDays(backdated)).toBe(43);
    expect(isLateEntry(backdated)).toBe(true);
  });

  it("tidak menandai telat kalau jeda masih dalam ambang", () => {
    expect(
      isLateEntry(line({ enteredAt: "2026-07-13T03:00:00.000Z" })),
    ).toBe(false);
    expect(
      isLateEntry(line({ enteredAt: "2026-07-14T03:00:00.000Z" })),
    ).toBe(true);
  });
});

describe("isOverdue", () => {
  it("hanya untuk yang belum lunas dan sudah lewat jatuh tempo", () => {
    const unpaid = line({
      paymentStatus: "pending_payment",
      dueDate: "2026-07-15",
    });
    expect(isOverdue(unpaid, "2026-07-16")).toBe(true);
    expect(isOverdue(unpaid, "2026-07-15")).toBe(false);
    expect(
      isOverdue({ ...unpaid, paymentStatus: "paid" }, "2026-07-16"),
    ).toBe(false);
    expect(
      isOverdue({ ...unpaid, dueDate: null }, "2026-07-16"),
    ).toBe(false);
  });
});

describe("groupIntakeByDate", () => {
  const lines = [
    line({ id: "a", receiptDate: "2026-07-10", purchaseId: "p1" }),
    line({
      id: "b",
      receiptDate: "2026-07-10",
      purchaseId: "p1",
      ingredientId: "i2",
      ingredientName: "Ayam",
      totalCost: 50000,
    }),
    line({
      id: "c",
      receiptDate: "2026-07-12",
      purchaseId: "p2",
      supplierName: "Toko B",
      paymentStatus: "pending_payment",
      totalCost: 20000,
      enteredAt: "2026-07-20T03:00:00.000Z",
    }),
  ];

  it("mengelompokkan per tanggal, terbaru dulu", () => {
    const groups = groupIntakeByDate(lines);
    expect(groups.map((g) => g.date)).toEqual(["2026-07-12", "2026-07-10"]);
  });

  it("menghitung nota unik, bukan jumlah baris", () => {
    const groups = groupIntakeByDate(lines);
    const jul10 = groups.find((g) => g.date === "2026-07-10")!;
    expect(jul10.lines).toHaveLength(2);
    expect(jul10.noteCount).toBe(1);
    expect(jul10.ingredientCount).toBe(2);
    expect(jul10.totalCost).toBe(80000);
    expect(jul10.unpaidCost).toBe(0);
  });

  it("mencatat jeda input terlama & nilai belum lunas per hari", () => {
    const jul12 = groupIntakeByDate(lines).find(
      (g) => g.date === "2026-07-12",
    )!;
    expect(jul12.maxLagDays).toBe(8);
    expect(jul12.unpaidCost).toBe(20000);
    expect(jul12.supplierNames).toEqual(["Toko B"]);
  });

  it("memberi label supplier untuk baris tanpa supplier", () => {
    const groups = groupIntakeByDate([line({ supplierName: null })]);
    expect(groups[0].supplierNames).toEqual(["Tanpa supplier"]);
  });
});

describe("groupIntakeByIngredient", () => {
  it("menjumlahkan qty & biaya, mengurutkan dari yang terakhir masuk", () => {
    const groups = groupIntakeByIngredient([
      line({ id: "a", ingredientId: "i1", receiptDate: "2026-07-01", qty: 2 }),
      line({ id: "b", ingredientId: "i1", receiptDate: "2026-07-20", qty: 3 }),
      line({
        id: "c",
        ingredientId: "i2",
        ingredientName: "Ayam",
        receiptDate: "2026-07-05",
        qty: 1,
      }),
    ]);
    expect(groups.map((g) => g.ingredientId)).toEqual(["i1", "i2"]);
    const gula = groups[0];
    expect(gula.totalQty).toBe(5);
    expect(gula.lastDate).toBe("2026-07-20");
    expect(gula.firstDate).toBe("2026-07-01");
    // baris di dalam grup: terbaru dulu
    expect(gula.lines.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("findMissingDays", () => {
  it("mengembalikan tanggal yang tidak punya catatan sama sekali", () => {
    expect(
      findMissingDays("2026-07-01", "2026-07-05", [
        "2026-07-01",
        "2026-07-04",
      ]),
    ).toEqual(["2026-07-02", "2026-07-03", "2026-07-05"]);
  });

  it("kosong kalau semua hari terisi", () => {
    expect(
      findMissingDays("2026-07-01", "2026-07-02", [
        "2026-07-01",
        "2026-07-02",
      ]),
    ).toEqual([]);
  });

  it("menolak rentang terbalik atau tidak valid", () => {
    expect(findMissingDays("2026-07-05", "2026-07-01", [])).toEqual([]);
    expect(findMissingDays("", "2026-07-01", [])).toEqual([]);
  });

  it("di-cap supaya tidak membangkitkan array raksasa", () => {
    expect(findMissingDays("2020-01-01", "2026-01-01", [])).toHaveLength(400);
  });
});

describe("summarizeIntake", () => {
  const today = "2026-07-20";
  const lines = [
    line({ id: "a", purchaseId: "p1", totalCost: 30000 }),
    line({ id: "b", purchaseId: "p1", totalCost: 20000, ingredientId: "i2" }),
    line({
      id: "c",
      purchaseId: "p2",
      totalCost: 40000,
      paymentStatus: "pending_payment",
      dueDate: "2026-07-15",
      enteredAt: "2026-07-19T03:00:00.000Z",
      receiptDate: "2026-07-12",
    }),
  ];

  it("menghitung nota unik & total nilai", () => {
    const s = summarizeIntake(lines, today);
    expect(s.lineCount).toBe(3);
    expect(s.noteCount).toBe(2);
    expect(s.ingredientCount).toBe(2);
    expect(s.totalCost).toBe(90000);
    expect(s.daysWithData).toBe(2);
  });

  it("menjumlahkan hutang per nota, bukan per baris", () => {
    const s = summarizeIntake(lines, today);
    expect(s.unpaidCost).toBe(40000);
    expect(s.unpaidNoteCount).toBe(1);
    expect(s.overdueNoteCount).toBe(1);
  });

  it("menandai nota yang telat diinput", () => {
    const s = summarizeIntake(lines, today);
    expect(s.lateNoteCount).toBe(1);
  });

  it("aman untuk daftar kosong", () => {
    const s = summarizeIntake([], today);
    expect(s).toMatchObject({
      lineCount: 0,
      noteCount: 0,
      totalCost: 0,
      unpaidCost: 0,
      daysWithData: 0,
    });
  });
});
