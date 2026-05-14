"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Search,
  TrendingUp,
} from "lucide-react";
import {
  Button,
  DateRangePicker,
  Skeleton,
  type DateRangeValue,
} from "@/components/ui";
import {
  fetchAggregatorSettlements,
  fetchSettlementReconciliation,
} from "@/features/finance/actions";
import type {
  AggregatorChannel,
  ReconciliationStatus,
  SettlementReconciliationReport,
  SettlementReconciliationRow,
} from "@/features/finance/types";
import {
  getClosingShiftReport,
  isOk as isReportOk,
  type ClosingShiftReport,
} from "@/features/reports";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { formatIndonesianDate, formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { AggregatorSettlementModal } from "./AggregatorSettlementModal";
import { ReconciliationDrillDownModal } from "./ReconciliationDrillDownModal";

const CHANNEL_LABEL: Record<AggregatorChannel, string> = {
  cash: "Cash (Tunai)",
  edc_bca: "EDC BCA",
  qris: "QRIS",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
};

const STATUS_BADGE: Record<
  ReconciliationStatus,
  { label: string; className: string }
> = {
  open: { label: "Open", className: "bg-neutral-100 text-neutral-700" },
  investigating: {
    label: "Investigating",
    className: "bg-warning-50 text-warning-500",
  },
  resolved: {
    label: "Resolved",
    className: "bg-mahakan-green-50 text-mahakan-green-900",
  },
  disputed: {
    label: "Disputed",
    className: "bg-danger-100 text-danger-500",
  },
};

interface Props {
  viewerRole: Role;
}

function defaultRange(): DateRangeValue {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const today = new Date(now.getTime() + wibOffset);
  const past = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    from: past.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

export function ReconciliationView({ viewerRole }: Props) {
  const [range, setRange] = useState<DateRangeValue>(defaultRange());
  const [report, setReport] = useState<SettlementReconciliationReport | null>(
    null,
  );
  const [closingShift, setClosingShift] = useState<ClosingShiftReport | null>(
    null,
  );
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof fetchAggregatorSettlements>> extends infer R
      ? R extends { ok: true; data: infer D }
        ? D
        : never
      : never
  >([] as never);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [drillDownRow, setDrillDownRow] =
    useState<SettlementReconciliationRow | null>(null);

  const canCreate = hasPermission(viewerRole, "aggregator_settlement.create");

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true);
    setError(null);
    try {
      const [reconRes, histRes, closingRes] = await Promise.all([
        fetchSettlementReconciliation(range.from, range.to),
        fetchAggregatorSettlements({
          fromDate: range.from,
          toDate: range.to,
        }),
        getClosingShiftReport(range.from, range.to),
      ]);
      if (reconRes.ok) setReport(reconRes.data);
      else setError(reconRes.error.message);
      if (histRes.ok) setHistory(histRes.data as never);
      if (isReportOk(closingRes)) setClosingShift(closingRes.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker label="Rentang" value={range} onChange={setRange} />
        <div className="ml-auto" />
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Catat Settlement
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger-100 bg-danger-100 p-4 text-sm text-danger-500">
          {error}
        </div>
      ) : !report ? null : (
        <>
          <StatsRow report={report} closingShift={closingShift} />
          {report.anomalies.length > 0 ? (
            <AnomalyBanner anomalies={report.anomalies} />
          ) : null}

          <ReconciliationTable
            report={report}
            onRowClick={(r) => setDrillDownRow(r)}
          />

          {closingShift ? (
            <RiwayatClosingShift closingShift={closingShift} />
          ) : null}

          <AggregatorHistorySection
            history={history}
            channelLabel={CHANNEL_LABEL}
          />
        </>
      )}

      <AggregatorSettlementModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />

      {drillDownRow ? (
        <ReconciliationDrillDownModal
          open={true}
          onClose={() => setDrillDownRow(null)}
          channel={drillDownRow.channel}
          fromDate={range.from ?? defaultRange().from!}
          toDate={range.to ?? defaultRange().to!}
          currentStatus={drillDownRow.status}
          currentNote={drillDownRow.note}
          viewerRole={viewerRole}
          onStatusSaved={() => {
            setDrillDownRow(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function StatsRow({
  report,
  closingShift,
}: {
  report: SettlementReconciliationReport;
  closingShift: ClosingShiftReport | null;
}) {
  const { totals, anomalies } = report;
  const accuracyColor =
    totals.accuracyPct >= 99
      ? "text-mahakan-green-700"
      : totals.accuracyPct >= 90
        ? "text-warning-500"
        : "text-danger-500";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Penerimaan"
        value={formatRupiah(totals.totalReceived)}
        subtitle={
          closingShift
            ? `${closingShift.totals.shiftCount} shift closed`
            : "Semua channel"
        }
      />
      <StatCard
        title="Total Selisih"
        value={formatRupiah(totals.totalVariance)}
        subtitle={
          totals.totalVariance > 0
            ? "Variance absolut semua channel"
            : "Tidak ada selisih"
        }
        tone={totals.totalVariance > 0 ? "warn" : "neutral"}
      />
      <StatCard
        title="Akurasi Rekonsiliasi"
        value={`${totals.accuracyPct}%`}
        subtitle={
          totals.accuracyPct >= 99
            ? "Sangat baik"
            : totals.accuracyPct >= 90
              ? "Perlu perhatian"
              : "Audit segera"
        }
        valueClassName={accuracyColor}
      />
      <StatCard
        title="Anomali Terdeteksi"
        value={String(anomalies.length)}
        subtitle={
          anomalies.length === 0
            ? "Tidak ada peringatan"
            : `${anomalies.filter((a) => a.severity === "danger").length} kritikal`
        }
        tone={anomalies.length > 0 ? "warn" : "neutral"}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone = "neutral",
  valueClassName,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: "neutral" | "warn";
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-xl font-bold",
          valueClassName ??
            (tone === "warn" ? "text-warning-500" : "text-neutral-900"),
        )}
      >
        {value}
      </p>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
      ) : null}
    </div>
  );
}

function AnomalyBanner({
  anomalies,
}: {
  anomalies: SettlementReconciliationReport["anomalies"];
}) {
  const dangerCount = anomalies.filter((a) => a.severity === "danger").length;
  const isHigh = dangerCount > 0;
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        isHigh
          ? "border-danger-100 bg-danger-100 text-danger-500"
          : "border-warning-100 bg-warning-50 text-warning-500",
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">
            {anomalies.length} anomali terdeteksi
            {isHigh ? ` (${dangerCount} kritikal)` : ""}
          </p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {anomalies.slice(0, 5).map((a, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="font-mono">·</span>
                <span>{a.message}</span>
              </li>
            ))}
            {anomalies.length > 5 ? (
              <li className="text-[11px] italic opacity-70">
                +{anomalies.length - 5} lainnya
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ReconciliationTable({
  report,
  onRowClick,
}: {
  report: SettlementReconciliationReport;
  onRowClick: (r: SettlementReconciliationRow) => void;
}) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <h3 className="text-sm font-semibold text-neutral-900">
          Rekonsiliasi per Channel
        </h3>
        <p className="text-[11px] text-neutral-500">
          Klik baris untuk drill-down + set status
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Channel</th>
              <th className="px-3 py-2 text-right font-medium">
                POS Actual
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Kasir Lapor
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Aggregator / Bank
              </th>
              <th className="px-3 py-2 text-right font-medium">Fee</th>
              <th className="px-3 py-2 text-right font-medium">Net</th>
              <th className="px-3 py-2 text-right font-medium">
                Selisih (POS vs Lapor)
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Selisih (Lapor vs Bank/Agg)
              </th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => {
              const isCash = r.channel === "cash";
              const aggOrBank = isCash ? r.bankSettled : r.aggregatorGross;
              const v1 = isCash
                ? r.varianceCashPosVsReported
                : r.posActual - r.reportedFromShifts;
              const v2 = isCash
                ? r.varianceCashReportedVsBank
                : r.variancePosVsAggregator;
              const status = STATUS_BADGE[r.status];
              return (
                <tr
                  key={r.channel}
                  className="cursor-pointer border-t border-neutral-100 hover:bg-mahakan-green-50/40"
                  onClick={() => onRowClick(r)}
                >
                  <td className="px-3 py-2 font-medium text-neutral-900">
                    {CHANNEL_LABEL[r.channel]}
                    {isCash ? (
                      <span className="ml-1 text-[10px] font-normal text-neutral-500">
                        (3-way)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatRupiah(r.posActual)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatRupiah(r.reportedFromShifts)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatRupiah(aggOrBank)}
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-500 font-mono">
                    {isCash ? "—" : formatRupiah(r.aggregatorFee)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {isCash ? "—" : formatRupiah(r.aggregatorNet)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <VarianceCell value={v1} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <VarianceCell value={v2} />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        status.className,
                      )}
                    >
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VarianceCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-neutral-400">—</span>;
  if (value === 0)
    return (
      <span className="inline-flex items-center gap-1 font-mono text-mahakan-green-700">
        <CheckCircle2 className="size-3" />
        Rp 0
      </span>
    );
  return (
    <span
      className={cn(
        "font-mono font-semibold",
        value > 0 ? "text-warning-500" : "text-danger-500",
      )}
    >
      {value > 0 ? "+" : ""}
      {formatRupiah(value)}
    </span>
  );
}

function RiwayatClosingShift({
  closingShift,
}: {
  closingShift: ClosingShiftReport;
}) {
  const top10 = closingShift.rows.slice(0, 10);
  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <TrendingUp className="size-4" />
          Riwayat Closing Shift
        </h3>
        <p className="text-[11px] text-neutral-500">
          {closingShift.totals.shiftCount} shift · Total variance{" "}
          <span
            className={cn(
              "font-mono font-semibold",
              Math.abs(closingShift.totals.totalVariance) >
                closingShift.varianceThreshold
                ? "text-danger-500"
                : "text-mahakan-green-700",
            )}
          >
            {closingShift.totals.totalVariance > 0 ? "+" : ""}
            {formatRupiah(closingShift.totals.totalVariance)}
          </span>
        </p>
      </header>
      {closingShift.rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-neutral-500">
          <Search className="mx-auto mb-2 size-6 text-neutral-300" />
          Belum ada shift yang ditutup di range ini.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tanggal</th>
                <th className="px-3 py-2 text-left font-medium">Kasir</th>
                <th className="px-3 py-2 text-right font-medium">Kas Awal</th>
                <th className="px-3 py-2 text-right font-medium">
                  Penjualan Tunai
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Kas Aktual
                </th>
                <th className="px-3 py-2 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((r) => {
                const over = Math.abs(r.variance) > closingShift.varianceThreshold;
                return (
                  <tr key={r.shiftId} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-900">
                      {r.shiftDate}
                    </td>
                    <td className="px-3 py-2">{r.userName}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(r.openingCash)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(r.paidCash)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(r.actualCash)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold",
                          over
                            ? "bg-danger-100 text-danger-500"
                            : "bg-mahakan-green-50 text-mahakan-green-900",
                        )}
                      >
                        {r.variance > 0 ? "+" : ""}
                        {formatRupiah(r.variance)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {closingShift.rows.length > 10 ? (
            <p className="border-t border-neutral-100 px-3 py-1.5 text-center text-[11px] text-neutral-500">
              +{closingShift.rows.length - 10} shift lainnya. Lihat detail di
              Reports → Closing Shift.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AggregatorHistorySection({
  history,
  channelLabel,
}: {
  history: Array<{
    id: string;
    channel: AggregatorChannel;
    periodFrom: string;
    periodTo: string;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
    referenceNo: string | null;
    createdByName: string | null;
    createdAt: Date;
  }>;
  channelLabel: Record<AggregatorChannel, string>;
}) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <header className="border-b border-neutral-200 px-4 py-2 text-sm font-semibold">
        Riwayat Settlement Aggregator ({history.length})
      </header>
      {history.length === 0 ? (
        <div className="p-6 text-center text-sm text-neutral-500">
          Belum ada settlement aggregator di range ini.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Channel</th>
                <th className="px-3 py-2 text-left font-medium">Periode</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="px-3 py-2 text-left font-medium">Ref</th>
                <th className="px-3 py-2 text-left font-medium">Dicatat</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.id}
                  className="border-t border-neutral-100 hover:bg-neutral-50"
                >
                  <td className="px-3 py-2 font-medium">
                    {channelLabel[h.channel]}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {formatIndonesianDate(h.periodFrom)} →{" "}
                    {formatIndonesianDate(h.periodTo)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold font-mono">
                    {formatRupiah(h.grossAmount)}
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-500 font-mono">
                    {formatRupiah(h.feeAmount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatRupiah(h.netAmount)}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">
                    {h.referenceNo ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">
                    {h.createdByName ?? "—"} ·{" "}
                    {formatIndonesianDateTime(h.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
