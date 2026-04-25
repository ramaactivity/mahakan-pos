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
  Input,
  Spinner,
} from "@/components/ui";
import { isOk, reportService } from "@/mocks/services";
import type { DailySalesReport } from "@/mocks/services/reportService";
import { formatRupiah } from "@/lib/format";

export function DailySalesView() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [report, setReport] = useState<DailySalesReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await reportService.getDailySalesReport(date);
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Laporan Penjualan
          </h2>
          <p className="text-xs text-neutral-500">
            Pilih tanggal — default hari ini.
          </p>
        </div>
        <div className="w-44">
          <Input
            label="Tanggal"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </header>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="size-6 text-mahakan-green-700" />
        </div>
      ) : !report ? (
        <p className="text-sm text-danger-500">Gagal load laporan</p>
      ) : (
        <ReportContent report={report} />
      )}
    </div>
  );
}

function ReportContent({ report }: { report: DailySalesReport }) {
  const { metrics, byPaymentMethod, hourlyDistribution, topItems, byCategory } =
    report;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Revenue"
          value={formatRupiah(metrics.revenue)}
          subtitle={`${metrics.transactionCount} transaksi`}
        />
        <StatCard
          title="Avg per Trx"
          value={formatRupiah(metrics.averageTicket)}
        />
        <StatCard
          title="Void / Refund"
          value={`${metrics.voidedCount} / ${metrics.refundedCount}`}
          subtitle={formatRupiah(
            metrics.voidedAmount + metrics.refundedAmount,
          )}
          tone={
            metrics.voidedCount + metrics.refundedCount > 0
              ? "warn"
              : "neutral"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Distribusi Per Jam</CardTitle>
          <CardDescription>Penjualan per jam (WIB)</CardDescription>
        </CardHeader>
        <CardContent>
          {hourlyDistribution.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Belum ada transaksi.
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Breakdown Pembayaran</CardTitle>
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
                    <p className="text-xs text-neutral-500">{row.count} trx</p>
                  </div>
                  <p className="font-mono text-sm font-semibold">
                    {formatRupiah(row.amount)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

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
                      <p className="text-xs text-neutral-500">{row.count} item terjual</p>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top 10 Item</CardTitle>
        </CardHeader>
        <CardContent>
          {topItems.length === 0 ? (
            <p className="text-sm text-neutral-500">Belum ada penjualan.</p>
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
    <Card>
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
