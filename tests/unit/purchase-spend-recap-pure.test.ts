import { describe, expect, it } from "vitest";
import {
  buildSpendRecap,
  formatDayLabel,
  formatMonthLabel,
  formatRangeLabel,
  groupSpendLines,
  inclusiveDays,
  matchesSpendFilters,
  normalizeSpendPaymentMethod,
  normalizeSpendSection,
  previousRangeOf,
  spendDeltaPercent,
  spendFilterOptions,
  summarizeSpend,
  SUPPLIER_NONE,
  type SpendLine,
} from "@/features/purchases/spend-recap-pure";

function line(over: Partial<SpendLine> = {}): SpendLine {
  return {
    id: "l1",
    source: "gr",
    date: "2026-08-10",
    purchaseId: "p1",
    purchaseDate: "2026-08-09",
    invoiceNo: null,
    supplierId: "s1",
    supplierName: "Toko A",
    ingredientId: "i1",
    ingredientName: "Gula",
    unit: "Kg",
    section: "kitchen",
    qty: 2,
    amount: 30_000,
    paymentMethod: "cash",
    paymentStatus: "paid",
    ...over,
  };
}

describe("normalisasi", () => {
  it("section tak dikenal / NULL jatuh ke 'unassigned'", () => {
    expect(normalizeSpendSection(null)).toBe("unassigned");
    expect(normalizeSpendSection("")).toBe("unassigned");
    expect(normalizeSpendSection("gudang")).toBe("unassigned");
    expect(normalizeSpendSection("bar")).toBe("bar");
  });

  it("metode bayar tak dikenal jatuh ke 'cash', bukan crash", () => {
    expect(normalizeSpendPaymentMethod(undefined)).toBe("cash");
    expect(normalizeSpendPaymentMethod("top")).toBe("top");
  });
});

describe("label tanggal", () => {
  it("bulan dan hari dalam bahasa Indonesia", () => {
    expect(formatMonthLabel("2026-08")).toBe("Agu 2026");
    expect(formatDayLabel("2026-08-26")).toBe("26 Agu 2026");
  });

  it("input tak valid dikembalikan apa adanya (tidak melempar)", () => {
    expect(formatMonthLabel("bukan-bulan")).toBe("bukan-bulan");
    expect(formatDayLabel("")).toBe("");
  });

  it("rentang dipadatkan kalau bulan atau tahunnya sama", () => {
    expect(formatRangeLabel("2026-08-01", "2026-08-26")).toBe("1 – 26 Agu 2026");
    expect(formatRangeLabel("2026-07-01", "2026-08-26")).toBe("1 Jul – 26 Agu 2026");
    expect(formatRangeLabel("2026-08-05", "2026-08-05")).toBe("5 Agu 2026");
  });
});

describe("periode pembanding", () => {
  it("panjangnya sama persis dan menempel sebelum rentang terpilih", () => {
    // 1–31 Agu = 31 hari → pembanding 1–31 Jul.
    expect(previousRangeOf("2026-08-01", "2026-08-31")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("berlaku juga untuk rentang bebas (bukan bulan kalender)", () => {
    // 10–19 Agu = 10 hari → 31 Jul – 9 Agu.
    expect(previousRangeOf("2026-08-10", "2026-08-19")).toEqual({
      from: "2026-07-31",
      to: "2026-08-09",
    });
  });

  it("inclusiveDays menghitung kedua ujungnya", () => {
    expect(inclusiveDays("2026-08-01", "2026-08-01")).toBe(1);
    expect(inclusiveDays("2026-08-01", "2026-08-31")).toBe(31);
  });
});

describe("penyaringan", () => {
  it("supplier kosong dicocokkan lewat sentinel, bukan string kosong", () => {
    const pasar = line({ supplierId: null, supplierName: null });
    expect(matchesSpendFilters(pasar, { supplierId: SUPPLIER_NONE })).toBe(true);
    expect(matchesSpendFilters(line(), { supplierId: SUPPLIER_NONE })).toBe(false);
  });

  it("pencarian menjangkau nama bahan, supplier, dan nomor nota", () => {
    const l = line({ invoiceNo: "INV-991", supplierName: "Toko Berkah" });
    expect(matchesSpendFilters(l, { search: "berkah" })).toBe(true);
    expect(matchesSpendFilters(l, { search: "inv-99" })).toBe(true);
    expect(matchesSpendFilters(l, { search: "gula" })).toBe(true);
    expect(matchesSpendFilters(l, { search: "kopi" })).toBe(false);
  });

  it("'all' dan nilai kosong tidak menyaring apa pun", () => {
    expect(matchesSpendFilters(line(), {})).toBe(true);
    expect(
      matchesSpendFilters(line(), {
        section: "all",
        paymentMethod: "all",
        paymentStatus: "all",
        search: "   ",
      }),
    ).toBe(true);
  });
});

describe("pengelompokan", () => {
  const lines = [
    line({ id: "a", amount: 100_000, section: "kitchen", ingredientId: "i1" }),
    line({
      id: "b",
      amount: 300_000,
      section: "bar",
      ingredientId: "i2",
      ingredientName: "Kopi",
      purchaseId: "p2",
      date: "2026-09-02",
    }),
    line({ id: "c", amount: 100_000, section: "kitchen", ingredientId: "i1", purchaseId: "p2" }),
  ];

  it("dimensi non-waktu diurut dari rupiah terbesar", () => {
    const rows = groupSpendLines(lines, "section");
    // section punya urutan tetapnya sendiri (dapur dulu), bukan rupiah.
    expect(rows.map((r) => r.key)).toEqual(["kitchen", "bar"]);
    const byIngredient = groupSpendLines(lines, "ingredient");
    expect(byIngredient[0].key).toBe("i2");
  });

  it("bulan dan tanggal diurut kronologis untuk grafik tren", () => {
    expect(groupSpendLines(lines, "month").map((r) => r.key)).toEqual([
      "2026-08",
      "2026-09",
    ]);
  });

  it("nota yang sama tidak dihitung dua kali", () => {
    const kitchen = groupSpendLines(lines, "section")[0];
    expect(kitchen.amount).toBe(200_000);
    expect(kitchen.lineCount).toBe(2);
    expect(kitchen.purchaseCount).toBe(2); // p1 + p2
  });

  it("porsi memakai total yang dioper, bukan total kelompoknya sendiri", () => {
    const rows = groupSpendLines(lines, "section", 1_000_000);
    expect(rows[0].share).toBeCloseTo(0.2);
  });

  it("qty TIDAK dijumlahkan kalau satuannya campur", () => {
    const campur = [
      line({ id: "x", unit: "Kg", qty: 2, ingredientId: "i9", section: "bar" }),
      line({ id: "y", unit: "Pcs", qty: 5, ingredientId: "i9", section: "bar" }),
    ];
    const row = groupSpendLines(campur, "ingredient")[0];
    expect(row.qty).toBeNull();
    expect(row.unit).toBeNull();
    expect(row.avgUnitCost).toBeNull();
  });

  it("harga rata-rata dihitung saat satuannya seragam", () => {
    const seragam = [
      line({ id: "x", unit: "Kg", qty: 2, amount: 30_000 }),
      line({ id: "y", unit: "Kg", qty: 1, amount: 15_000 }),
    ];
    const row = groupSpendLines(seragam, "ingredient")[0];
    expect(row.qty).toBe(3);
    expect(row.avgUnitCost).toBe(15_000);
  });

  it("belanja tanpa supplier tetap punya kelompok sendiri", () => {
    const rows = groupSpendLines(
      [line({ supplierId: null, supplierName: null })],
      "supplier",
    );
    expect(rows[0].key).toBe(SUPPLIER_NONE);
    expect(rows[0].label).toContain("Tanpa supplier");
  });
});

describe("ringkasan", () => {
  it("menghitung nota/bahan/supplier unik dan hari yang benar-benar belanja", () => {
    const s = summarizeSpend(
      [
        line({ id: "a", amount: 100_000, date: "2026-08-01" }),
        line({ id: "b", amount: 300_000, date: "2026-08-01", purchaseId: "p2", ingredientId: "i2" }),
        line({ id: "c", amount: 100_000, date: "2026-08-05", purchaseId: "p3", supplierId: "s2" }),
      ],
      { from: "2026-08-01", to: "2026-08-31" },
    );
    expect(s.total).toBe(500_000);
    expect(s.purchaseCount).toBe(3);
    expect(s.ingredientCount).toBe(2);
    expect(s.supplierCount).toBe(2);
    expect(s.activeDays).toBe(2);
    expect(s.rangeDays).toBe(31);
    expect(s.avgPerActiveDay).toBe(250_000);
  });

  it("memisahkan yang sudah lunas dari yang masih hutang", () => {
    const s = summarizeSpend(
      [
        line({ id: "a", amount: 100_000, paymentStatus: "paid" }),
        line({ id: "b", amount: 40_000, paymentStatus: "pending_payment" }),
      ],
      { from: "2026-08-01", to: "2026-08-31" },
    );
    expect(s.paidTotal).toBe(100_000);
    expect(s.unpaidTotal).toBe(40_000);
  });

  it("tidak membagi nol saat tidak ada belanja", () => {
    const s = summarizeSpend([], { from: "2026-08-01", to: "2026-08-31" });
    expect(s.total).toBe(0);
    expect(s.avgPerActiveDay).toBe(0);
    expect(s.avgPerPurchase).toBe(0);
    expect(s.firstDate).toBeNull();
  });
});

describe("spendDeltaPercent", () => {
  it("null kalau tidak ada pembanding atau pembandingnya nol", () => {
    expect(spendDeltaPercent(100, null)).toBeNull();
    expect(spendDeltaPercent(100, 0)).toBeNull();
  });

  it("positif berarti belanja naik", () => {
    expect(spendDeltaPercent(150, 100)).toBeCloseTo(50);
    expect(spendDeltaPercent(50, 100)).toBeCloseTo(-50);
  });
});

describe("buildSpendRecap", () => {
  const lines = [
    line({ id: "a", amount: 100_000, section: "kitchen" }),
    line({
      id: "b",
      amount: 300_000,
      section: "bar",
      ingredientId: "i2",
      ingredientName: "Kopi",
      supplierId: "s2",
      supplierName: "Toko B",
    }),
  ];
  const base = {
    lines,
    previousLines: [line({ id: "z", amount: 200_000, section: "kitchen" })],
    range: { from: "2026-08-01", to: "2026-08-31" },
    previousRange: { from: "2026-07-01", to: "2026-07-31" },
    pendingOrders: { count: 1, amount: 50_000 },
    truncated: false,
    cutoffApplied: null,
    dateBasis: "receipt" as const,
  };

  it("total hanya menghitung baris yang lolos filter", () => {
    const r = buildSpendRecap({ ...base, filters: { section: "bar" } });
    expect(r.summary.total).toBe(300_000);
    expect(r.bySection).toHaveLength(1);
  });

  it("periode pembanding memakai FILTER YANG SAMA", () => {
    // Baris pembanding satu-satunya ada di section 'kitchen'; saat rekap
    // disaring ke 'bar', pembandingnya harus 0 — bukan 200rb, yang akan
    // tampil sebagai "belanja bar turun 100%".
    const r = buildSpendRecap({ ...base, filters: { section: "bar" } });
    expect(r.previousTotal).toBe(0);
    const semua = buildSpendRecap({ ...base, filters: {} });
    expect(semua.previousTotal).toBe(200_000);
  });

  it("pembanding null saat rentangnya tidak ada", () => {
    const r = buildSpendRecap({ ...base, filters: {}, previousRange: null });
    expect(r.previousTotal).toBeNull();
    expect(r.previousFrom).toBeNull();
  });

  it("isi dropdown diambil dari SELURUH baris, bukan yang tersaring", () => {
    // Kalau ikut menyusut, memilih satu bahan akan mengosongkan dropdownnya
    // sendiri sehingga filter tidak bisa diganti tanpa reset.
    const r = buildSpendRecap({ ...base, filters: { ingredientId: "i1" } });
    expect(r.ingredientOptions.map((o) => o.value).sort()).toEqual(["i1", "i2"]);
    expect(r.summary.total).toBe(100_000);
  });

  it("PO menggantung dilaporkan terpisah, di luar total", () => {
    const r = buildSpendRecap({ ...base, filters: {} });
    expect(r.summary.total).toBe(400_000);
    expect(r.pendingOrders).toEqual({ count: 1, amount: 50_000 });
  });

  it("porsi tiap dimensi berjumlah 100% dari total yang sama", () => {
    const r = buildSpendRecap({ ...base, filters: {} });
    for (const rows of [r.bySection, r.byIngredient, r.bySupplier, r.byMonth]) {
      const sum = rows.reduce((s, x) => s + x.share, 0);
      expect(sum).toBeCloseTo(1);
    }
  });
});

describe("spendFilterOptions", () => {
  it("diurut dari rupiah terbesar supaya yang penting di atas", () => {
    const { ingredientOptions } = spendFilterOptions([
      line({ id: "a", ingredientId: "i1", amount: 10_000 }),
      line({ id: "b", ingredientId: "i2", ingredientName: "Kopi", amount: 90_000 }),
    ]);
    expect(ingredientOptions[0].label).toBe("Kopi");
    expect(ingredientOptions[0].amount).toBe(90_000);
  });
});
