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
  DateRangePicker,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  getSalesRangeReport,
  isOk,
  type SalesRangeReport,
} from "@/features/reports";
import type { PaymentMethod } from "@/features/transactions";
import {
  getOwnOutlet,
  isOk as isOutletOk,
  type Outlet,
} from "@/features/outlets";
import { exportSalesRangePdf } from "@/lib/pdf-export";
import { formatRupiah } from "@/lib/format";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Sesi AE-62m — payment method filter (consistent dengan DailySalesView).
type PaymentFilter = PaymentMethod | "all";

const PAYMENT_OPTIONS: Array<{ value: PaymentFilter; label: string }> = [
  { value: "all", label: "Semua metode" },
  { value: "cash", label: "Cash" },
  { value: "qris", label: "QRIS" },
  { value: "card_bca", label: "Kartu BCA" },
  { value: "card_bni", label: "Kartu BNI" },
  { value: "card_mandiri", label: "Kartu Mandiri" },
  { value: "card_bri", label: "Kartu BRI" },
  { value: "card_other", label: "Kartu Lainnya" },
  { value: "split", label: "Split Payment" },
];

export function SalesRangeView() {
  const [from, setFrom] = useState<string>(isoDaysAgo(6));
  const [to, setTo] = useState<string>(isoToday());
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [report, setReport] = useState<SalesRangeReport | null>(null);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [reportRes, outletRes] = await Promise.all([
        getSalesRangeReport(from, to, paymentFilter),
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
  }, [from, to, paymentFilter]);

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
          <div className="min-w-[16rem]">
            <DateRangePicker
              ariaLabel="Periode laporan"
              value={{ from, to }}
              onChange={(v) => {
                setFrom(v.from ?? isoDaysAgo(6));
                setTo(v.to ?? isoToday());
              }}
            />
          </div>
          <div className="w-44">
            <Select
              label="Metode Bayar"
              value={paymentFilter}
              onValueChange={(v) => setPaymentFilter(v as PaymentFilter)}
              options={PAYMENT_OPTIONS}
            />
          </div>
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

      {/* Sesi AE-62m — banner kalau filter aktif. */}
      {paymentFilter !== "all" ? (
        <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50 px-3 py-2 text-xs text-mahakan-green-900">
          <strong>Filter aktif:</strong>{" "}
          {PAYMENT_OPTIONS.find((o) => o.value === paymentFilter)?.label} —
          metrics (revenue, transaksi, avg) di-restrict ke method ini.
          Trend, kategori, top items tetap full data.
        </div>
      ) : null}

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
            {(() => {
              const histCount = byDay.filter((d) => d.isHistorical).length;
              if (histCount === 0) return null;
              return (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-semibold text-warning-700">
                  {histCount} hari Histori (Majoo/POS lama)
                </span>
              );
            })()}
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

