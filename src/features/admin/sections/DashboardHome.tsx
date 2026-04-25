"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui";
import { isOk, reportService } from "@/mocks/services";
import type { DailySalesReport } from "@/mocks/services/reportService";
import { formatRupiah } from "@/lib/format";

interface DashboardHomeProps {
  user: { name: string };
}

export function DashboardHome({ user }: DashboardHomeProps) {
  const [report, setReport] = useState<DailySalesReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await reportService.getDailySalesReport();
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 p-6" role="status" aria-label="Memuat dashboard">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-[320px] w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!report) {
    return <p className="text-sm text-danger-500">Gagal load laporan</p>;
  }

  const { metrics, byPaymentMethod, hourlyDistribution, topItems } = report;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">
          Halo, {user.name}
        </h1>
        <p className="text-sm text-neutral-700">
          Ringkasan operasional hari ini · {report.date}
        </p>
      </header>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Omzet Hari Ini"
          value={formatRupiah(metrics.revenue)}
          subtitle={`${metrics.transactionCount} transaksi`}
        />
        <StatCard
          title="Rata-rata Transaksi"
          value={formatRupiah(metrics.averageTicket)}
          subtitle="Per order"
        />
        <StatCard
          title="Void / Refund"
          value={`${metrics.voidedCount} / ${metrics.refundedCount}`}
          subtitle={`${formatRupiah(
            metrics.voidedAmount + metrics.refundedAmount,
          )} total`}
          tone={
            metrics.voidedCount + metrics.refundedCount > 0
              ? "warn"
              : "neutral"
          }
        />
      </div>

      {/* Hourly chart */}
      <Card>
        <CardHeader>
          <CardTitle>Distribusi Per Jam</CardTitle>
          <CardDescription>Penjualan per jam (WIB)</CardDescription>
        </CardHeader>
        <CardContent>
          {hourlyDistribution.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Belum ada transaksi hari ini.
            </p>
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DB" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 12, fill: "#514E45" }}
                    tickFormatter={(h) => `${h}:00`}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#514E45" }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "#F2F1EC" }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #E5E3DB",
                      fontSize: 12,
                    }}
                    formatter={(value) =>
                      typeof value === "number" ? formatRupiah(value) : String(value)
                    }
                    labelFormatter={(label) => `${String(label)}:00 WIB`}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="#3D7557"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment methods + top items */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Breakdown Pembayaran</CardTitle>
            <CardDescription>Per metode (lunas saja)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byPaymentMethod.map((row) => (
                <div
                  key={row.method}
                  className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-neutral-900">
                      {row.method === "cash"
                        ? "Tunai"
                        : row.method === "qris"
                          ? "QRIS"
                          : "Kartu BCA"}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {row.count} transaksi
                    </p>
                  </div>
                  <p className="font-mono text-sm font-semibold text-neutral-900">
                    {formatRupiah(row.amount)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top 10 Item</CardTitle>
            <CardDescription>By quantity terjual</CardDescription>
          </CardHeader>
          <CardContent>
            {topItems.length === 0 ? (
              <p className="py-4 text-center text-sm text-neutral-500">
                Belum ada penjualan.
              </p>
            ) : (
              <div className="space-y-2">
                {topItems.map((item, idx) => (
                  <div
                    key={item.menuItemId}
                    className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mahakan-green-100 text-xs font-bold text-mahakan-green-900">
                        {idx + 1}
                      </span>
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {item.name}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
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

function StatCard({
  title,
  value,
  subtitle,
  tone = "neutral",
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <Card variant={tone === "warn" ? "default" : "default"}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={`font-mono text-2xl font-bold ${
            tone === "warn" ? "text-warning-500" : "text-neutral-900"
          }`}
        >
          {value}
        </p>
        {subtitle ? (
          <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
