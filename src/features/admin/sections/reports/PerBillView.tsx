"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import Papa from "papaparse";
import {
  Badge,
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
  getBillPerformanceReport,
  isOk,
  type BillPerformanceReport,
  type BillRow,
} from "@/features/reports";
import type { PaymentMethod } from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-method";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./menu-engineering-csv";
import { todayJakarta } from "@/lib/tz";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return todayJakarta();
}

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

export function PerBillView() {
  const [from, setFrom] = useState<string>(isoDaysAgo(6));
  const [to, setTo] = useState<string>(isoToday());
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [report, setReport] = useState<BillPerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getBillPerformanceReport(from, to, paymentFilter);
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      else setReport(null);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to, paymentFilter]);

  function onExportCsv() {
    if (!report) return;
    const data = report.rows.map((r) => ({
      No: r.transactionNumber,
      "Tanggal/Jam": new Date(r.closedAt).toLocaleString("id-ID"),
      Kasir: r.userName ?? "-",
      Customer: r.customerName ?? "-",
      Total: r.total,
      Refund: r.refundedAmount,
      "Total Net": r.netTotal,
      Payment: paymentMethodLabel(r.paymentMethod),
      Status: r.status,
    }));
    const csv = Papa.unparse(data, { newline: "\n" });
    downloadCsv(`per-bill-${from}-to-${to}.csv`, csv);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Laporan Per-Bill
          </h2>
          <p className="text-xs text-neutral-500">
            Statistik bill (rata-rata, median, distribusi) + tabel transaksi.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem]">
            <DateRangePicker
              ariaLabel="Periode laporan per-bill"
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
            onClick={onExportCsv}
            disabled={!report || loading || report.rows.length === 0}
          >
            <Download className="size-4" /> Export CSV
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-4" role="status" aria-label="Memuat laporan">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : !report ? (
        <p className="text-sm text-danger-500">Gagal load laporan</p>
      ) : (
        <Body report={report} />
      )}
    </div>
  );
}

function Body({ report }: { report: BillPerformanceReport }) {
  const { stats, buckets, rows, truncated } = report;
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  }, [rows]);

  return (
    <div className="space-y-4">
      {truncated ? (
        <div className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Hasil dibatasi 1.000 transaksi.</p>
            <p className="text-xs">
              Statistik di atas tetap akurat (hitung semua transaksi). Tapi
              tabel cuma tampilkan 1.000 terbaru. Persempit range tanggal untuk
              lihat semua bill.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Jumlah Bill"
          value={String(stats.count)}
          subtitle={`Total revenue ${formatRupiah(stats.totalRevenue)}`}
        />
        <StatCard
          title="Avg per Bill"
          value={formatRupiah(stats.avgBill)}
          subtitle="Rata-rata"
        />
        <StatCard
          title="Median"
          value={formatRupiah(stats.medianBill)}
          subtitle="Nilai tengah"
        />
        <StatCard
          title="Bill Tertinggi"
          value={formatRupiah(stats.maxBill)}
          subtitle={`Terendah ${formatRupiah(stats.minBill)}`}
        />
        <StatCard
          title="Mayoritas Bill"
          value={
            stats.modeBucket
              ? buckets.find((b) => b.key === stats.modeBucket)?.label ?? "-"
              : "-"
          }
          subtitle="Bucket dengan trx terbanyak"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Distribusi Bill</CardTitle>
          <CardDescription>
            Sebaran transaksi per rentang nilai. Klik untuk lihat profile
            customer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats.count === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Belum ada bill di range ini.
            </p>
          ) : (
            <div className="space-y-2">
              {buckets.map((b) => {
                const maxCount = Math.max(...buckets.map((x) => x.count), 1);
                const barWidth = `${Math.round((b.count / maxCount) * 100)}%`;
                return (
                  <div key={b.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-neutral-700">
                        {b.label}
                      </span>
                      <span className="font-mono text-neutral-600">
                        {b.count} bill · {b.pctOfCount}% ·{" "}
                        {formatRupiah(b.revenue)}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          b.key === stats.modeBucket
                            ? "bg-mahakan-green-700"
                            : "bg-mahakan-green-100",
                        )}
                        style={{ width: barWidth }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Bill</CardTitle>
          <CardDescription>
            Tabel transaksi terbaru, sort by waktu (terbaru dulu).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {sortedRows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              Belum ada bill.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">No</th>
                    <th className="px-3 py-2 text-left">Tanggal/Jam</th>
                    <th className="px-3 py-2 text-left">Kasir</th>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-left">Payment</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <BillRowItem key={r.transactionId} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BillRowItem({ row: r }: { row: BillRow }) {
  return (
    <tr className="border-t border-neutral-100">
      <td className="px-3 py-2 font-mono text-xs text-neutral-700">
        {r.transactionNumber}
      </td>
      <td className="px-3 py-2 text-neutral-700">
        {new Date(r.closedAt).toLocaleString("id-ID", {
          year: "2-digit",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </td>
      <td className="px-3 py-2 text-neutral-700">{r.userName ?? "-"}</td>
      <td className="px-3 py-2 text-neutral-700">{r.customerName ?? "-"}</td>
      <td className="px-3 py-2 text-neutral-700">
        {paymentMethodLabel(r.paymentMethod)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatRupiah(r.total)}
      </td>
      <td className="px-3 py-2 text-right font-mono font-semibold text-neutral-900">
        {formatRupiah(r.netTotal)}
      </td>
      <td className="px-3 py-2">
        <Badge variant={r.status === "paid" ? "paid" : "refunded"}>
          {r.status === "paid" ? "Paid" : "Partial refund"}
        </Badge>
      </td>
    </tr>
  );
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-lg font-bold text-neutral-900 break-words">
          {value}
        </p>
        {subtitle ? (
          <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
