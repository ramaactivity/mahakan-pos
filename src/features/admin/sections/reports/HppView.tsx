"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import Papa from "papaparse";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DateRangePicker,
  Skeleton,
  toast,
  type DateRangeValue,
} from "@/components/ui";
import {
  getHppReport,
  isOk,
  type HppReport,
  type HppReportRow,
} from "@/features/reports";
import { getOwnOutlet, type Outlet } from "@/features/outlets";
import { exportHppPdf } from "@/lib/pdf-export";
import { formatRupiah } from "@/lib/format";
import { downloadCsv } from "./menu-engineering-csv";
import { cn } from "@/lib/utils";

const SECTION_LABELS: Record<string, string> = {
  kitchen: "Kitchen",
  bar: "Bar",
  supporting: "Supporting Supplies",
  cleaning: "Cleaning Supplies",
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

export function HppView() {
  const [report, setReport] = useState<HppReport | null>(null);
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
      const res = await getHppReport(range.from!, range.to!);
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      else toast.error(res.error.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshKey]);

  const groupedBySection = useMemo(() => {
    if (!report) return [] as Array<{
      section: string | null;
      label: string;
      rows: HppReportRow[];
    }>;
    const order = ["kitchen", "bar", "supporting", "cleaning"];
    const buckets = new Map<string, HppReportRow[]>();
    const unassigned: HppReportRow[] = [];
    for (const r of report.rows) {
      if (!r.section) {
        unassigned.push(r);
      } else {
        const arr = buckets.get(r.section) ?? [];
        arr.push(r);
        buckets.set(r.section, arr);
      }
    }
    const result: Array<{
      section: string | null;
      label: string;
      rows: HppReportRow[];
    }> = [];
    for (const k of order) {
      const arr = buckets.get(k);
      if (arr && arr.length > 0) {
        result.push({ section: k, label: SECTION_LABELS[k] ?? k, rows: arr });
      }
    }
    if (unassigned.length > 0) {
      result.push({
        section: null,
        label: "Belum diset",
        rows: unassigned,
      });
    }
    return result;
  }, [report]);

  function onExportPdf() {
    if (!report || !outlet) return;
    exportHppPdf(report, outlet);
  }

  function onExportCsv() {
    if (!report) return;
    const data = report.rows.map((r) => ({
      Bahan: r.name,
      Section: r.section ? SECTION_LABELS[r.section] ?? r.section : "Belum diset",
      Unit: r.unit,
      "Stok Awal Qty": r.stockAwalQty,
      "Stok Awal Cost": r.stockAwalCost,
      "Pembelian Qty": r.pembelianQty,
      "Pembelian Cost": r.pembelianCost,
      "Stok Akhir Qty": r.stockAkhirQty,
      "Stok Akhir Cost": r.stockAkhirCost,
      "HPP Qty": r.hppQty,
      "HPP Cost": r.hppCost,
      Partial: r.partial ? "ya" : "tidak",
    }));
    const csv = Papa.unparse(data, { newline: "\n" });
    downloadCsv(
      `hpp-${report.period.from}-to-${report.period.to}.csv`,
      "﻿" + csv,
    );
    toast.success("Export HPP CSV");
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Laporan HPP (COGS Periodik)
          </h2>
          <p className="text-xs text-neutral-500">
            HPP = Stok Awal + Pembelian − Stok Akhir. Stok Awal/Akhir
            otomatis ambil dari sesi opname terdekat. Cost real-time
            (frozen di opname snapshot kalau ada).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExportPdf}
            disabled={!report || !outlet || report.rows.length === 0}
            aria-label="Export PDF"
          >
            <Download className="size-4" aria-hidden /> PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            disabled={!report || report.rows.length === 0}
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
        <CardContent className="space-y-3 pt-0">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : !report ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Pilih periode untuk lihat laporan.
            </p>
          ) : (
            <>
              {/* AE-202 — mode periodic + belum opname di periode: stok akhir
                  (dan HPP) belum bisa dihitung. Ditampilkan "—", bukan Rp 0. */}
              {report.stockAkhirUnknown ? (
                <div className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-100/30 p-3 text-xs text-warning-500">
                  <AlertTriangle className="mt-0.5 size-4" aria-hidden />
                  <div>
                    <p className="font-medium">Belum ada opname di periode ini</p>
                    <p className="text-neutral-700">
                      Mode persediaan periodic — stok hanya bergerak dari
                      opname, jadi stok akhir &amp; HPP belum bisa dihitung
                      dan ditampilkan &quot;&mdash;&quot;. Lakukan Stock Opname
                      di akhir periode untuk melihat pemakaian.
                    </p>
                  </div>
                </div>
              ) : null}

              {report.hasPartialRows ? (
                <div className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-100/30 p-3 text-xs text-warning-500">
                  <AlertTriangle className="mt-0.5 size-4" aria-hidden />
                  <div>
                    <p className="font-medium">Data partial</p>
                    <p className="text-neutral-700">
                      Stok Awal/Akhir untuk beberapa bahan di-derive
                      dari current_stock (bukan dari opname). Untuk
                      akurasi, jalankan opname di awal + akhir periode.
                      {report.opnameRefs.stockAwalSessionDate
                        ? ` · Opname Awal: ${report.opnameRefs.stockAwalSessionDate}`
                        : " · Opname Awal: belum ada"}
                      {report.opnameRefs.stockAkhirSessionDate
                        ? ` · Opname Akhir: ${report.opnameRefs.stockAkhirSessionDate}`
                        : " · Opname Akhir: belum ada"}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2 md:grid-cols-4">
                <SummaryCard
                  label="Stok Awal"
                  value={formatRupiah(report.totals.stockAwalCost)}
                />
                <SummaryCard
                  label="Pembelian"
                  value={formatRupiah(report.totals.pembelianCost)}
                />
                <SummaryCard
                  label="Stok Akhir"
                  value={hppMoney(report, report.totals.stockAkhirCost)}
                />
                <SummaryCard
                  label="HPP Total"
                  value={hppMoney(report, report.totals.hppCost)}
                  highlight
                />
              </div>

              {report.bySection.length > 0 ? (
                <div className="rounded-md border border-neutral-200">
                  <table className="w-full text-sm">
                    <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          Section
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Stok Awal
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Pembelian
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Stok Akhir
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          HPP
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {report.bySection.map((s) => (
                        <tr key={s.section ?? "__none"}>
                          <td className="px-3 py-2 font-medium">
                            {s.sectionLabel}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatRupiah(s.stockAwalCost)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatRupiah(s.pembelianCost)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {hppMoney(report, s.stockAkhirCost)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-mahakan-green-900">
                            {hppMoney(report, s.hppCost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="space-y-3">
                {groupedBySection.map((g) => (
                  <details
                    key={g.section ?? "__none"}
                    className="rounded-md border border-neutral-200"
                    open
                  >
                    <summary className="flex cursor-pointer items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-900">
                      <span>{g.label}</span>
                      <span className="text-xs text-neutral-500">
                        {g.rows.length} bahan
                      </span>
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b border-neutral-200 bg-white text-xs uppercase text-neutral-500">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">
                              Bahan
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              Awal
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              Beli
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              Akhir
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              HPP Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {g.rows.map((r) => (
                            <tr key={r.ingredientId} className="hover:bg-neutral-50">
                              <td className="px-3 py-2">
                                <span className="text-neutral-900">
                                  {r.name}
                                </span>
                                <span className="ml-1 text-xs text-neutral-500">
                                  ({r.unit})
                                </span>
                                {r.partial ? (
                                  <Badge
                                    variant="warning"
                                    className="ml-2 text-[10px]"
                                  >
                                    partial
                                  </Badge>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                {formatRupiah(r.stockAwalCost)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                {formatRupiah(r.pembelianCost)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                {r.stockAkhirUnknown
                                  ? "—"
                                  : formatRupiah(r.stockAkhirCost)}
                              </td>
                              <td
                                className={cn(
                                  "px-3 py-2 text-right font-mono",
                                  r.hppCost > 0
                                    ? "text-mahakan-green-900"
                                    : "text-neutral-500",
                                )}
                              >
                                {r.stockAkhirUnknown
                                  ? "—"
                                  : formatRupiah(r.hppCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md p-3",
        highlight ? "bg-mahakan-green-100/40" : "bg-neutral-50",
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-base font-bold",
          highlight ? "text-mahakan-green-900" : "text-neutral-900",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* AE-202 — nilai stok akhir & HPP hanya bermakna kalau periodenya sudah
 * dihitung fisik. Selama belum, tampilkan "—" (bukan Rp 0, yang terbaca
 * "stok habis / tidak ada HPP"). */
function hppMoney(report: HppReport, value: number): string {
  return report.stockAkhirUnknown ? "—" : formatRupiah(value);
}
