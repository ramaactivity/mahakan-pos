"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DateRangePicker,
  Skeleton,
} from "@/components/ui";
import {
  getClosingShiftReport,
  isOk,
  type ClosingShiftReport,
  type ClosingShiftRow,
} from "@/features/reports";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return todayJakarta();
}

type SortKey = "date" | "variance" | "actualCash" | "kasir";

export function ClosingShiftView() {
  const [from, setFrom] = useState<string>(isoDaysAgo(6));
  const [to, setTo] = useState<string>(isoToday());
  const [report, setReport] = useState<ClosingShiftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getClosingShiftReport(from, to);
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      else setReport(null);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const sortedRows = useMemo(() => {
    if (!report) return [];
    const arr = [...report.rows];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.closedAt.localeCompare(b.closedAt);
      else if (sortKey === "variance") cmp = a.variance - b.variance;
      else if (sortKey === "actualCash") cmp = a.actualCash - b.actualCash;
      else cmp = a.userName.localeCompare(b.userName);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [report, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "date" ? "desc" : "desc");
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Laporan Closing Shift
          </h2>
          <p className="text-xs text-neutral-500">
            Ringkasan variance kas + settlement aggregator per shift yang sudah
            ditutup.
          </p>
        </div>
        <div className="min-w-[16rem]">
          <DateRangePicker
            ariaLabel="Periode laporan closing shift"
            value={{ from, to }}
            onChange={(v) => {
              setFrom(v.from ?? isoDaysAgo(6));
              setTo(v.to ?? isoToday());
            }}
          />
        </div>
      </header>

      {loading ? (
        <div className="space-y-4" role="status" aria-label="Memuat laporan">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : !report ? (
        <p className="text-sm text-danger-500">Gagal load laporan</p>
      ) : (
        <ReportBody
          report={report}
          rows={sortedRows}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      )}
    </div>
  );
}

function ReportBody({
  report,
  rows,
  sortKey,
  sortDir,
  onSort,
}: {
  report: ClosingShiftReport;
  rows: ClosingShiftRow[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const { totals, varianceThreshold } = report;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Shift Ditutup"
          value={String(totals.shiftCount)}
          subtitle={`${totals.overThresholdCount} di luar threshold ±${formatRupiah(varianceThreshold)}`}
          tone={totals.overThresholdCount > 0 ? "warn" : "neutral"}
        />
        <StatCard
          title="Total Variance"
          value={formatRupiah(totals.totalVariance)}
          subtitle={`Avg ${formatRupiah(totals.avgVariance)}`}
          tone={
            Math.abs(totals.totalVariance) > varianceThreshold * 2
              ? "warn"
              : "neutral"
          }
        />
        <StatCard
          title="Variance Tertinggi"
          value={formatRupiah(totals.biggestPositiveVariance)}
          subtitle={`Negatif terbesar ${formatRupiah(totals.biggestNegativeVariance)}`}
        />
        <StatCard
          title="Total Settlement Aggregator"
          value={formatRupiah(totals.totalSettlement)}
          subtitle="EDC + GoFood + GrabFood + ShopeeFood"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail Shift</CardTitle>
          <CardDescription>
            Klik header untuk urutkan. Warna variance: hijau (dalam threshold),
            merah (di luar threshold ±{formatRupiah(varianceThreshold)}).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              Belum ada shift yang ditutup dalam range ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <SortableTh
                      label="Tanggal Tutup"
                      onClick={() => onSort("date")}
                      active={sortKey === "date"}
                      dir={sortDir}
                    />
                    <SortableTh
                      label="Kasir"
                      onClick={() => onSort("kasir")}
                      active={sortKey === "kasir"}
                      dir={sortDir}
                    />
                    <th className="px-3 py-2 text-right">Kas Awal</th>
                    <th className="px-3 py-2 text-right">Penjualan Cash</th>
                    <th className="px-3 py-2 text-right">Refund Cash</th>
                    <th className="px-3 py-2 text-right">Kas Harusnya</th>
                    <SortableTh
                      label="Kas Aktual"
                      onClick={() => onSort("actualCash")}
                      active={sortKey === "actualCash"}
                      dir={sortDir}
                      align="right"
                    />
                    <SortableTh
                      label="Variance"
                      onClick={() => onSort("variance")}
                      active={sortKey === "variance"}
                      dir={sortDir}
                      align="right"
                    />
                    <th className="px-3 py-2 text-right">Settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const overThreshold =
                      Math.abs(r.variance) > varianceThreshold;
                    return (
                      <tr
                        key={r.shiftId}
                        className="border-t border-neutral-100"
                      >
                        <td className="px-3 py-2">
                          <div className="text-neutral-900">{r.shiftDate}</div>
                          <div className="text-[11px] text-neutral-500">
                            {new Date(r.openedAt).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" → "}
                            {new Date(r.closedAt).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-neutral-900">
                          {r.userName}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatRupiah(r.openingCash)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatRupiah(r.paidCash)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-danger-500">
                          {r.refundedCash > 0
                            ? `-${formatRupiah(r.refundedCash)}`
                            : formatRupiah(0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatRupiah(r.expectedCash)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatRupiah(r.actualCash)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Badge
                            variant={overThreshold ? "danger" : "neutral"}
                            className={cn(
                              "font-mono",
                              !overThreshold && "bg-mahakan-green-50 text-mahakan-green-900",
                            )}
                          >
                            {r.variance > 0 ? "+" : ""}
                            {formatRupiah(r.variance)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-neutral-700">
                          {formatRupiah(r.settlementTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-neutral-50 text-xs font-semibold uppercase tracking-wider text-neutral-600">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(totals.totalPaidCash)}
                    </td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(totals.totalActualCash)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(totals.totalVariance)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(totals.totalSettlement)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableTh({
  label,
  onClick,
  active,
  dir,
  align = "left",
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: "asc" | "desc";
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "cursor-pointer select-none px-3 py-2 hover:bg-neutral-100",
        align === "right" ? "text-right" : "text-left",
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : null}
      </span>
    </th>
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
          className={cn(
            "font-mono text-xl font-bold",
            tone === "warn" ? "text-warning-500" : "text-neutral-900",
          )}
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
