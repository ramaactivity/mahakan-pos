"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
  SettlementReconciliationReport,
} from "@/features/finance/types";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { formatIndonesianDate, formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { AggregatorSettlementModal } from "./AggregatorSettlementModal";

const CHANNEL_LABEL: Record<AggregatorChannel, string> = {
  edc_bca: "EDC BCA",
  qris: "QRIS",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
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

  const canCreate = hasPermission(viewerRole, "aggregator_settlement.create");

  async function load() {
    if (!range.from || !range.to) return;
    setLoading(true);
    setError(null);
    try {
      const [reconRes, histRes] = await Promise.all([
        fetchSettlementReconciliation(range.from, range.to),
        fetchAggregatorSettlements({
          fromDate: range.from,
          toDate: range.to,
        }),
      ]);
      if (reconRes.ok) setReport(reconRes.data);
      else setError(reconRes.error.message);
      if (histRes.ok) setHistory(histRes.data as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    load();
  }, [range.from, range.to]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          label="Rentang"
          value={range}
          onChange={setRange}
        />
        <div className="ml-auto" />
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Catat Settlement
          </Button>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : !report ? null : (
        <>
          <section className="rounded-md border border-neutral-200 bg-white">
            <header className="border-b border-neutral-200 px-4 py-2 text-sm font-semibold">
              Rekonsiliasi per Channel
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Channel</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Reported (Shifts)
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      POS Actual
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Aggregator Gross
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Fee</th>
                    <th className="px-3 py-2 text-right font-medium">Net</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Selisih (Shift vs Agg)
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Selisih (POS vs Agg)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr
                      key={r.channel}
                      className="border-t border-neutral-100"
                    >
                      <td className="px-3 py-2 font-medium">
                        {CHANNEL_LABEL[r.channel]}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatRupiah(r.reportedFromShifts)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatRupiah(r.posActual)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatRupiah(r.aggregatorGross)}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-500">
                        {formatRupiah(r.aggregatorFee)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatRupiah(r.aggregatorNet)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-medium",
                          r.varianceShiftsVsAggregator === 0
                            ? "text-mahakan-green-700"
                            : "text-amber-700",
                        )}
                      >
                        {formatRupiah(r.varianceShiftsVsAggregator)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-medium",
                          r.variancePosVsAggregator === null
                            ? "text-neutral-400"
                            : r.variancePosVsAggregator === 0
                              ? "text-mahakan-green-700"
                              : "text-amber-700",
                        )}
                      >
                        {r.variancePosVsAggregator !== null
                          ? formatRupiah(r.variancePosVsAggregator)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

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
                      <th className="px-3 py-2 text-left font-medium">
                        Channel
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Periode
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Gross
                      </th>
                      <th className="px-3 py-2 text-right font-medium">Fee</th>
                      <th className="px-3 py-2 text-right font-medium">Net</th>
                      <th className="px-3 py-2 text-left font-medium">Ref</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Dicatat
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr
                        key={h.id}
                        className="border-t border-neutral-100 hover:bg-neutral-50"
                      >
                        <td className="px-3 py-2 font-medium">
                          {CHANNEL_LABEL[h.channel]}
                        </td>
                        <td className="px-3 py-2 text-neutral-600">
                          {formatIndonesianDate(h.periodFrom)} →{" "}
                          {formatIndonesianDate(h.periodTo)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {formatRupiah(h.grossAmount)}
                        </td>
                        <td className="px-3 py-2 text-right text-neutral-500">
                          {formatRupiah(h.feeAmount)}
                        </td>
                        <td className="px-3 py-2 text-right">
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
    </div>
  );
}
