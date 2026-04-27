"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowRight, ArrowUp, Download } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui";
import {
  getSalesRangeReport,
  isOk,
  type SalesRangeReport,
} from "@/features/reports";
import {
  getOwnOutlet,
  isOk as isOutletOk,
  type Outlet,
} from "@/features/outlets";
import { exportSalesRangePdf } from "@/lib/pdf-export";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type Preset = "7d" | "30d" | "month" | "custom";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function startOfThisMonth(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export function SalesRangeView() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState<string>(isoDaysAgo(6));
  const [to, setTo] = useState<string>(isoToday());
  const [report, setReport] = useState<SalesRangeReport | null>(null);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === "7d") {
      setFrom(isoDaysAgo(6));
      setTo(isoToday());
    } else if (p === "30d") {
      setFrom(isoDaysAgo(29));
      setTo(isoToday());
    } else if (p === "month") {
      setFrom(startOfThisMonth());
      setTo(isoToday());
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [reportRes, outletRes] = await Promise.all([
        getSalesRangeReport(from, to),
        getOwnOutlet(),
      ]);
      if (cancelled) return;
      if (isOk(reportRes)) setReport(reportRes.data);
      if (isOutletOk(outletRes)) setOutlet(outletRes.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  function onExport() {
    if (!report || !outlet) return;
    exportSalesRangePdf(report, outlet);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Laporan Mingguan / Bulanan
          </h2>
          <p className="text-xs text-neutral-500">
            Aggregat penjualan periode dengan perbandingan vs periode sebelumnya.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div role="radiogroup" aria-label="Preset periode" className="flex gap-1">
            {(
              [
                { v: "7d" as const, label: "7 Hari" },
                { v: "30d" as const, label: "30 Hari" },
                { v: "month" as const, label: "Bulan Ini" },
                { v: "custom" as const, label: "Custom" },
              ]
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                role="radio"
                aria-checked={preset === opt.v}
                onClick={() => applyPreset(opt.v)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  preset === opt.v
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            aria-label="Tanggal mulai"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreset("custom");
            }}
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm"
          />
          <span className="text-sm text-neutral-500">→</span>
          <input
            type="date"
            aria-label="Tanggal selesai"
            value={to}
            min={from}
            max={isoToday()}
            onChange={(e) => {
              setTo(e.target.value);
              setPreset("custom");
            }}
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm"
          />
          <Button
            variant="outline"
            onClick={onExport}
            disabled={!report || !outlet || loading}
            aria-label="Export PDF"
          >
            <Download className="size-4" /> PDF
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <Skeleton className="h-[320px] w-full" />
        </div>
      ) : !report ? (
        <p className="text-sm text-danger-500">Gagal load laporan</p>
      ) : (
        <RangeContent report={report} />
      )}
    </div>
  );
}

function RangeContent({ report }: { report: SalesRangeReport }) {
  const { metrics, byDay, comparison, topItems, byCategory } = report;
  const totalRefundsVoids = metrics.refundedAmount + metrics.voidedAmount;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <ChangeStat
          title="Revenue"
          value={formatRupiah(metrics.revenue)}
          subtitle={`${metrics.transactionCount} transaksi`}
          changePct={comparison.revenueChangePct}
          comparisonHint={`vs ${formatRupiah(comparison.revenue)} periode sebelumnya`}
        />
        <ChangeStat
          title="Avg per Trx"
          value={formatRupiah(metrics.averageTicket)}
        />
        <ChangeStat
          title="Void / Refund"
          value={`${metrics.voidedCount + metrics.refundedCount}`}
          subtitle={
            totalRefundsVoids > 0
              ? formatRupiah(totalRefundsVoids)
              : "Tidak ada"
          }
          tone={totalRefundsVoids > 0 ? "warn" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tren Harian</CardTitle>
          <CardDescription>
            Revenue per hari dalam periode ini.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {byDay.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada data.
            </p>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DB" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#514E45" }}
                    tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#514E45" }}
                    tickFormatter={(v: number) =>
                      v >= 1_000_000
                        ? `${Math.round(v / 100_000) / 10}jt`
                        : v >= 1000
                          ? `${Math.round(v / 1000)}rb`
                          : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #E5E3DB",
                      fontSize: 12,
                    }}
                    formatter={(value) =>
                      typeof value === "number" ? formatRupiah(value) : String(value)
                    }
                    labelFormatter={(label) => String(label)}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3D7557"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#3D7557" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Per Kategori</CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory.length === 0 ? (
              <p className="text-sm text-neutral-500">Tidak ada data.</p>
            ) : (
              <div className="space-y-2">
                {byCategory.map((row) => (
                  <div
                    key={row.categoryName}
                    className="flex items-center justify-between border-b border-neutral-100 pb-2 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {row.categoryName}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {row.count} item
                      </p>
                    </div>
                    <p className="font-mono text-sm font-semibold">
                      {formatRupiah(row.revenue)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Item</CardTitle>
          </CardHeader>
          <CardContent>
            {topItems.length === 0 ? (
              <p className="text-sm text-neutral-500">Belum ada data.</p>
            ) : (
              <div className="space-y-2">
                {topItems.map((item, idx) => (
                  <div
                    key={item.menuItemId}
                    className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mahakan-green-100 text-xs font-bold text-mahakan-green-900">
                        {idx + 1}
                      </span>
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {item.name}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm font-semibold text-neutral-900">
                        {item.quantity}×
                      </p>
                      <p className="text-xs text-neutral-500">
                        {formatRupiah(item.revenue)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChangeStat({
  title,
  value,
  subtitle,
  changePct,
  comparisonHint,
  tone = "neutral",
}: {
  title: string;
  value: string;
  subtitle?: string;
  changePct?: number | null;
  comparisonHint?: string;
  tone?: "neutral" | "warn";
}) {
  const arrow = useMemo(() => {
    if (changePct == null) return null;
    if (changePct > 0)
      return (
        <span className="ml-1 inline-flex items-center text-success-500">
          <ArrowUp className="size-3" />
          {changePct}%
        </span>
      );
    if (changePct < 0)
      return (
        <span className="ml-1 inline-flex items-center text-danger-500">
          <ArrowDown className="size-3" />
          {Math.abs(changePct)}%
        </span>
      );
    return (
      <span className="ml-1 inline-flex items-center text-neutral-500">
        <ArrowRight className="size-3" /> 0%
      </span>
    );
  }, [changePct]);

  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={`flex items-baseline font-mono text-2xl font-bold ${
            tone === "warn" ? "text-warning-500" : "text-neutral-900"
          }`}
        >
          {value}
          {arrow ? (
            <span className="ml-2 text-xs font-medium">{arrow}</span>
          ) : null}
        </p>
        {subtitle ? (
          <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
        ) : null}
        {comparisonHint ? (
          <p className="mt-1 text-[11px] text-neutral-500">{comparisonHint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

