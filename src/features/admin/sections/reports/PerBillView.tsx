"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
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
import { ExportWorkbookButton } from "../ExportWorkbookButton";
import { downloadCsvForExcel } from "./report-export";
import type { StyledCol, StyledSheet } from "@/lib/xlsx-styled";
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
  const [onlyReduced, setOnlyReduced] = useState(false);

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

  /* Sesi AE-234 — WIB wall-clock parts; Excel gets a real date + text time. */
  const wib = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
    return {
      date: new Date(Date.UTC(+g("year"), +g("month") - 1, +g("day"))),
      text: `${g("day")}/${g("month")}/${g("year")}`,
      time: `${g("hour")}:${g("minute")}`,
    };
  };
  const minutesOpen = (r: BillRow) =>
    r.paidAt ? Math.round((Date.parse(r.paidAt) - Date.parse(r.closedAt)) / 60000) : null;

  async function downloadExcel() {
    if (!report || report.rows.length === 0) throw new Error("EMPTY");
    const { downloadStyledXlsx } = await import("@/lib/xlsx-styled");
    const cols: Array<StyledCol<BillRow>> = [
      { header: "No", width: 6, fmt: "int", total: false, formula: (r, ctx) => `ROW()-${ctx.firstRow - 1}` },
      { header: "No. Transaksi", value: (r) => r.transactionNumber, width: 20 },
      { header: "Tanggal", value: (r) => wib(r.closedAt).date, fmt: "date", width: 12 },
      { header: "Jam Pesan", value: (r) => wib(r.closedAt).time, width: 10 },
      { header: "Jam Bayar", value: (r) => (r.paidAt ? wib(r.paidAt).time : wib(r.closedAt).time), width: 10 },
      { header: "Lama Terbuka (mnt)", value: minutesOpen, fmt: "int", width: 12, total: false },
      { header: "Kasir", value: (r) => r.userName ?? "-", width: 12 },
      { header: "Tamu", value: (r) => r.customerName ?? "-", width: 14 },
      { header: "Item", value: (r) => r.items, width: 40, wrap: true },
      { header: "Metode Bayar", value: (r) => paymentMethodLabel(r.paymentMethod), width: 13 },
      { header: "Total Tertinggi", value: (r) => r.peakTotal, fmt: "money", width: 14 },
      { header: "Total Dibayar", value: (r) => r.total, fmt: "money", width: 14 },
      { header: "Turun Setelah Pesan", value: (r) => r.reducedBy || null, fmt: "money", width: 14 },
      { header: "Jumlah Edit", value: (r) => r.editCount, fmt: "int", width: 9 },
      { header: "Diskon", value: (r) => r.discountAmount || null, fmt: "money", width: 12 },
      { header: "Alasan Diskon", value: (r) => r.discountReason, width: 22, wrap: true },
      { header: "Uang Diterima", value: (r) => r.cashReceived, fmt: "money", width: 14, total: false },
      { header: "Kembalian", value: (r) => r.cashChange, fmt: "money", width: 12, total: false },
      { header: "Refund", value: (r) => r.refundedAmount || null, fmt: "money", width: 12 },
      { header: "Total Net", value: (r) => r.netTotal, fmt: "money", width: 14 },
      { header: "Status", value: (r) => (r.status === "paid" ? "Lunas" : "Refund sebagian"), width: 14 },
    ];
    const rows = [...report.rows].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
    const reduced = rows.filter((r) => r.reducedBy > 0);
    const [fy, fm, fd] = from.split("-");
    const [ty, tm, td] = to.split("-");
    const sub = `Mahakan Coffee & Space · periode ${fd}/${fm}/${fy} s/d ${td}/${tm}/${ty} · ${PAYMENT_OPTIONS.find((o) => o.value === paymentFilter)?.label ?? ""} · jam dalam WIB`;
    const sheets: Array<StyledSheet<BillRow>> = [
      {
        name: "Per Bill",
        title: "Laporan Per-Bill",
        subtitle: sub,
        notes: [
          `${rows.length} bill · total dibayar Rp ${rows.reduce((s, r) => s + r.total, 0).toLocaleString("id-ID")}`,
          `${reduced.length} bill totalnya turun setelah dipesan (Rp ${reduced.reduce((s, r) => s + r.reducedBy, 0).toLocaleString("id-ID")}) — ditandai merah.`,
        ],
        cols,
        rows,
        totalRow: true,
        rowTone: (r) => (r.reducedBy > 0 ? "danger" : null),
      },
    ];
    if (reduced.length > 0) {
      sheets.push({
        name: "Bill Turun",
        title: "Bill yang Totalnya Turun Setelah Dipesan",
        subtitle: sub,
        notes: ["Cocokkan dengan CCTV: uang yang diserahkan tamu dan jam tamu membayar."],
        cols,
        rows: reduced,
        totalRow: true,
        rowTone: () => "danger",
      });
    }
    await downloadStyledXlsx(
      `per-bill-${from}-sd-${to}`,
      sheets as unknown as Array<StyledSheet<never>>,
    );
  }

  function downloadCsv() {
    if (!report) return;
    downloadCsvForExcel(
      `per-bill-${from}-sd-${to}`,
      report.rows.map((r) => ({
        "No. Transaksi": r.transactionNumber,
        Tanggal: wib(r.closedAt).text,
        "Jam Pesan": wib(r.closedAt).time,
        "Jam Bayar": r.paidAt ? wib(r.paidAt).time : wib(r.closedAt).time,
        "Lama Terbuka (mnt)": minutesOpen(r),
        Kasir: r.userName ?? "-",
        Tamu: r.customerName ?? "-",
        Item: r.items,
        "Metode Bayar": paymentMethodLabel(r.paymentMethod),
        "Total Tertinggi": r.peakTotal,
        "Total Dibayar": r.total,
        "Turun Setelah Pesan": r.reducedBy,
        "Jumlah Edit": r.editCount,
        Diskon: r.discountAmount,
        "Alasan Diskon": r.discountReason ?? "",
        "Uang Diterima": r.cashReceived,
        Kembalian: r.cashChange,
        Refund: r.refundedAmount,
        "Total Net": r.netTotal,
        Status: r.status === "paid" ? "Lunas" : "Refund sebagian",
      })),
    );
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
          <label className="flex h-10 items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={onlyReduced}
              onChange={(e) => setOnlyReduced(e.target.checked)}
            />
            Hanya bill yang totalnya turun
          </label>
          <ExportWorkbookButton build={downloadExcel} label="Excel" />
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={!report || loading || report.rows.length === 0}
          >
            <FileText className="size-4" /> CSV
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
        <Body report={report} onlyReduced={onlyReduced} />
      )}
    </div>
  );
}

function Body({
  report,
  onlyReduced,
}: {
  report: BillPerformanceReport;
  onlyReduced: boolean;
}) {
  const { stats, buckets, rows, truncated } = report;
  const sortedRows = useMemo(() => {
    return rows
      .filter((r) => !onlyReduced || r.reducedBy > 0)
      .sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  }, [rows, onlyReduced]);
  const reduced = rows.filter((r) => r.reducedBy > 0);
  const reducedSum = reduced.reduce((s, r) => s + r.reducedBy, 0);

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

      {reduced.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-danger-100 bg-danger-100/50 p-3 text-sm text-danger-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-semibold">
              {reduced.length} bill totalnya turun setelah dipesan (total{" "}
              {formatRupiah(reducedSum)}).
            </span>{" "}
            Item dihapus/diganti setelah bill dibuka. Cocokkan dengan CCTV &
            detail di Audit Log.
          </p>
        </div>
      ) : null}

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
                    <th className="px-3 py-2 text-left">Dibuka / Dibayar</th>
                    <th className="px-3 py-2 text-left">Kasir</th>
                    <th className="px-3 py-2 text-left">Customer / Item</th>
                    <th className="px-3 py-2 text-left">Payment</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-left">Riwayat Edit</th>
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

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function BillRowItem({ row: r }: { row: BillRow }) {
  const minutesOpen = r.paidAt
    ? Math.round((Date.parse(r.paidAt) - Date.parse(r.closedAt)) / 60000)
    : null;
  return (
    <tr
      className={cn(
        "border-t border-neutral-100 align-top",
        r.reducedBy > 0 && "bg-danger-100/40",
      )}
    >
      <td className="px-3 py-2 font-mono text-xs text-neutral-700">
        {r.transactionNumber}
      </td>
      <td className="px-3 py-2 text-xs text-neutral-700">
        <div>{fmtTime(r.closedAt)}</div>
        {r.paidAt ? (
          <div className="text-neutral-500">
            bayar {fmtTime(r.paidAt)}
            {minutesOpen !== null ? ` (${minutesOpen} mnt)` : ""}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-neutral-700">{r.userName ?? "-"}</td>
      <td className="px-3 py-2 text-neutral-700">
        <div>{r.customerName ?? "-"}</div>
        <div className="text-xs text-neutral-500">{r.items}</div>
      </td>
      <td className="px-3 py-2 text-neutral-700">
        <div>{paymentMethodLabel(r.paymentMethod)}</div>
        {r.cashReceived !== null ? (
          <div className="text-xs text-neutral-500">
            terima {formatRupiah(r.cashReceived)} · kembali{" "}
            {formatRupiah(r.cashChange ?? 0)}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatRupiah(r.total)}
        {r.discountAmount > 0 ? (
          <div className="text-xs text-neutral-500">
            diskon {formatRupiah(r.discountAmount)}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-xs">
        {r.reducedBy > 0 ? (
          <span className="font-semibold text-danger-500">
            Turun {formatRupiah(r.reducedBy)} (dari {formatRupiah(r.peakTotal)})
          </span>
        ) : r.isOpenBill ? (
          <span className="text-neutral-500">Open bill</span>
        ) : null}
        {r.editCount > 0 ? (
          <div className="text-neutral-500">{r.editCount}× edit</div>
        ) : null}
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
