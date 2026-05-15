"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Eye, Gift, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DateRangePicker,
  Skeleton,
  toast,
  type DateRangeValue,
} from "@/components/ui";
import {
  getRefundVoidComplimentReport,
  isOk,
  type RefundVoidComplimentEvent,
  type RefundVoidComplimentKind,
  type RefundVoidComplimentReport,
} from "@/features/reports";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./menu-engineering-csv";
import { buildRvcCsv } from "./refund-void-compliment-csv";
import { RefundVoidComplimentDetailModal } from "./RefundVoidComplimentDetailModal";

const KIND_LABEL: Record<RefundVoidComplimentKind, string> = {
  refund_full: "Refund Full",
  refund_partial: "Refund Partial",
  void: "Void",
  compliment: "Komplimen",
};

const KIND_VARIANT: Record<
  RefundVoidComplimentKind,
  "warning" | "neutral" | "info" | "danger"
> = {
  refund_full: "danger",
  refund_partial: "warning",
  void: "neutral",
  compliment: "info",
};

const ALL_KINDS: RefundVoidComplimentKind[] = [
  "refund_full",
  "refund_partial",
  "void",
  "compliment",
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultRange(): DateRangeValue {
  return { from: isoDaysAgo(6), to: isoToday() };
}

export function RefundVoidComplimentView() {
  const [range, setRange] = useState<DateRangeValue>(defaultRange());
  const [kindFilter, setKindFilter] = useState<Set<RefundVoidComplimentKind>>(
    () => new Set(ALL_KINDS),
  );
  const [searchAlasan, setSearchAlasan] = useState("");
  const [report, setReport] = useState<RefundVoidComplimentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<RefundVoidComplimentEvent | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true);
    setError(null);
    const kindArr: RefundVoidComplimentKind[] =
      kindFilter.size === ALL_KINDS.length
        ? []
        : Array.from(kindFilter);
    const res = await getRefundVoidComplimentReport(
      range.from,
      range.to,
      kindArr.length > 0 ? kindArr : undefined,
    );
    if (isOk(res)) setReport(res.data);
    else {
      setError(res.error.message);
      setReport(null);
    }
    setLoading(false);
  }, [range.from, range.to, kindFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function toggleKind(k: RefundVoidComplimentKind) {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      // Tidak boleh kosong; kalau staff uncheck semua, restore all
      if (next.size === 0) return new Set(ALL_KINDS);
      return next;
    });
  }

  const filteredEvents = useMemo(() => {
    if (!report) return [];
    if (!searchAlasan.trim()) return report.events;
    const q = searchAlasan.toLowerCase();
    return report.events.filter(
      (e) =>
        (e.reason ?? "").toLowerCase().includes(q) ||
        (e.cashierName ?? "").toLowerCase().includes(q) ||
        (e.transactionNumber ?? "").toLowerCase().includes(q),
    );
  }, [report, searchAlasan]);

  function onExportCsv() {
    if (!report) return;
    const csv = buildRvcCsv(report.events, report.totals, report.period);
    downloadCsv(`refund-void-compliment-${range.from}-${range.to}.csv`, csv);
    toast.success("Export CSV");
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Refund / Void / Komplimen
          </h2>
          <p className="text-xs text-neutral-500">
            Audit kejadian refund (full + partial), void, dan compliment.
            Klik baris untuk detail item + approver chain + inventory impact.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem]">
            <DateRangePicker
              ariaLabel="Periode refund/void/compliment"
              value={range}
              onChange={setRange}
            />
          </div>
          <Button
            variant="outline"
            onClick={onExportCsv}
            disabled={!report || loading || report.events.length === 0}
          >
            <Download className="size-4" /> CSV
          </Button>
        </div>
      </header>

      {/* Kind filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Filter Jenis:
        </span>
        {ALL_KINDS.map((k) => {
          const active = kindFilter.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? KIND_VARIANT[k] === "danger"
                    ? "border-danger-500 bg-danger-100 text-danger-500"
                    : KIND_VARIANT[k] === "warning"
                      ? "border-warning-500 bg-warning-50 text-warning-500"
                      : KIND_VARIANT[k] === "info"
                        ? "border-info-500 bg-info-100 text-info-500"
                        : "border-neutral-300 bg-neutral-100 text-neutral-700"
                  : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <Search className="size-3.5 text-neutral-400" />
          <input
            type="text"
            value={searchAlasan}
            onChange={(e) => setSearchAlasan(e.target.value)}
            placeholder="Cari alasan / kasir / no trx..."
            className="w-56 rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-mahakan-green-700 focus:outline-none"
          />
          {searchAlasan ? (
            <button
              type="button"
              onClick={() => setSearchAlasan("")}
              className="text-neutral-400 hover:text-neutral-700"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger-100 bg-danger-100 p-3 text-sm text-danger-500">
          {error}
        </div>
      ) : !report ? null : (
        <>
          {/* Stat cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Events"
              value={String(report.totals.grandEventCount)}
              subtitle={`${formatRupiah(report.totals.grandAmount)} dampak`}
              tone="neutral"
            />
            <StatCard
              title="Refund"
              value={String(
                report.totals.refundFullCount +
                  report.totals.refundPartialCount,
              )}
              subtitle={`${formatRupiah(
                report.totals.refundFullAmount +
                  report.totals.refundPartialAmount,
              )} (full + partial)`}
              tone={
                report.totals.refundFullCount +
                  report.totals.refundPartialCount >
                0
                  ? "warn"
                  : "neutral"
              }
            />
            <StatCard
              title="Void"
              value={String(report.totals.voidCount)}
              subtitle={`${formatRupiah(report.totals.voidAmount)} dibatalkan`}
              tone="neutral"
            />
            <StatCard
              title="Komplimen"
              value={String(report.totals.complimentCount)}
              subtitle={`${formatRupiah(report.totals.complimentAmount)} · COGS ${formatRupiah(report.totals.complimentCogsImpact)}`}
              tone={report.totals.complimentCount > 0 ? "info" : "neutral"}
            />
          </div>

          {/* Anomaly banner */}
          {report.anomalies.length > 0 ? (
            <div
              className={cn(
                "rounded-md border p-3 text-sm",
                report.anomalies.some((a) => a.severity === "danger")
                  ? "border-danger-100 bg-danger-100 text-danger-500"
                  : "border-warning-100 bg-warning-50 text-warning-500",
              )}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">
                    {report.anomalies.length} anomali terdeteksi
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs">
                    {report.anomalies.slice(0, 5).map((a, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="font-mono">·</span>
                        <span>{a.message}</span>
                      </li>
                    ))}
                    {report.anomalies.length > 5 ? (
                      <li className="text-[11px] italic opacity-70">
                        +{report.anomalies.length - 5} lainnya
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          {/* Truncation warning */}
          {report.truncated ? (
            <div className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 p-2 text-xs text-warning-500">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                Hasil dipotong (1000 events max). Persempit range tanggal atau
                filter jenis untuk lihat semua.
              </p>
            </div>
          ) : null}

          {/* Events table */}
          <Card>
            <CardHeader>
              <CardTitle>Daftar Events ({filteredEvents.length})</CardTitle>
              <CardDescription>
                Klik baris untuk detail item + approver chain + inventory
                impact.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {filteredEvents.length === 0 ? (
                <div className="py-8 text-center">
                  <Gift className="mx-auto mb-2 size-6 text-neutral-300" />
                  <p className="text-sm text-neutral-500">
                    {report.events.length === 0
                      ? "Belum ada event refund/void/komplimen di range ini."
                      : "Tidak ada event yang cocok dengan filter."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-50 text-neutral-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          Waktu
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Jenis
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          No Trx
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Kasir
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Customer
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Total Impact
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Approver
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Alasan
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Aksi
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((ev) => (
                        <tr
                          key={`${ev.kind}-${ev.eventId}`}
                          className="cursor-pointer border-t border-neutral-100 hover:bg-mahakan-green-50/30"
                          onClick={() => setDrillDown(ev)}
                        >
                          <td className="px-3 py-2 text-neutral-700">
                            {new Date(ev.occurredAt).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={KIND_VARIANT[ev.kind]}>
                              {KIND_LABEL[ev.kind]}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-neutral-700">
                            {ev.transactionNumber}
                          </td>
                          <td className="px-3 py-2 text-neutral-700">
                            {ev.cashierName ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-neutral-700">
                            {ev.customerName ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            {formatRupiah(ev.amountImpact)}
                          </td>
                          <td className="px-3 py-2 text-neutral-700">
                            {ev.approverName ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-neutral-600">
                            <span className="line-clamp-1 max-w-[200px]">
                              {ev.reason ?? "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Detail"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrillDown(ev);
                              }}
                            >
                              <Eye className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {drillDown ? (
        <RefundVoidComplimentDetailModal
          event={drillDown}
          onClose={() => setDrillDown(null)}
        />
      ) : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone: "neutral" | "warn" | "info";
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
            tone === "warn"
              ? "text-warning-500"
              : tone === "info"
                ? "text-info-500"
                : "text-neutral-900",
          )}
        >
          {value}
        </p>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
