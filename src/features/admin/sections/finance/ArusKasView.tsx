"use client";

import { useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import {
  Badge,
  DateRangePicker,
  Skeleton,
  type DateRangeValue,
} from "@/components/ui";
import { fetchCashFlowLedger } from "@/features/finance/actions";
import type {
  CashFlowEntryKind,
  CashFlowLedgerReport,
} from "@/features/finance/types";
import { formatRupiah } from "@/lib/money";
import { formatIndonesianDate } from "@/lib/date";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<CashFlowEntryKind, string> = {
  expense_manual: "Pengeluaran Manual",
  expense_purchase: "Pembelian",
  expense_payroll: "Gaji Karyawan",
  expense_refund: "Refund",
  income_manual: "Pemasukan Manual",
  deposit_verified: "Setoran Tunai (verified)",
};

const KIND_VARIANT: Record<
  CashFlowEntryKind,
  "warning" | "info" | "neutral" | "success"
> = {
  expense_manual: "warning",
  expense_purchase: "info",
  expense_payroll: "warning",
  expense_refund: "warning",
  income_manual: "success",
  deposit_verified: "neutral",
};

function thirtyDaysAgo(): DateRangeValue {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const today = new Date(now.getTime() + wibOffset);
  const past = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  return {
    from: past.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

export function ArusKasView() {
  const [range, setRange] = useState<DateRangeValue>(thirtyDaysAgo());
  const [filterKind, setFilterKind] = useState<CashFlowEntryKind | "all">(
    "all",
  );
  const [report, setReport] = useState<CashFlowLedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!range.from || !range.to) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchCashFlowLedger(range.from, range.to)
      .then((res) => {
        if (res.ok) setReport(res.data);
        else setError(res.error.message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const filteredEntries =
    filterKind === "all"
      ? report?.entries ?? []
      : (report?.entries ?? []).filter((e) => e.kind === filterKind);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          label="Rentang"
          value={range}
          onChange={setRange}
        />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : !report ? null : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard
              icon={<ArrowDownCircle className="size-5 text-mahakan-green-700" />}
              label="Pemasukan"
              value={formatRupiah(report.totals.inflowTotal)}
              accent="success"
            />
            <SummaryCard
              icon={<ArrowUpCircle className="size-5 text-amber-600" />}
              label="Pengeluaran"
              value={formatRupiah(report.totals.outflowTotal)}
              accent="warning"
            />
            <SummaryCard
              icon={<ArrowDownCircle className="size-5 text-neutral-700" />}
              label="Net Flow"
              value={formatRupiah(report.totals.netFlow)}
              accent={report.totals.netFlow >= 0 ? "success" : "danger"}
            />
          </div>

          <div className="flex flex-wrap gap-1">
            <FilterChip
              label="Semua"
              active={filterKind === "all"}
              onClick={() => setFilterKind("all")}
            />
            {(Object.keys(KIND_LABEL) as CashFlowEntryKind[]).map((k) => (
              <FilterChip
                key={k}
                label={KIND_LABEL[k]}
                active={filterKind === k}
                onClick={() => setFilterKind(k)}
              />
            ))}
          </div>

          <section className="rounded-md border border-neutral-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Tanggal</th>
                    <th className="px-3 py-2 text-left font-medium">Jenis</th>
                    <th className="px-3 py-2 text-left font-medium">Deskripsi</th>
                    <th className="px-3 py-2 text-left font-medium">Bayar</th>
                    <th className="px-3 py-2 text-right font-medium">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-neutral-500"
                      >
                        Tidak ada entry di range ini.
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((e) => (
                      <tr
                        key={`${e.kind}:${e.id}`}
                        className="border-t border-neutral-100 hover:bg-neutral-50"
                      >
                        <td className="px-3 py-2 text-neutral-600">
                          {formatIndonesianDate(e.date)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={KIND_VARIANT[e.kind]}>
                            {KIND_LABEL[e.kind]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">{e.description}</td>
                        <td className="px-3 py-2 text-neutral-600">
                          {e.paymentMethod ?? "—"}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-semibold",
                            e.amount >= 0
                              ? "text-mahakan-green-700"
                              : "text-amber-700",
                          )}
                        >
                          {formatRupiah(e.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-white p-3",
        accent === "success" && "border-mahakan-green-200",
        accent === "warning" && "border-amber-200",
        accent === "danger" && "border-red-200",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-neutral-600">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-mahakan-green-700 px-3 py-1 text-xs font-semibold text-white"
          : "rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
      }
    >
      {label}
    </button>
  );
}
