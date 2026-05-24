"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, ShoppingBag } from "lucide-react";
import Papa from "papaparse";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DateRangePicker,
  EmptyCard,
  Skeleton,
  toast,
  type DateRangeValue,
} from "@/components/ui";
import {
  getPurchaseRollupReport,
  isOk,
  type PurchaseRollupReport,
} from "@/features/reports";
import { getOwnOutlet, type Outlet } from "@/features/outlets";
import { exportPurchaseRollupPdf } from "@/lib/pdf-export";
import { formatRupiah } from "@/lib/format";
import { downloadCsv } from "./menu-engineering-csv";

const SECTION_LABELS: Record<string, string> = {
  kitchen: "Kitchen",
  bar: "Bar",
  supporting: "Supporting",
  cleaning: "Cleaning",
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  transfer_bca: "BCA",
  transfer_bri: "BRI",
  transfer_other: "Transfer lain",
  top: "TOP",
};

function todayJakartaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthStartIso(): string {
  return todayJakartaIso().slice(0, 7) + "-01";
}

interface PivotKey {
  section: string;
  paymentMethod: string;
  label: string;
}

function cellKey(c: { section: string | null; paymentMethod: string }) {
  return `${c.section ?? "__none"}__${c.paymentMethod}`;
}

export function PurchaseRollupView() {
  const [report, setReport] = useState<PurchaseRollupReport | null>(null);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await getOwnOutlet();
      if (res.success) setOutlet(res.data);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  const [range, setRange] = useState<DateRangeValue>({
    from: monthStartIso(),
    to: todayJakartaIso(),
  });

  useEffect(() => {
    let cancelled = false;
    if (!range.from || !range.to) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await getPurchaseRollupReport(range.from!, range.to!);
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      else toast.error(res.error.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshKey]);

  const { columnKeys, byDate, dateTotals, columnTotals, grandTotal } =
    useMemo(() => {
      if (!report) {
        return {
          columnKeys: [] as PivotKey[],
          byDate: new Map<string, Map<string, number>>(),
          dateTotals: new Map<string, number>(),
          columnTotals: new Map<string, number>(),
          grandTotal: 0,
        };
      }
      // Build column keys from all encountered cells. Order: section
      // (kitchen/bar/supporting/cleaning/__none) × payment_method.
      const sectionOrder = [
        "kitchen",
        "bar",
        "supporting",
        "cleaning",
        "__none",
      ];
      const paymentOrder = [
        "cash",
        "transfer_bca",
        "transfer_bri",
        "transfer_other",
        "top",
      ];
      const seen = new Set<string>();
      for (const c of report.cells) {
        seen.add(cellKey(c));
      }
      const cols: PivotKey[] = [];
      for (const sec of sectionOrder) {
        for (const pay of paymentOrder) {
          const key = `${sec}__${pay}`;
          if (seen.has(key)) {
            const sectionLabel =
              sec === "__none"
                ? "Belum diset"
                : SECTION_LABELS[sec] ?? sec;
            cols.push({
              section: sec,
              paymentMethod: pay,
              label: `${sectionLabel} · ${PAYMENT_LABELS[pay] ?? pay}`,
            });
          }
        }
      }

      const dateMap = new Map<string, Map<string, number>>();
      const dateTotalMap = new Map<string, number>();
      const colTotalMap = new Map<string, number>();
      let grand = 0;

      for (const c of report.cells) {
        const k = cellKey(c);
        const dRow = dateMap.get(c.date) ?? new Map<string, number>();
        dRow.set(k, (dRow.get(k) ?? 0) + c.totalAmount);
        dateMap.set(c.date, dRow);
        dateTotalMap.set(
          c.date,
          (dateTotalMap.get(c.date) ?? 0) + c.totalAmount,
        );
        colTotalMap.set(k, (colTotalMap.get(k) ?? 0) + c.totalAmount);
        grand += c.totalAmount;
      }
      return {
        columnKeys: cols,
        byDate: dateMap,
        dateTotals: dateTotalMap,
        columnTotals: colTotalMap,
        grandTotal: grand,
      };
    }, [report]);

  function onExportPdf() {
    if (!report || !outlet) return;
    exportPurchaseRollupPdf(report, outlet);
  }

  function onExportCsv() {
    if (!report) return;
    const dates = Array.from(byDate.keys()).sort();
    const headers = ["Tanggal", ...columnKeys.map((c) => c.label), "Total"];
    const rows = dates.map((d) => {
      const row: Record<string, string | number> = { Tanggal: d };
      for (const c of columnKeys) {
        const k = cellKey(c);
        row[c.label] = byDate.get(d)?.get(k) ?? 0;
      }
      row["Total"] = dateTotals.get(d) ?? 0;
      return row;
    });
    const totalsRow: Record<string, string | number> = { Tanggal: "TOTAL" };
    for (const c of columnKeys) {
      totalsRow[c.label] = columnTotals.get(cellKey(c)) ?? 0;
    }
    totalsRow["Total"] = grandTotal;
    const csv = Papa.unparse({ fields: headers, data: [...rows, totalsRow] }, {
      newline: "\n",
    });
    downloadCsv(
      `pembelanjaan-${report.period.from}-to-${report.period.to}.csv`,
      "﻿" + csv,
    );
    toast.success("Export rollup CSV");
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Laporan Pembelanjaan (Pivot)
          </h2>
          <p className="text-xs text-neutral-500">
            Pivot per tanggal × section × metode bayar. Replace
            spreadsheet `Rekap Inv Detail`. Yang dibatalkan tidak ikut.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExportPdf}
            disabled={!report || !outlet || report.cells.length === 0}
            aria-label="Export PDF"
          >
            <Download className="size-4" aria-hidden /> PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            disabled={!report || report.cells.length === 0}
          >
            <Download className="size-4" aria-hidden /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <DateRangePicker
            label="Periode"
            value={range}
            onChange={(v) => setRange(v ?? { from: null, to: null })}
          />
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !report || report.cells.length === 0 ? (
            <EmptyCard
              icon={ShoppingBag}
              title="Belum ada pembelian dalam periode ini"
              description="Sesuaikan range tanggal — atau catat pembelian baru di tab Pembelian."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="sticky left-0 bg-neutral-50 px-3 py-2 text-left font-medium">
                      Tanggal
                    </th>
                    {columnKeys.map((c) => (
                      <th
                        key={c.section + c.paymentMethod}
                        className="px-3 py-2 text-right font-medium"
                      >
                        {c.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {Array.from(byDate.keys())
                    .sort()
                    .map((d) => {
                      const dRow = byDate.get(d)!;
                      return (
                        <tr key={d} className="hover:bg-neutral-50">
                          <td className="sticky left-0 bg-white px-3 py-2 font-mono text-xs">
                            {d}
                          </td>
                          {columnKeys.map((c) => {
                            const k = cellKey(c);
                            const val = dRow.get(k) ?? 0;
                            return (
                              <td
                                key={k}
                                className="px-3 py-2 text-right font-mono text-xs"
                              >
                                {val > 0 ? formatRupiah(val) : "—"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            {formatRupiah(dateTotals.get(d) ?? 0)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot className="border-t border-neutral-200 bg-neutral-50">
                  <tr>
                    <td className="sticky left-0 bg-neutral-50 px-3 py-2 text-right text-xs font-bold uppercase">
                      Total
                    </td>
                    {columnKeys.map((c) => {
                      const k = cellKey(c);
                      return (
                        <td
                          key={k}
                          className="px-3 py-2 text-right font-mono text-xs font-bold"
                        >
                          {formatRupiah(columnTotals.get(k) ?? 0)}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono text-base font-bold text-mahakan-green-900">
                      {formatRupiah(grandTotal)}
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
