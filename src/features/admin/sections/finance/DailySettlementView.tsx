"use client";

import { useEffect, useState } from "react";
import { fetchDailySettlement } from "@/features/finance/actions";
import type { DailySettlementReport } from "@/features/finance/types";
import { DatePicker, Skeleton } from "@/components/ui";
import { formatRupiah } from "@/lib/money";
import { formatIndonesianTime } from "@/lib/date";
import { cn } from "@/lib/utils";

const CHANNEL_LABEL: Record<string, string> = {
  cash: "Tunai",
  card_bca: "EDC BCA",
  qris: "QRIS",
  edc: "EDC BCA",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
};

function todayIso(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wib = new Date(now.getTime() + wibOffset);
  return wib.toISOString().slice(0, 10);
}

export function DailySettlementView() {
  const [date, setDate] = useState<string | null>(todayIso());
  const [report, setReport] = useState<DailySettlementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchDailySettlement(date)
      .then((res) => {
        if (res.ok) setReport(res.data);
        else setError(res.error.message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [date]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <DatePicker
          label="Tanggal"
          value={date}
          onChange={(v) => setDate(v ?? todayIso())}
        />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : !report ? null : report.shifts.length === 0 ? (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
          Tidak ada shift di tanggal {date}.
        </div>
      ) : (
        <>
          <SettlementTotals report={report} />
          <ShiftsTable report={report} />
        </>
      )}
    </div>
  );
}

function SettlementTotals({ report }: { report: DailySettlementReport }) {
  const t = report.totals;
  const cashOk = t.cashVariance === 0;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-md border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">
          Tunai (Cash)
        </h2>
        <KvRow label="Kas Awal" value={formatRupiah(t.openingCash)} />
        <KvRow label="Penjualan Tunai" value={formatRupiah(t.cashSales)} />
        <KvRow
          label="Pengeluaran Tunai"
          value={`- ${formatRupiah(t.cashExpenses)}`}
        />
        <KvRow
          label="Refund Tunai"
          value={`- ${formatRupiah(t.refundedCash)}`}
        />
        <hr className="my-2" />
        <KvRow
          label="Kas Diharapkan"
          value={formatRupiah(t.expectedCash)}
          bold
        />
        <KvRow
          label="Kas Aktual (kasir hitung)"
          value={formatRupiah(t.actualCashCounted)}
          bold
        />
        <KvRow
          label="Selisih"
          value={formatRupiah(t.cashVariance)}
          variance={cashOk ? null : t.cashVariance}
          bold
        />
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">
          Cashless per Channel
        </h2>
        <table className="w-full text-xs">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-1 text-left font-medium">Channel</th>
              <th className="py-1 text-right font-medium">Reported</th>
              <th className="py-1 text-right font-medium">Actual POS</th>
              <th className="py-1 text-right font-medium">Selisih</th>
            </tr>
          </thead>
          <tbody>
            <ChannelRow
              label="EDC BCA"
              reported={t.edcReported}
              actual={t.cardBcaActual}
            />
            <ChannelRow
              label="QRIS"
              reported={null}
              actual={t.qrisActual}
              note="Tidak ada field reported"
            />
            <ChannelRow
              label="GoFood"
              reported={t.gofoodReported}
              actual={null}
              note="Aggregator only"
            />
            <ChannelRow
              label="GrabFood"
              reported={t.grabfoodReported}
              actual={null}
              note="Aggregator only"
            />
            <ChannelRow
              label="ShopeeFood"
              reported={t.shopeefoodReported}
              actual={null}
              note="Aggregator only"
            />
          </tbody>
        </table>

        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <Stat label="Trx Paid" value={String(t.paidCount)} />
          <Stat label="Voided" value={String(t.voidedCount)} />
          <Stat label="Refunded" value={String(t.refundedCount)} />
        </div>
      </section>
    </div>
  );
}

function ShiftsTable({ report }: { report: DailySettlementReport }) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <header className="border-b border-neutral-200 px-4 py-2 text-sm font-semibold">
        Per-Shift Detail ({report.shifts.length})
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Kasir</th>
              <th className="px-3 py-2 text-left font-medium">Buka → Tutup</th>
              <th className="px-3 py-2 text-right font-medium">Kas Awal</th>
              <th className="px-3 py-2 text-right font-medium">Cash Sales</th>
              <th className="px-3 py-2 text-right font-medium">Expected</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-3 py-2 text-right font-medium">Selisih</th>
              <th className="px-3 py-2 text-right font-medium">EDC Reported</th>
              <th className="px-3 py-2 text-right font-medium">EDC Actual</th>
              <th className="px-3 py-2 text-right font-medium">EDC Selisih</th>
              <th className="px-3 py-2 text-right font-medium">QRIS Actual</th>
            </tr>
          </thead>
          <tbody>
            {report.shifts.map((s) => (
              <tr
                key={s.shiftId}
                className="border-t border-neutral-100 hover:bg-neutral-50"
              >
                <td className="px-3 py-2 font-medium">{s.cashierName}</td>
                <td className="px-3 py-2 text-neutral-600">
                  {formatIndonesianTime(s.openedAt)} →{" "}
                  {s.closedAt ? formatIndonesianTime(s.closedAt) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatRupiah(s.openingCash)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatRupiah(s.cashSales)}
                </td>
                <td className="px-3 py-2 text-right">
                  {s.expectedCash !== null ? formatRupiah(s.expectedCash) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {s.actualCash !== null ? formatRupiah(s.actualCash) : "—"}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-medium",
                    s.cashVariance === null
                      ? "text-neutral-400"
                      : s.cashVariance === 0
                        ? "text-mahakan-green-700"
                        : Math.abs(s.cashVariance) > 10_000
                          ? "text-red-700"
                          : "text-amber-700",
                  )}
                >
                  {s.cashVariance !== null
                    ? formatRupiah(s.cashVariance)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {s.edcReported !== null ? formatRupiah(s.edcReported) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatRupiah(s.cardBcaActual)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-medium",
                    s.edcVariance === null
                      ? "text-neutral-400"
                      : s.edcVariance === 0
                        ? "text-mahakan-green-700"
                        : "text-amber-700",
                  )}
                >
                  {s.edcVariance !== null ? formatRupiah(s.edcVariance) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatRupiah(s.qrisActual)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KvRow({
  label,
  value,
  bold,
  variance,
}: {
  label: string;
  value: string;
  bold?: boolean;
  variance?: number | null;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between text-xs",
        bold && "font-semibold text-neutral-900",
        !bold && "text-neutral-600",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          variance !== undefined && variance !== null
            ? Math.abs(variance) > 10_000
              ? "text-red-700"
              : "text-amber-700"
            : "",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ChannelRow({
  label,
  reported,
  actual,
  note,
}: {
  label: string;
  reported: number | null;
  actual: number | null;
  note?: string;
}) {
  const variance =
    reported !== null && actual !== null ? reported - actual : null;
  return (
    <tr className="border-t border-neutral-100">
      <td className="py-1.5">
        <div className="font-medium">{label}</div>
        {note ? (
          <div className="text-[10px] text-neutral-400">{note}</div>
        ) : null}
      </td>
      <td className="py-1.5 text-right">
        {reported !== null ? formatRupiah(reported) : "—"}
      </td>
      <td className="py-1.5 text-right">
        {actual !== null ? formatRupiah(actual) : "—"}
      </td>
      <td
        className={cn(
          "py-1.5 text-right font-medium",
          variance === null
            ? "text-neutral-400"
            : variance === 0
              ? "text-mahakan-green-700"
              : "text-amber-700",
        )}
      >
        {variance !== null ? formatRupiah(variance) : "—"}
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-50 px-2 py-1.5 text-center">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
