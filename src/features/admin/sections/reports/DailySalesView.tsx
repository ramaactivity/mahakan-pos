"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { ReportExportButtons } from "./ReportExportButtons";
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
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatePicker,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  getDailySalesReport,
  isOk,
  type DailySalesReport,
} from "@/features/reports";
import type { PaymentMethod } from "@/features/transactions";
import {
  getOwnOutlet,
  isOk as isOutletOk,
  type Outlet,
} from "@/features/outlets";
import { exportDailySalesPdf } from "@/lib/pdf-export";
import { formatRupiah } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-method";
import { todayJakarta } from "@/lib/tz";

// Sesi AE-62m — payment method filter (owner request: lihat omset per method).
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

export function DailySalesView() {
  const today = todayJakarta();
  const [date, setDate] = useState(today);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [report, setReport] = useState<DailySalesReport | null>(null);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [reportRes, outletRes] = await Promise.all([
        getDailySalesReport(date, paymentFilter),
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
  }, [date, paymentFilter]);

  function onExport() {
    if (!report || !outlet) return;
    exportDailySalesPdf(report, outlet);
  }

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
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-52">
            <DatePicker
              label="Tanggal"
              value={date}
              onChange={(v) => setDate(v ?? today)}
              maxDate={today}
              clearable={false}
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
          <ReportExportButtons
            filenameBase={`penjualan-harian-${date}`}
            disabled={!report || loading}
            size="md"
            buildSheets={() =>
              report
                ? [
                    {
                      name: "Ringkasan",
                      rows: [
                        { Keterangan: "Tanggal", Nilai: report.date },
                        { Keterangan: "Omzet", Nilai: report.metrics.revenue },
                        {
                          Keterangan: "Jumlah transaksi",
                          Nilai: report.metrics.transactionCount,
                        },
                        {
                          Keterangan: "Rata-rata per bill",
                          Nilai: report.metrics.averageTicket,
                        },
                        {
                          Keterangan: "Void (jumlah)",
                          Nilai: report.metrics.voidedCount,
                        },
                        {
                          Keterangan: "Void (rupiah)",
                          Nilai: report.metrics.voidedAmount,
                        },
                        {
                          Keterangan: "Refund (jumlah)",
                          Nilai: report.metrics.refundedCount,
                        },
                        {
                          Keterangan: "Refund (rupiah)",
                          Nilai: report.metrics.refundedAmount,
                        },
                      ],
                    },
                    {
                      name: "Metode Bayar",
                      rows: report.byPaymentMethod.map((m) => ({
                        Metode: m.method,
                        "Jumlah Transaksi": m.count,
                        Nominal: m.amount,
                      })),
                    },
                    {
                      name: "Kategori",
                      rows: report.byCategory.map((c) => ({
                        Kategori: c.categoryName,
                        Terjual: c.count,
                        Omzet: c.revenue,
                      })),
                    },
                    {
                      name: "Item Terlaris",
                      rows: report.topItems.map((t) => ({
                        Menu: t.name,
                        Qty: t.quantity,
                        Omzet: t.revenue,
                      })),
                    },
                  ]
                : []
            }
          />
          <Button
            variant="outline"
            onClick={onExport}
            disabled={!report || !outlet || loading}
            aria-label="Export PDF"
          >
            <Download className="size-4" /> Export PDF
          </Button>
        </div>
      </header>

      {/* Sesi AE-62m — banner kalau filter aktif supaya owner ngerti
          metrics di-restrict ke method tersebut (revenue, count, avg). */}
      {paymentFilter !== "all" ? (
        <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50 px-3 py-2 text-xs text-mahakan-green-900">
          <strong>Filter aktif:</strong>{" "}
          {PAYMENT_OPTIONS.find((o) => o.value === paymentFilter)?.label} —
          metrics (revenue, transaksi, avg) di-restrict ke method ini.
          Hourly + kategori + top items tetap full data.
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4" role="status" aria-label="Memuat laporan">
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <Skeleton className="h-[320px] w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
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
                      {paymentMethodLabel(row.method)}
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
