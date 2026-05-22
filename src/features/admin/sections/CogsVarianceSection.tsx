"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Calculator,
  CalendarDays,
  Download,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  toast,
} from "@/components/ui";
import {
  closeCogsPeriod,
  fetchCogsPeriodCloseStatus,
  fetchCogsReport,
  isOk,
  parseMonthlyPeriod,
  previousMonth,
  type CogsPeriodCloseResult,
  type CogsReport,
  type IngredientCogsRow,
} from "@/features/cogs";
import { Lock, LockOpen } from "lucide-react";
import { Modal } from "@/components/ui";
import { currentJakartaMonth } from "@/lib/date";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./reports/menu-engineering-csv";

type TabKey = "variance" | "cogs";

export function CogsVarianceSection() {
  const [ym, setYm] = useState<string>(currentJakartaMonth());
  const [tab, setTab] = useState<TabKey>("variance");
  const [report, setReport] = useState<CogsReport | null>(null);
  const [closeStatus, setCloseStatus] = useState<CogsPeriodCloseResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [reportRes, statusRes] = await Promise.all([
        fetchCogsReport(ym),
        fetchCogsPeriodCloseStatus(ym),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!isOk(reportRes)) {
        setError(reportRes.error.message);
        setReport(null);
        return;
      }
      setReport(reportRes.data);
      if (isOk(statusRes)) {
        setCloseStatus(statusRes.data);
      } else {
        setCloseStatus(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [ym, refreshKey]);

  async function handleClose() {
    setClosing(true);
    const res = await closeCogsPeriod(ym);
    setClosing(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    if (res.data.alreadyClosed) {
      toast.info("Periode sudah ditutup sebelumnya");
    } else {
      const adj = res.data.adjustmentTotal;
      toast.success(
        adj === 0
          ? `Periode ${ym} ditutup. Tidak ada adjustment (recognized = actual).`
          : `Periode ${ym} ditutup. Adjustment: ${formatRupiah(adj)} ${adj > 0 ? "(post Dr HPP)" : "(reverse HPP)"}`,
      );
    }
    setCloseOpen(false);
    setRefreshKey((k) => k + 1);
  }

  /* Month options: current month + 11 previous */
  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    let cursor = currentJakartaMonth();
    for (let i = 0; i < 12; i++) {
      const p = parseMonthlyPeriod(cursor);
      opts.push({ value: cursor, label: p.label });
      cursor = previousMonth(cursor);
    }
    return opts;
  }, []);

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Calculator className="size-6" aria-hidden /> COGS & Variance
          </h1>
          <p className="text-sm text-neutral-700">
            Weighted Average Cost (WAC) per bulan + theoretical-vs-actual
            usage variance. Sumber: opname akhir bulan + pembelian + sales.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
            <CalendarDays className="size-4 text-neutral-500" />
            <select
              value={ym}
              onChange={(e) => setYm(e.target.value)}
              className="bg-transparent outline-none"
              aria-label="Pilih bulan"
            >
              {monthOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {closeStatus ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-success-300 bg-success-50 px-3 py-2 text-xs font-medium text-success-700">
              <Lock className="size-3.5" /> Periode Ditutup
            </span>
          ) : (
            <Button
              variant="outline"
              onClick={() => setCloseOpen(true)}
              disabled={!report || loading}
              title="Tutup periode COGS: post adjustment journal supaya Income Statement reflect actual COGS"
            >
              <LockOpen className="size-4" /> Tutup Periode
            </Button>
          )}
        </div>
      </header>

      {/* Close confirmation modal */}
      <Modal
        open={closeOpen}
        onClose={() => !closing && setCloseOpen(false)}
        title={`Tutup Periode COGS — ${report?.period.label ?? ym}`}
        description="Adjustment journal akan post selisih antara recognized HPP (running pos_sale) vs actual COGS (WAC × consumed). Action ini IDEMPOTENT — bisa close cuma 1× per bulan."
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setCloseOpen(false)}
              disabled={closing}
            >
              Batal
            </Button>
            <Button onClick={handleClose} loading={closing} disabled={closing}>
              <Lock className="size-4" /> Ya, Tutup Periode
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {report ? (
            <>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-xs text-neutral-500">
                  Total COGS (actual, WAC × consumed)
                </div>
                <div className="text-lg font-bold text-mahakan-green-900">
                  {formatRupiah(report.summary.total)}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-neutral-500">
                  Per Section
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className="flex justify-between rounded bg-neutral-50 px-2 py-1">
                    <span>Kitchen</span>
                    <span className="font-mono">
                      {formatRupiah(report.summary.bySection.kitchen)}
                    </span>
                  </div>
                  <div className="flex justify-between rounded bg-neutral-50 px-2 py-1">
                    <span>Bar</span>
                    <span className="font-mono">
                      {formatRupiah(report.summary.bySection.bar)}
                    </span>
                  </div>
                  <div className="flex justify-between rounded bg-neutral-50 px-2 py-1">
                    <span>Supporting</span>
                    <span className="font-mono">
                      {formatRupiah(report.summary.bySection.supporting)}
                    </span>
                  </div>
                  <div className="flex justify-between rounded bg-neutral-50 px-2 py-1">
                    <span>Cleaning</span>
                    <span className="font-mono">
                      {formatRupiah(report.summary.bySection.cleaning)}
                    </span>
                  </div>
                </div>
              </div>
              {report.banners.length > 0 ? (
                <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
                  ⚠️ {report.banners[0]}
                </div>
              ) : null}
              <div className="rounded-md border border-info-300 bg-info-50 p-2 text-xs text-info-700">
                <strong>Ekspektasi:</strong> Adjustment journal akan post Dr/Cr
                HPP+Persediaan per section sebesar selisih actual vs recognized.
                Kalau pos_sale sudah recognized accurate (recipe + WAC tepat),
                adjustment ~ Rp 0.
              </div>
            </>
          ) : (
            <div className="text-center text-neutral-500">Loading...</div>
          )}
        </div>
      </Modal>

      {/* Banners */}
      {report?.banners && report.banners.length > 0 ? (
        <div className="space-y-1">
          {report.banners.map((b, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-3 text-xs text-warning-700"
            >
              <AlertTriangle className="size-4 shrink-0" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Loading / Error states */}
      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-mahakan-green-700" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-danger-700">
            {error}
          </CardContent>
        </Card>
      ) : !report ? null : (
        <Tabs value={tab} onChange={(v) => setTab(v as TabKey)}>
          <TabList ariaLabel="COGS tabs">
            <Tab value="variance">
              <span className="inline-flex items-center gap-1.5">
                <TrendingUp className="size-4" /> Variance Cost
              </span>
            </Tab>
            <Tab value="cogs">
              <span className="inline-flex items-center gap-1.5">
                <Calculator className="size-4" /> Cost of Goods Sold
              </span>
            </Tab>
          </TabList>

          <TabPanel value="variance">
            <VarianceTab report={report} />
          </TabPanel>
          <TabPanel value="cogs">
            <CogsTab report={report} />
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Variance Tab
// ──────────────────────────────────────────────────────────────────

function VarianceTab({ report }: { report: CogsReport }) {
  const rows = useMemo(
    () =>
      [...report.rows]
        .filter((r) => r.theoreticalUsageQty > 0 || r.actualUsageQty > 0)
        .sort(
          (a, b) =>
            Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0),
        ),
    [report.rows],
  );

  function exportCsv() {
    const lines: string[] = [];
    lines.push("nama,unit,section,theoretical_qty,actual_qty,variance_qty,variance_pct,variance_cost");
    for (const r of rows) {
      lines.push(
        [
          escapeCsv(r.name),
          r.unit,
          r.section ?? "",
          r.theoreticalUsageQty,
          r.actualUsageQty,
          r.varianceQty,
          r.variancePct ?? "",
          r.varianceCost,
        ].join(","),
      );
    }
    downloadCsv(
      `variance-${report.period.ym}.csv`,
      "﻿" + lines.join("\n"),
    );
    toast.success(`Export Variance ${report.period.label}`);
  }

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-700">
          <strong>Theoretical</strong> = Σ(resep × menu terjual) ·{" "}
          <strong>Actual</strong> = stock awal + pembelian - stock akhir
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="size-3.5" /> CSV
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Total Variance Cost"
          value={formatRupiah(report.summary.totalVarianceCost)}
          tone={report.summary.totalVarianceCost > 0 ? "danger" : "success"}
        />
        <StatCard
          label="Bahan dgn Variance"
          value={`${report.summary.ingredientsWithVariance} / ${report.rows.length}`}
        />
        <StatCard
          label="Periode"
          value={report.period.label}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Nama Bahan</th>
              <th className="px-3 py-2 text-left font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Theoretical</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-3 py-2 text-right font-medium">Δ Qty</th>
              <th className="px-3 py-2 text-right font-medium">Δ %</th>
              <th className="px-3 py-2 text-right font-medium">Δ Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm text-neutral-500"
                >
                  Tidak ada data variance di periode ini.
                </td>
              </tr>
            ) : (
              rows.map((r) => <VarianceRow key={r.ingredientId} r={r} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VarianceRow({ r }: { r: IngredientCogsRow }) {
  const pct = r.variancePct ?? 0;
  const absPct = Math.abs(pct);
  const tone =
    absPct < 5
      ? "text-success-700"
      : absPct < 15
        ? "text-warning-600"
        : "text-danger-700";
  const Icon =
    r.varianceQty > 0
      ? TrendingUp
      : r.varianceQty < 0
        ? TrendingDown
        : Minus;
  return (
    <tr>
      <td className="px-3 py-1.5">
        <div className="font-medium">{r.name}</div>
        {r.warnings.length > 0 ? (
          <div className="text-[10px] text-warning-600">
            ⚠️ {r.warnings[0]}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-1.5 text-neutral-500">{r.unit}</td>
      <td className="px-3 py-1.5 text-right font-mono">
        {formatNum(r.theoreticalUsageQty)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        {formatNum(r.actualUsageQty)}
      </td>
      <td className={cn("px-3 py-1.5 text-right font-mono", tone)}>
        <Icon className="mr-1 inline size-3" />
        {formatNum(r.varianceQty)}
      </td>
      <td className={cn("px-3 py-1.5 text-right font-mono", tone)}>
        {r.variancePct !== null ? `${formatNum(r.variancePct)}%` : "—"}
      </td>
      <td className={cn("px-3 py-1.5 text-right font-mono", tone)}>
        {r.varianceCost !== 0 ? formatRupiah(r.varianceCost) : "—"}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────────
// COGS Tab
// ──────────────────────────────────────────────────────────────────

function CogsTab({ report }: { report: CogsReport }) {
  const rows = useMemo(
    () =>
      [...report.rows].filter(
        (r) =>
          r.stockAwalQty > 0 ||
          r.pembelianQty > 0 ||
          r.stockAkhirQty > 0 ||
          r.cogsQty > 0,
      ),
    [report.rows],
  );

  function exportCsv() {
    const lines: string[] = [];
    lines.push(
      "nama,unit,section,stockAwal_qty,stockAwal_harga,stockAwal_total,pembelian_qty,pembelian_harga,pembelian_total,average_price,stockAkhir_qty,stockAkhir_total,cogs_qty,cogs_total",
    );
    for (const r of rows) {
      lines.push(
        [
          escapeCsv(r.name),
          r.unit,
          r.section ?? "",
          r.stockAwalQty,
          r.stockAwalAvgPrice,
          r.stockAwalTotal,
          r.pembelianQty,
          r.pembelianAvgPrice,
          r.pembelianTotal,
          r.averagePrice,
          r.stockAkhirQty,
          r.stockAkhirTotal,
          r.cogsQty,
          r.cogsTotal,
        ].join(","),
      );
    }
    downloadCsv(`cogs-${report.period.ym}.csv`, "﻿" + lines.join("\n"));
    toast.success(`Export COGS ${report.period.label}`);
  }

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-700">
          <strong>WAC</strong> = (Stock Awal Total + Pembelian Total) /
          (Stock Awal Qty + Pembelian Qty)
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="size-3.5" /> CSV
        </Button>
      </div>

      {/* Summary cards by section */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatCard
          label="Total COGS"
          value={formatRupiah(report.summary.total)}
          tone="default"
        />
        <StatCard
          label="Kitchen"
          value={formatRupiah(report.summary.bySection.kitchen)}
        />
        <StatCard
          label="Bar"
          value={formatRupiah(report.summary.bySection.bar)}
        />
        <StatCard
          label="Supporting"
          value={formatRupiah(report.summary.bySection.supporting)}
        />
        <StatCard
          label="Cleaning"
          value={formatRupiah(report.summary.bySection.cleaning)}
        />
      </div>

      {/* Table with merged groupings (visual header rows) */}
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-300 bg-neutral-100 text-[10px] uppercase tracking-wider text-neutral-700">
              <th rowSpan={2} className="border-r px-2 py-1 text-left">
                Nama
              </th>
              <th rowSpan={2} className="border-r px-2 py-1 text-left">
                Unit
              </th>
              <th rowSpan={2} className="border-r px-2 py-1 text-right">
                Avg Price
              </th>
              <th colSpan={3} className="border-r px-2 py-1 text-center bg-warning-50">
                Stock Awal
              </th>
              <th colSpan={3} className="border-r px-2 py-1 text-center bg-success-50">
                Pembelian
              </th>
              <th colSpan={3} className="border-r px-2 py-1 text-center bg-info-50">
                Stock Akhir
              </th>
              <th colSpan={3} className="px-2 py-1 text-center bg-mahakan-green-50">
                COGS / Pemakaian
              </th>
            </tr>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-[10px] text-neutral-500">
              {/* Stock Awal sub-headers */}
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Harga</th>
              <th className="px-2 py-1 text-right border-r">Total</th>
              {/* Pembelian */}
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Harga</th>
              <th className="px-2 py-1 text-right border-r">Total</th>
              {/* Stock Akhir */}
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Harga</th>
              <th className="px-2 py-1 text-right border-r">Total</th>
              {/* COGS */}
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Harga</th>
              <th className="px-2 py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={15}
                  className="px-3 py-8 text-center text-sm text-neutral-500"
                >
                  Tidak ada data COGS di periode ini.
                </td>
              </tr>
            ) : (
              rows.map((r) => <CogsRow key={r.ingredientId} r={r} />)
            )}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="border-t-2 border-neutral-300 bg-neutral-100 text-[11px]">
              <tr>
                <td colSpan={11} className="px-2 py-2 text-right font-bold">
                  TOTAL COGS BULAN INI
                </td>
                <td className="px-2 py-2 text-right" />
                <td className="px-2 py-2 text-right" />
                <td className="px-2 py-2 text-right" />
                <td className="px-2 py-2 text-right font-mono font-bold">
                  {formatRupiah(report.summary.total)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function CogsRow({ r }: { r: IngredientCogsRow }) {
  /* AE-117 — Hide harga display when qty = 0 (cleaner, no misleading values).
   * Total ke-display 0 / "—" karena qty × harga = 0 regardless. */
  const showAwalPrice = r.stockAwalQty !== 0;
  const showPembelianPrice = r.pembelianQty !== 0;
  const showAkhirPrice = r.stockAkhirQty !== 0;
  const showCogsPrice = r.cogsQty !== 0;

  return (
    <tr className="hover:bg-neutral-50">
      <td className="px-2 py-1">
        <div className="font-medium">{r.name}</div>
        {r.section ? (
          <div className="text-[10px] text-neutral-500">{r.section}</div>
        ) : null}
      </td>
      <td className="px-2 py-1 text-neutral-500">{r.unit}</td>
      <td className="px-2 py-1 text-right font-mono">
        {formatRupiah(r.averagePrice)}
      </td>
      {/* Stock Awal */}
      <td className="px-2 py-1 text-right font-mono bg-warning-50/30">
        {formatNum(r.stockAwalQty)}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-warning-50/30">
        {showAwalPrice ? formatRupiah(r.stockAwalAvgPrice) : "—"}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-warning-50/30 border-r">
        {showAwalPrice ? formatRupiah(r.stockAwalTotal) : "—"}
      </td>
      {/* Pembelian */}
      <td className="px-2 py-1 text-right font-mono bg-success-50/30">
        {formatNum(r.pembelianQty)}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-success-50/30">
        {showPembelianPrice ? formatRupiah(r.pembelianAvgPrice) : "—"}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-success-50/30 border-r">
        {showPembelianPrice ? formatRupiah(r.pembelianTotal) : "—"}
      </td>
      {/* Stock Akhir */}
      <td className="px-2 py-1 text-right font-mono bg-info-50/30">
        {formatNum(r.stockAkhirQty)}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-info-50/30">
        {showAkhirPrice ? formatRupiah(r.stockAkhirAvgPrice) : "—"}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-info-50/30 border-r">
        {showAkhirPrice ? formatRupiah(r.stockAkhirTotal) : "—"}
      </td>
      {/* COGS */}
      <td className="px-2 py-1 text-right font-mono bg-mahakan-green-50/30">
        {formatNum(r.cogsQty)}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-mahakan-green-50/30">
        {showCogsPrice ? formatRupiah(r.cogsAvgPrice) : "—"}
      </td>
      <td className="px-2 py-1 text-right font-mono bg-mahakan-green-50/30 font-semibold">
        {showCogsPrice ? formatRupiah(r.cogsTotal) : "—"}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "border-danger-300 bg-danger-50 text-danger-700"
      : tone === "success"
        ? "border-success-300 bg-success-50 text-success-700"
        : "border-neutral-200 bg-white text-neutral-900";
  return (
    <div className={cn("rounded-md border p-3", toneClass)}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1 && n !== 0) return n.toFixed(4);
  return n.toLocaleString("id-ID", {
    maximumFractionDigits: 4,
  });
}

function escapeCsv(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  if (!s.includes(",") && !s.includes('"') && !s.includes("\n")) return s;
  return `"${s.replace(/"/g, '""')}"`;
}
