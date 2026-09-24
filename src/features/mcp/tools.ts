import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  journalRetryQueue,
  outlets,
  pendingEntryChanges,
  purchaseRequests,
  shiftRebalances,
  supplierIngredients,
  suppliers,
  transactionCorrections,
} from "@/db/schema";
import { getAccountBalances } from "@/features/accounting/queries";
import { buildIncomeStatement } from "@/features/accounting/reports";
import { fetchExpenseCategories, fetchExpenses } from "@/features/cash/queries";
import { listCreditors } from "@/features/creditors/queries";
import { getCashOnHand, getShiftVarianceThreshold } from "@/features/finance/queries";
import { listInternalDebtParties } from "@/features/internal-debts/queries";
import { getStockMode } from "@/features/inventory/flag";
import { fetchLowStockIngredients } from "@/features/inventory/queries";
import { fetchMenuItems } from "@/features/menu/queries";
import { fetchTopOutstanding } from "@/features/purchases/queries";
import {
  fetchClosingShiftReport,
  fetchDailySalesReport,
  fetchItemPerformance,
  fetchPnlReport,
  fetchRefundVoidComplimentReport,
  fetchSalesRangeReport,
} from "@/features/reports/queries";
import { resolveMonthlyTarget } from "@/features/reports/target-history-pure";
import { computeShiftGateVerdict, parseShiftGateThresholds } from "@/features/shifts/day-gate-pure";
import { fetchActiveShiftForOutlet } from "@/features/shifts/queries";
import { resolveStockDecimal } from "@/lib/stock-decimal";
import {
  addDaysJakarta,
  jakartaDateOf,
  jakartaMinutesOf,
  monthEndJakarta,
  todayJakarta,
} from "@/lib/tz";
import { displayUnit } from "@/lib/unit-conversion";
import { ToolError, type McpTool } from "./protocol";

/**
 * Read-only tools for the Hermes `mahakan` agent.
 *
 * RULE: every number comes from the SAME query function the back-office
 * screen uses (named in each section). Never re-derive revenue, HPP, profit
 * or stock here — if a screen changes its formula, MCP follows. The only
 * inline queries are alert COUNTs whose original lives in a "use server"
 * action (exporting an outletId-taking helper from there would create an
 * unauthenticated server action); each names its source.
 */

// ── helpers ─────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

function dateArg(v: unknown, fallback: string, field = "tanggal"): string {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    throw new ToolError(`${field} harus format YYYY-MM-DD`);
  }
  return v;
}

export function limitArg(v: unknown, def = 10): number {
  const n = typeof v === "number" ? v : Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return def;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

function enumArg<T extends string>(v: unknown, allowed: readonly T[], def: T, field: string): T {
  if (v === undefined || v === null || v === "") return def;
  if (!allowed.includes(v as T)) throw new ToolError(`${field} harus salah satu: ${allowed.join(", ")}`);
  return v as T;
}

/** "2026-09-24T21:05:00+07:00" — ISO in WIB. */
export function nowWibIso(at: Date = new Date()): string {
  return `${new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;
}

function meta(periode: string | { dari: string; sampai: string }) {
  return { periode, dihitung_pada: nowWibIso() };
}

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/** Mahakan is single-outlet; take the oldest live outlet (cron jobs loop the same set). */
async function getOutlet() {
  const [row] = await db
    .select({ id: outlets.id, settings: outlets.settings })
    .from(outlets)
    .where(isNull(outlets.deletedAt))
    .orderBy(asc(outlets.createdAt))
    .limit(1);
  if (!row) throw new ToolError("Outlet belum ada");
  return { id: row.id, settings: row.settings ?? {} };
}
type Outlet = Awaited<ReturnType<typeof getOutlet>>;

// ── pencapaian_target ───────────────────────────────────────────────────────

type Periode = "hari" | "minggu" | "bulan";

/**
 * Mirrors the dashboard "Target Pendapatan" card (reports/target-progress.ts):
 * minggu = ROLLING 7 days ending `tanggal`; bulan = month-to-date with the
 * target LOCKED for that month (AE-223). Revenue via fetchSalesRangeReport —
 * same net formula as the card (total − refunded, paid + partially_refunded).
 */
export async function targetProgress(periode: Periode, tanggal: string, outlet?: Outlet) {
  const o = outlet ?? (await getOutlet());
  const targets = o.settings.targets ?? {};
  const from =
    periode === "hari" ? tanggal : periode === "minggu" ? addDaysJakarta(tanggal, -6) : `${tanggal.slice(0, 7)}-01`;
  const realisasi = (await fetchSalesRangeReport(o.id, from, tanggal)).metrics.revenue;

  let target: number | null;
  let catatan: string | undefined;
  if (periode === "bulan") {
    const r = resolveMonthlyTarget(tanggal.slice(0, 7), targets);
    target = r.target;
    if (!r.fromHistory && tanggal.slice(0, 7) !== todayJakarta().slice(0, 7)) {
      catatan = "Target bulan itu tidak dikunci; memakai target yang berlaku sekarang.";
    }
  } else {
    target = (periode === "hari" ? targets.dailyRevenue : targets.weeklyRevenue) ?? null;
    if (tanggal !== todayJakarta()) catatan = "Target harian/mingguan tidak punya riwayat; memakai target sekarang.";
  }
  if (!target || target <= 0) target = null;

  const out: Record<string, unknown> = {
    ...meta({ dari: from, sampai: tanggal }),
    realisasi,
    target,
    persen: target ? pct(realisasi, target) : null,
  };
  if (target) out.kurang = Math.max(0, target - realisasi);
  if (periode === "bulan" && target) {
    // Days left AFTER `tanggal`.
    const sisaHari = daysBetween(tanggal, monthEndJakarta(tanggal));
    out.sisa_hari = sisaHari;
    if (sisaHari > 0 && realisasi < target) out.butuh_per_hari = Math.ceil((target - realisasi) / sisaHari);
  }
  if (periode === "minggu") out.catatan_minggu = "7 hari bergulir s.d. tanggal, sama dengan kartu dashboard.";
  if (catatan) out.catatan = catatan;
  return out;
}

// ── penjualan_produk ────────────────────────────────────────────────────────

const URUT = ["omzet", "qty", "margin", "terendah"] as const;

/** Laporan → Performa Item (fetchItemPerformance). HPP = snapshot at sale. */
async function productSales(dari: string, sampai: string, urut: (typeof URUT)[number], limit: number) {
  const outlet = await getOutlet();
  // 500 = same cap the Menu Engineering view uses; Mahakan has ~45 SKUs.
  const rows = await fetchItemPerformance(outlet.id, dari, sampai, "revenue", 500);
  const mapped = rows.map((r) => ({
    produk: r.name,
    qty: r.quantity,
    omzet: r.revenue,
    ...(r.cogs !== null ? { hpp: r.cogs, margin_persen: r.marginPct } : {}),
  }));

  if (urut === "terendah") {
    const sold = new Set(rows.map((r) => r.menuItemId));
    const { items } = await fetchMenuItems({ activeOnly: true });
    const unsold = items.filter((m) => !sold.has(m.id)).map((m) => ({ produk: m.name, qty: 0, omzet: 0 }));
    const lowest = [...mapped].sort((a, b) => a.omzet - b.omzet);
    return { ...meta({ dari, sampai }), urut, tidak_laku: unsold.length, produk: [...unsold, ...lowest].slice(0, limit) };
  }
  if (urut === "qty") mapped.sort((a, b) => b.qty - a.qty);
  if (urut === "margin") mapped.sort((a, b) => (b.margin_persen ?? -1) - (a.margin_persen ?? -1));
  return { ...meta({ dari, sampai }), urut, produk_terjual: rows.length, produk: mapped.slice(0, limit) };
}

// ── laba_rugi ───────────────────────────────────────────────────────────────

/** Akuntansi → Laba Rugi (fetchIncomeStatement): GL balances, closing entries excluded. */
async function incomeStatement(outletId: string, month: string) {
  const balances = await getAccountBalances({
    outletId,
    fromDate: `${month}-01`,
    toDate: monthEndJakarta(`${month}-01`),
    excludeClosingEntries: true,
  });
  return buildIncomeStatement(balances, month);
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

async function profitAndLoss(month: string) {
  const outlet = await getOutlet();
  const [cur, prev] = await Promise.all([
    incomeStatement(outlet.id, month),
    incomeStatement(outlet.id, prevMonth(month)),
  ]);
  const out: Record<string, unknown> = {
    ...meta(month),
    pendapatan_bersih: cur.netRevenue,
    hpp: cur.cogs.subtotal,
    laba_kotor: cur.grossProfit,
    margin_kotor_persen: pct(cur.grossProfit, cur.netRevenue),
    total_beban: cur.expenses.subtotal,
    beban_terbesar: [...cur.expenses.items]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((i) => ({ akun: i.name, jumlah: i.amount })),
    laba_bersih: cur.netIncome,
    bulan_lalu: { pendapatan_bersih: prev.netRevenue, laba_kotor: prev.grossProfit, laba_bersih: prev.netIncome },
  };
  if (month === todayJakarta().slice(0, 7)) {
    out.catatan = "Bulan berjalan: HPP periodik baru lengkap setelah opname & tutup buku.";
  }
  return out;
}

// ── stok_menipis ────────────────────────────────────────────────────────────

/** Inventori → filter "Stok rendah" (fetchLowStockIngredients). */
async function lowStock(limit: number, outlet?: Outlet) {
  const o = outlet ?? (await getOutlet());
  const [rows, mode] = await Promise.all([fetchLowStockIngredients(o.id), getStockMode(o.id)]);
  const shown = rows.slice(0, limit);

  const supplierByIngredient = new Map<string, string>();
  if (shown.length > 0) {
    const links = await db
      .select({ ingredientId: supplierIngredients.ingredientId, name: suppliers.name })
      .from(supplierIngredients)
      .innerJoin(suppliers, eq(suppliers.id, supplierIngredients.supplierId))
      .where(inArray(supplierIngredients.ingredientId, shown.map((i) => i.id)));
    for (const l of links) if (!supplierByIngredient.has(l.ingredientId)) supplierByIngredient.set(l.ingredientId, l.name);
  }

  const out: Record<string, unknown> = {
    ...meta(todayJakarta()),
    jumlah: rows.length,
    bahan: shown.map((i) => {
      const supplier = supplierByIngredient.get(i.id);
      return {
        nama: i.name,
        sisa: resolveStockDecimal(i.currentStock, i.currentStockDecimal),
        batas: i.reorderThreshold,
        satuan: displayUnit(i.unit),
        ...(supplier ? { supplier } : {}),
      };
    }),
  };
  if (!mode.deductOnSale) {
    out.catatan = "Mode stok periodik: sisa = hasil opname terakhir, tidak berkurang per penjualan. Perkiraan habis tidak tersedia.";
  }
  return out;
}

// ── hutang & jatuh_tempo ────────────────────────────────────────────────────

/**
 * Keuangan → Kreditur (listCreditors), Hutang Dagang (fetchTopOutstanding),
 * Hutang Internal (listInternalDebtParties). Internal debts have no due date.
 */
async function payables(onlyOverdue: boolean, limit: number) {
  const outlet = await getOutlet();
  const today = todayJakarta();
  const [creditors, trade, internal] = await Promise.all([
    listCreditors({ outletId: outlet.id, status: "active" }),
    fetchTopOutstanding(outlet.id, today),
    listInternalDebtParties({ outletId: outlet.id, status: "active" }),
  ]);

  const late = (due: string | null) => (due && due < today ? daysBetween(due, today) : undefined);
  const kreditur = creditors
    .filter((c) => c.principalOutstanding > 0)
    .map((c) => ({ pihak: c.nickname || c.fullName, sisa: c.principalOutstanding, jatuh_tempo: c.dueDate ?? undefined, telat_hari: late(c.dueDate) }))
    // Nearest due first (no due date last), then biggest balance.
    .sort((a, b) => (a.jatuh_tempo ?? "9999").localeCompare(b.jatuh_tempo ?? "9999") || b.sisa - a.sisa);
  const dagang = trade.map((p) => ({
    pihak: p.supplierName ?? "Tanpa supplier",
    nota: p.invoiceNo ?? undefined,
    sisa: p.totalAmount,
    jatuh_tempo: p.dueDate ?? undefined,
    telat_hari: late(p.dueDate),
  }));
  const internalRows = internal
    .filter((p) => p.totalOutstanding > 0)
    .map((p) => ({ pihak: p.name, sisa: p.totalOutstanding }));

  const group = <T extends { sisa: number; telat_hari?: number }>(rows: T[]) => {
    const r = onlyOverdue ? rows.filter((x) => x.telat_hari !== undefined) : rows;
    return { total: r.reduce((s, x) => s + x.sisa, 0), jumlah: r.length, daftar: r.slice(0, limit) };
  };
  return {
    ...meta(today),
    status: onlyOverdue ? "telat" : "belum_lunas",
    kreditur: group(kreditur),
    hutang_dagang: group(dagang),
    ...(onlyOverdue ? {} : { hutang_internal: group(internalRows) }),
  };
}

async function dueSoon(days: number) {
  const outlet = await getOutlet();
  const today = todayJakarta();
  const until = addDaysJakarta(today, days);
  const [creditors, trade] = await Promise.all([
    listCreditors({ outletId: outlet.id, status: "active" }),
    fetchTopOutstanding(outlet.id, today),
  ]);
  const items = [
    ...creditors
      .filter((c) => c.principalOutstanding > 0 && c.dueDate && c.dueDate <= until)
      .map((c) => ({ jenis: "kreditur", pihak: c.nickname || c.fullName, jumlah: c.principalOutstanding, jatuh_tempo: c.dueDate as string })),
    ...trade
      .filter((p) => p.dueDate && p.dueDate <= until)
      .map((p) => ({ jenis: "hutang_dagang", pihak: p.supplierName ?? "Tanpa supplier", jumlah: p.totalAmount, jatuh_tempo: p.dueDate as string })),
  ]
    .sort((a, b) => a.jatuh_tempo.localeCompare(b.jatuh_tempo))
    .map((i) => ({ ...i, sisa_hari: daysBetween(today, i.jatuh_tempo) }));
  return {
    ...meta({ dari: today, sampai: until }),
    total: items.reduce((s, i) => s + i.jumlah, 0),
    daftar: items.slice(0, 50),
    catatan: "Negatif sisa_hari = sudah lewat. Tagihan rutin & jadwal bagi hasil investor belum dicatat di aplikasi.",
  };
}

// ── saldo_kas ───────────────────────────────────────────────────────────────

/**
 * Akuntansi → Neraca (getAccountBalances, cumulative from the books cutoff)
 * for kas 110x / bank 111x / piutang cashless 112x; Setoran Tunai screen
 * (getCashOnHand) for cash not yet deposited.
 */
async function cashBalances() {
  const outlet = await getOutlet();
  const today = todayJakarta();
  const [balances, onHand] = await Promise.all([
    getAccountBalances({ outletId: outlet.id, fromDate: null, toDate: today }),
    getCashOnHand(outlet.id),
  ]);
  const debitNet = (b: { debitTotal: number; creditTotal: number }) => b.debitTotal - b.creditTotal;
  const accounts = balances
    .filter((b) => b.type === "asset" && /^11[01]\d$/.test(b.code))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((b) => ({ akun: b.name, saldo: debitNet(b) }));
  const piutang = balances
    .filter((b) => b.type === "asset" && /^112\d$/.test(b.code))
    .map((b) => ({ akun: b.name, saldo: debitNet(b) }))
    .filter((b) => b.saldo !== 0);
  return {
    ...meta(today),
    akun: accounts,
    total_kas_bank: accounts.reduce((s, a) => s + a.saldo, 0),
    piutang_cashless_belum_cair: { total: piutang.reduce((s, a) => s + a.saldo, 0), daftar: piutang },
    kas_fisik_belum_disetor: onHand.cashOnHand - onHand.pendingDepositsAmount,
    setoran_menunggu_verifikasi: { jumlah: onHand.pendingDepositCount, total: onHand.pendingDepositsAmount },
  };
}

// ── pengeluaran ─────────────────────────────────────────────────────────────

/** Laporan → Laba Rugi Operasional per kategori (fetchPnlReport) + Pengeluaran list (fetchExpenses). */
async function expensesReport(dari: string, sampai: string, kategori: string | undefined) {
  const outlet = await getOutlet();
  const [pnl, cats] = await Promise.all([fetchPnlReport(outlet.id, dari, sampai), fetchExpenseCategories(outlet.id)]);
  const needle = kategori?.toLowerCase().trim();
  const matchCats = needle ? cats.items.filter((c) => c.name.toLowerCase().includes(needle)) : cats.items;
  if (needle && matchCats.length === 0) throw new ToolError(`Kategori "${kategori}" tidak ditemukan`);
  const catIds = new Set(matchCats.map((c) => c.id));
  const catName = new Map(cats.items.map((c) => [c.id, c.name]));

  const perKategori = pnl.expenses.byCategory.filter((c) => !needle || c.name.toLowerCase().includes(needle));
  // ponytail: 1000-row cap is ~5 months of Mahakan expenses; top-5 is exact below that.
  const { items } = await fetchExpenses(outlet.id, { from: dari, to: sampai, limit: 1000 });
  const top = items
    .filter((e) => catIds.has(e.categoryId))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((e) => ({ tanggal: e.expenseDate, kategori: catName.get(e.categoryId), keterangan: e.description, jumlah: e.amount }));
  return {
    ...meta({ dari: pnl.period.from, sampai }),
    total: perKategori.reduce((s, c) => s + c.amount, 0),
    per_kategori: perKategori.map((c) => ({ kategori: c.name, jumlah: c.amount })),
    terbesar: top,
    ...(pnl.period.from !== dari ? { catatan: `Dimulai dari batas buku ${pnl.period.from}.` } : {}),
  };
}

// ── peringatan ──────────────────────────────────────────────────────────────

type Alert = { jenis: string; pesan: string };

/** Only things that need action NOW. Empty list = Hermes stays silent. */
export async function alerts(outlet?: Outlet): Promise<Alert[]> {
  const o = outlet ?? (await getOutlet());
  const now = new Date();
  const today = jakartaDateOf(now);
  const yesterday = addDaysJakarta(today, -1);
  const out: Alert[] = [];

  const [shift, threshold, closing, rvc, approvals, prAging, stuckJournals, mode] = await Promise.all([
    fetchActiveShiftForOutlet(o.id),
    getShiftVarianceThreshold(o.id),
    fetchClosingShiftReport(o.id, yesterday, today, 0).then((r) => r.rows),
    fetchRefundVoidComplimentReport(o.id, yesterday, today),
    // Mirrors approvals/queries.ts getApprovalQueueSummary (minus approval codes).
    Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(shiftRebalances)
        .where(and(eq(shiftRebalances.outletId, o.id), eq(shiftRebalances.status, "pending_approval"))),
      db.select({ n: sql<number>`count(*)::int` }).from(transactionCorrections)
        .where(and(eq(transactionCorrections.outletId, o.id), eq(transactionCorrections.status, "pending_approval"))),
      db.select({ n: sql<number>`count(*)::int` }).from(pendingEntryChanges)
        .where(and(eq(pendingEntryChanges.outletId, o.id), eq(pendingEntryChanges.status, "pending_approval"), gt(pendingEntryChanges.expiresAt, now))),
    ]).then((rs) => rs.reduce((s, [r]) => s + (r?.n ?? 0), 0)),
    // Mirrors purchase-requests getPurchaseRequestStats "aging" (open > 3 days).
    db.select({ n: sql<number>`count(*)::int` }).from(purchaseRequests)
      .where(and(eq(purchaseRequests.outletId, o.id), eq(purchaseRequests.status, "open"), isNull(purchaseRequests.deletedAt), lte(purchaseRequests.createdAt, new Date(now.getTime() - 3 * DAY_MS))))
      .then(([r]) => r?.n ?? 0),
    // Mirrors retry-queue getJournalQueuePendingCount; the hourly sweep should
    // clear entries, so anything pending > 2 h is stuck.
    db.select({ n: sql<number>`count(*)::int` }).from(journalRetryQueue)
      .where(and(eq(journalRetryQueue.outletId, o.id), isNull(journalRetryQueue.resolvedAt), isNull(journalRetryQueue.abandonedAt), lt(journalRetryQueue.createdAt, new Date(now.getTime() - 2 * 3_600_000))))
      .then(([r]) => r?.n ?? 0),
    getStockMode(o.id),
  ]);

  // Same escalation ladder the POS uses (AE-217); soft/hard = day already rolled.
  if (shift) {
    const verdict = computeShiftGateVerdict({
      openedWibDate: jakartaDateOf(shift.openedAt),
      todayWibDate: today,
      nowWibMinutes: jakartaMinutesOf(now),
      thresholds: parseShiftGateThresholds(o.settings.shift?.dayGate),
    });
    if (verdict.level === "soft" || verdict.level === "hard") {
      out.push({ jenis: "shift_belum_ditutup", pesan: `Shift dibuka ${jakartaDateOf(shift.openedAt)} oleh ${shift.openedByName ?? "?"} belum ditutup.` });
    }
  }
  for (const r of closing.filter((s) => Math.abs(s.variance) > threshold)) {
    out.push({ jenis: "selisih_kas", pesan: `Shift ${r.shiftDate} (${r.userName}) selisih kas ${rp(r.variance)}, ambang ${rp(threshold)}.` });
  }
  for (const a of rvc.anomalies.filter((x) => x.severity !== "info")) {
    out.push({ jenis: "void_refund", pesan: a.message });
  }
  if (approvals > 0) out.push({ jenis: "approval_menunggu", pesan: `${approvals} permintaan koreksi/rebalance menunggu approval.` });
  if (prAging > 0) out.push({ jenis: "purchase_request", pesan: `${prAging} purchase request belum diproses lebih dari 3 hari.` });
  if (stuckJournals > 0) out.push({ jenis: "jurnal_macet", pesan: `${stuckJournals} jurnal gagal dibuat dan belum terselesaikan > 2 jam.` });
  // Periodic mode freezes current_stock between opnames: "habis" would be stale.
  if (mode.deductOnSale) {
    const empty = (await fetchLowStockIngredients(o.id)).filter((i) => resolveStockDecimal(i.currentStock, i.currentStockDecimal) <= 0);
    if (empty.length > 0) {
      out.push({ jenis: "stok_habis", pesan: `Stok habis: ${empty.slice(0, 5).map((i) => i.name).join(", ")}${empty.length > 5 ? ` +${empty.length - 5}` : ""}.` });
    }
  }
  return out;
}

// ── ringkasan_harian ────────────────────────────────────────────────────────

const METHOD_LABEL: Record<string, string> = { cash: "Tunai", qris: "QRIS", debit: "Debit", card: "Kartu", transfer: "Transfer" };

/** Laporan → Penjualan Harian (fetchDailySalesReport) + Closing Shift + target + alerts. */
async function dailySummary(tanggal: string) {
  const outlet = await getOutlet();
  const lastWeek = addDaysJakarta(tanggal, -7);
  const isToday = tanggal === todayJakarta();
  const [sales, prev, threshold, shiftRows, active, low, perhatian] = await Promise.all([
    fetchDailySalesReport(outlet.id, tanggal),
    fetchDailySalesReport(outlet.id, lastWeek),
    getShiftVarianceThreshold(outlet.id),
    // Shifts often close after midnight: fetch through the next day, keep those OPENED on `tanggal`.
    fetchClosingShiftReport(outlet.id, tanggal, addDaysJakarta(tanggal, 1), 0).then((r) =>
      r.rows.filter((s) => jakartaDateOf(new Date(s.openedAt)) === tanggal),
    ),
    fetchActiveShiftForOutlet(outlet.id),
    lowStock(50, outlet),
    isToday || tanggal === addDaysJakarta(todayJakarta(), -1) ? alerts(outlet) : Promise.resolve([]),
  ]);

  const m = sales.metrics;
  const target = outlet.settings.targets?.dailyRevenue ?? null;
  const vsLastWeek = prev.metrics.revenue > 0 ? Math.round(((m.revenue - prev.metrics.revenue) / prev.metrics.revenue) * 1000) / 10 : null;
  const top5 = sales.topItems.slice(0, 5).map((i) => ({ produk: i.name, qty: i.quantity, omzet: i.revenue }));
  const bayar = sales.byPaymentMethod.map((p) => ({ metode: METHOD_LABEL[p.method] ?? p.method, jumlah: p.amount, persen: pct(p.amount, m.revenue) }));
  const openStillToday = active && jakartaDateOf(active.openedAt) <= tanggal;
  const shift = {
    ditutup: shiftRows.length,
    masih_buka: Boolean(openStillToday),
    selisih_kas: shiftRows.reduce((s, r) => s + r.variance, 0),
    melewati_ambang: shiftRows.filter((r) => Math.abs(r.variance) > threshold).length,
  };

  const lines = [
    `Mahakan ${tanggal}${isToday ? " (berjalan)" : ""}`,
    `Omzet ${rp(m.revenue)} dari ${m.transactionCount} trx (rata2 ${rp(m.averageTicket)})`,
    target ? `Target harian ${pct(m.revenue, target)}% dari ${rp(target)}` : "Target harian belum diatur",
    vsLastWeek !== null ? `vs ${lastWeek}: ${vsLastWeek >= 0 ? "+" : ""}${vsLastWeek}%` : `vs ${lastWeek}: tidak ada penjualan`,
    top5.length ? `Terlaris: ${top5.slice(0, 3).map((t) => `${t.produk} ${t.qty}`).join(", ")}` : "",
    bayar.length ? `Bayar: ${bayar.map((b) => `${b.metode} ${b.persen}%`).join(", ")}` : "",
    shift.masih_buka ? "Shift masih buka" : `Shift ditutup ${shift.ditutup}, selisih kas ${rp(shift.selisih_kas)}`,
    m.voidedCount + m.refundedCount > 0 ? `Void ${m.voidedCount} / refund ${m.refundedCount}` : "",
    low.jumlah ? `Stok menipis: ${low.jumlah} bahan` : "",
    ...perhatian.slice(0, 3).map((p) => `! ${p.pesan}`),
  ].filter(Boolean);

  return {
    ...meta(tanggal),
    omzet: m.revenue,
    transaksi: m.transactionCount,
    rata_rata: m.averageTicket,
    target_harian: target,
    persen_target: target ? pct(m.revenue, target) : null,
    minggu_lalu: { tanggal: lastWeek, omzet: prev.metrics.revenue, perubahan_persen: vsLastWeek },
    produk_teratas: top5,
    metode_bayar: bayar,
    void: { jumlah: m.voidedCount, nilai: m.voidedAmount },
    refund: { jumlah: m.refundedCount, nilai: m.refundedAmount },
    shift,
    stok_menipis: low.jumlah,
    perhatian: perhatian.map((p) => p.pesan),
    teks: lines.join("\n"),
  };
}

// ── registry ────────────────────────────────────────────────────────────────

const tanggalProp = { type: "string", description: "YYYY-MM-DD (WIB). Default hari ini." };
const limitProp = { type: "integer", description: "Default 10, maks 50." };

function rangeArgs(a: Record<string, unknown>, defaultFrom: (sampai: string) => string) {
  const sampai = dateArg(a.sampai, todayJakarta(), "sampai");
  const dari = dateArg(a.dari, defaultFrom(sampai), "dari");
  if (dari > sampai) throw new ToolError("dari harus sebelum atau sama dengan sampai");
  return { dari, sampai };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "ringkasan_harian",
    description: "Ringkasan satu hari: omzet, target, vs minggu lalu, produk teratas, metode bayar, shift, stok menipis, hal perlu perhatian, plus `teks` siap kirim.",
    inputSchema: { type: "object", properties: { tanggal: tanggalProp } },
    run: (a) => dailySummary(dateArg(a.tanggal, todayJakarta())),
  },
  {
    name: "pencapaian_target",
    description: "Realisasi omzet vs target hari/minggu (7 hari bergulir)/bulan, persen, dan kebutuhan omzet per hari.",
    inputSchema: {
      type: "object",
      properties: { periode: { type: "string", enum: ["hari", "minggu", "bulan"] }, tanggal: tanggalProp },
      required: ["periode"],
    },
    run: (a) => targetProgress(enumArg(a.periode, ["hari", "minggu", "bulan"] as const, "hari", "periode"), dateArg(a.tanggal, todayJakarta())),
  },
  {
    name: "penjualan_produk",
    description: "Penjualan per produk: qty, omzet, HPP, margin. urut=terendah menyertakan produk yang tidak laku.",
    inputSchema: {
      type: "object",
      properties: {
        dari: { ...tanggalProp, description: "YYYY-MM-DD. Default = sampai." },
        sampai: tanggalProp,
        urut: { type: "string", enum: [...URUT], description: "Default omzet." },
        limit: limitProp,
      },
    },
    run: (a) => {
      const { dari, sampai } = rangeArgs(a, (s) => s);
      return productSales(dari, sampai, enumArg(a.urut, URUT, "omzet", "urut"), limitArg(a.limit));
    },
  },
  {
    name: "laba_rugi",
    description: "Laba rugi satu bulan dari modul akuntansi (pendapatan, HPP, laba kotor, beban, laba bersih) + bulan lalu.",
    inputSchema: { type: "object", properties: { bulan: { type: "string", description: "YYYY-MM. Default bulan berjalan." } } },
    run: (a) => {
      const bulan = a.bulan ?? todayJakarta().slice(0, 7);
      if (typeof bulan !== "string" || !MONTH_RE.test(bulan)) throw new ToolError("bulan harus format YYYY-MM");
      return profitAndLoss(bulan);
    },
  },
  {
    name: "stok_menipis",
    description: "Bahan di bawah batas minimum: sisa, batas, satuan, supplier.",
    inputSchema: { type: "object", properties: { limit: limitProp } },
    run: (a) => lowStock(limitArg(a.limit)),
  },
  {
    name: "hutang",
    description: "Hutang belum lunas ke kreditur, supplier (hutang dagang), dan hutang internal, dengan jatuh tempo dan telat berapa hari.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["belum_lunas", "telat"], description: "Default belum_lunas." }, limit: limitProp },
    },
    run: (a) => payables(enumArg(a.status, ["belum_lunas", "telat"] as const, "belum_lunas", "status") === "telat", limitArg(a.limit)),
  },
  {
    name: "jatuh_tempo",
    description: "Kewajiban (kreditur, hutang dagang) yang jatuh tempo dalam N hari ke depan, termasuk yang sudah lewat.",
    inputSchema: { type: "object", properties: { hari_ke_depan: { type: "integer", description: "Default 7, maks 90." } } },
    run: (a) => {
      const n = Number(a.hari_ke_depan ?? 7);
      return dueSoon(Number.isFinite(n) ? Math.min(90, Math.max(0, Math.trunc(n))) : 7);
    },
  },
  {
    name: "saldo_kas",
    description: "Saldo per akun kas & bank (buku besar), piutang QRIS/EDC belum cair, kas fisik belum disetor.",
    inputSchema: { type: "object", properties: {} },
    run: () => cashBalances(),
  },
  {
    name: "pengeluaran",
    description: "Total pengeluaran per kategori dan 5 pengeluaran terbesar dalam rentang tanggal.",
    inputSchema: {
      type: "object",
      properties: {
        dari: { ...tanggalProp, description: "YYYY-MM-DD. Default awal bulan." },
        sampai: tanggalProp,
        kategori: { type: "string", description: "Sebagian nama kategori, opsional." },
      },
    },
    run: (a) => {
      const { dari, sampai } = rangeArgs(a, (s) => `${s.slice(0, 7)}-01`);
      return expensesReport(dari, sampai, typeof a.kategori === "string" && a.kategori.trim() ? a.kategori : undefined);
    },
  },
  {
    name: "peringatan",
    description: "Hanya hal yang perlu ditindak sekarang. Daftar kosong berarti tidak ada apa-apa.",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({ ...meta(todayJakarta()), peringatan: await alerts() }),
  },
];
