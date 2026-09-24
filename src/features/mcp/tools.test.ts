import { beforeEach, describe, expect, it, vi } from "vitest";

/* Report query functions are mocked; the tools must pass their numbers
 * through untouched. Pure shared logic (locked monthly target, income
 * statement, shift gate, tz) runs for real. */

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  counts: {} as Record<string, number>,
}));

vi.mock("@/db/schema", () => {
  const t = (name: string) => new Proxy({ __name: name }, { get: (o, k) => (k in o ? o[k as "__name"] : { table: name, col: k }) });
  return Object.fromEntries(
    ["outlets", "journalRetryQueue", "pendingEntryChanges", "purchaseRequests", "shiftRebalances", "supplierIngredients", "suppliers", "transactionCorrections"].map((n) => [n, t(n)]),
  );
});
vi.mock("drizzle-orm", () => {
  const noop = () => ({});
  return { and: noop, asc: noop, eq: noop, gt: noop, inArray: noop, isNull: noop, lt: noop, lte: noop, sql: noop };
});
vi.mock("@/db", () => {
  const chain = (table: string): unknown => {
    const rows = () =>
      table === "outlets" ? [{ id: "o1", settings: state.settings }] : table === "supplierIngredients" ? [] : [{ n: state.counts[table] ?? 0 }];
    const c: Record<string, unknown> = {};
    for (const m of ["where", "orderBy", "limit", "innerJoin"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(rows()).then(res);
    return c;
  };
  return { db: { select: () => ({ from: (t: { __name: string }) => chain(t.__name) }) } };
});

const q = vi.hoisted(() => ({
  fetchDailySalesReport: vi.fn(),
  fetchSalesRangeReport: vi.fn(),
  fetchItemPerformance: vi.fn(),
  fetchPnlReport: vi.fn(),
  fetchClosingShiftReport: vi.fn(),
  fetchRefundVoidComplimentReport: vi.fn(),
  getAccountBalances: vi.fn(),
  fetchActiveShiftForOutlet: vi.fn(),
  getShiftVarianceThreshold: vi.fn(),
  getCashOnHand: vi.fn(),
  fetchLowStockIngredients: vi.fn(),
  getStockMode: vi.fn(),
}));
vi.mock("@/features/reports/queries", () => q);
vi.mock("@/features/accounting/queries", () => ({ getAccountBalances: q.getAccountBalances }));
vi.mock("@/features/shifts/queries", () => ({ fetchActiveShiftForOutlet: q.fetchActiveShiftForOutlet }));
vi.mock("@/features/finance/queries", () => ({ getShiftVarianceThreshold: q.getShiftVarianceThreshold, getCashOnHand: q.getCashOnHand }));
vi.mock("@/features/inventory/queries", () => ({ fetchLowStockIngredients: q.fetchLowStockIngredients }));
vi.mock("@/features/inventory/flag", () => ({ getStockMode: q.getStockMode }));
vi.mock("@/features/menu/queries", () => ({ fetchMenuItems: vi.fn(async () => ({ items: [] })) }));
vi.mock("@/features/cash/queries", () => ({ fetchExpenses: vi.fn(), fetchExpenseCategories: vi.fn() }));
vi.mock("@/features/creditors/queries", () => ({ listCreditors: vi.fn(async () => []) }));
vi.mock("@/features/internal-debts/queries", () => ({ listInternalDebtParties: vi.fn(async () => []) }));
vi.mock("@/features/purchases/queries", () => ({ fetchTopOutstanding: vi.fn(async () => []) }));

const { MCP_TOOLS } = await import("./tools");
const { handleMcpRequest } = await import("./protocol");

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await handleMcpRequest({ id: 1, method: "tools/call", params: { name, arguments: args } }, MCP_TOOLS);
  const res = (r.body as { result: { content: [{ text: string }]; isError: boolean } }).result;
  return { data: JSON.parse(res.content[0].text), isError: res.isError, size: res.content[0].text.length };
}

const sales = (revenue: number, trx: number) => ({
  date: "x",
  metrics: { revenue, transactionCount: trx, averageTicket: Math.round(revenue / trx), voidedCount: 0, voidedAmount: 0, refundedCount: 0, refundedAmount: 0 },
  byPaymentMethod: [{ method: "cash", count: trx, amount: revenue }],
  byCategory: [],
  topItems: Array.from({ length: 10 }, (_, i) => ({ menuItemId: `m${i}`, name: `Menu ${i}`, quantity: 10 - i, revenue: 1000 * (10 - i) })),
  hourlyDistribution: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  state.settings = { targets: { dailyRevenue: 1_500_000, weeklyRevenue: 10_000_000, monthlyRevenue: 40_000_000, monthlyHistory: { "2026-08": 30_000_000 } } };
  state.counts = {};
  q.fetchDailySalesReport.mockImplementation(async (_o: string, d: string) => (d === "2026-08-15" ? sales(750_000, 14) : sales(500_000, 10)));
  q.fetchSalesRangeReport.mockResolvedValue({ metrics: { revenue: 12_000_000 } });
  q.fetchClosingShiftReport.mockResolvedValue({ rows: [] });
  q.fetchRefundVoidComplimentReport.mockResolvedValue({ anomalies: [] });
  q.fetchActiveShiftForOutlet.mockResolvedValue(null);
  q.getShiftVarianceThreshold.mockResolvedValue(10_000);
  q.fetchLowStockIngredients.mockResolvedValue([]);
  q.getStockMode.mockResolvedValue({ deductOnSale: false, addOnPurchase: false });
});

describe("mcp tools", () => {
  it("every tool is listed read-only", async () => {
    const r = await handleMcpRequest({ id: 1, method: "tools/list" }, MCP_TOOLS);
    const tools = (r.body as { result: { tools: Array<{ name: string; annotations: unknown }> } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual([
      "ringkasan_harian", "pencapaian_target", "penjualan_produk", "laba_rugi", "stok_menipis",
      "hutang", "jatuh_tempo", "saldo_kas", "pengeluaran", "peringatan",
    ]);
    for (const t of tools) expect(t.annotations).toEqual({ readOnlyHint: true });
  });

  it("ringkasan_harian passes the daily report numbers through and keeps teks short", async () => {
    const { data, size } = await call("ringkasan_harian", { tanggal: "2026-08-15" });
    expect(q.fetchDailySalesReport).toHaveBeenCalledWith("o1", "2026-08-15");
    expect(q.fetchDailySalesReport).toHaveBeenCalledWith("o1", "2026-08-08");
    expect(data).toMatchObject({ omzet: 750_000, transaksi: 14, rata_rata: 53_571, persen_target: 50 });
    expect(data.minggu_lalu).toEqual({ tanggal: "2026-08-08", omzet: 500_000, perubahan_persen: 50 });
    expect(data.produk_teratas).toHaveLength(5);
    expect(data.teks.split("\n").length).toBeLessThanOrEqual(12);
    expect(size).toBeLessThan(1500);
  });

  it("pencapaian_target bulan uses the target LOCKED for that month", async () => {
    const { data } = await call("pencapaian_target", { periode: "bulan", tanggal: "2026-08-15" });
    expect(q.fetchSalesRangeReport).toHaveBeenCalledWith("o1", "2026-08-01", "2026-08-15");
    expect(data).toMatchObject({ realisasi: 12_000_000, target: 30_000_000, persen: 40, sisa_hari: 16, butuh_per_hari: 1_125_000 });
  });

  it("pencapaian_target minggu is the dashboard's rolling 7 days", async () => {
    await call("pencapaian_target", { periode: "minggu", tanggal: "2026-08-15" });
    expect(q.fetchSalesRangeReport).toHaveBeenCalledWith("o1", "2026-08-09", "2026-08-15");
  });

  it("laba_rugi equals the accounting income statement and excludes closing entries", async () => {
    q.getAccountBalances.mockResolvedValue([
      { code: "4101", name: "Penjualan", type: "revenue", isContra: false, debitTotal: 0, creditTotal: 10_000_000 },
      { code: "5101", name: "HPP", type: "cogs", isContra: false, debitTotal: 4_000_000, creditTotal: 0 },
      { code: "6101", name: "Gaji", type: "expense", isContra: false, debitTotal: 3_000_000, creditTotal: 0 },
    ]);
    const { data } = await call("laba_rugi", { bulan: "2026-01" });
    expect(q.getAccountBalances).toHaveBeenCalledWith({ outletId: "o1", fromDate: "2026-01-01", toDate: "2026-01-31", excludeClosingEntries: true });
    expect(q.getAccountBalances).toHaveBeenCalledWith(expect.objectContaining({ fromDate: "2025-12-01", toDate: "2025-12-31" }));
    expect(data).toMatchObject({ pendapatan_bersih: 10_000_000, hpp: 4_000_000, laba_kotor: 6_000_000, total_beban: 3_000_000, laba_bersih: 3_000_000 });
  });

  it("limit defaults to 10 and is capped at 50", async () => {
    q.fetchItemPerformance.mockResolvedValue(
      Array.from({ length: 80 }, (_, i) => ({ menuItemId: `m${i}`, name: `M${i}`, categoryName: "c", quantity: i, revenue: i * 100, averageOrderValue: 100, cogs: null, marginPct: null })),
    );
    expect((await call("penjualan_produk")).data.produk).toHaveLength(10);
    expect((await call("penjualan_produk", { limit: 500 })).data.produk).toHaveLength(50);
  });

  it("peringatan is empty when nothing needs action", async () => {
    const { data } = await call("peringatan");
    expect(data.peringatan).toEqual([]);
  });

  it("peringatan flags variance over threshold, stuck journals and a forgotten shift", async () => {
    q.fetchClosingShiftReport.mockResolvedValue({ rows: [{ shiftDate: "2026-08-14", userName: "Sarah", variance: -25_000 }, { shiftDate: "2026-08-14", userName: "Bayu", variance: 5_000 }] });
    state.counts.journalRetryQueue = 2;
    q.fetchActiveShiftForOutlet.mockResolvedValue({ openedAt: new Date(Date.now() - 3 * 86_400_000), openedByName: "Bayu" });
    const kinds = (await call("peringatan")).data.peringatan.map((p: { jenis: string }) => p.jenis);
    expect(kinds).toEqual(["shift_belum_ditutup", "selisih_kas", "jurnal_macet"]);
  });

  it("bad arguments return a short Indonesian error", async () => {
    expect((await call("laba_rugi", { bulan: "2026-13" })).data).toEqual({ error: "bulan harus format YYYY-MM" });
    expect((await call("penjualan_produk", { dari: "2026-09-10", sampai: "2026-09-01" })).isError).toBe(true);
  });
});
