"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Download, Lock } from "lucide-react";
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
} from "@/components/ui";
import { getPnlReport, isOk, type PnlReport } from "@/features/reports";
import {
  getOwnOutlet,
  isOk as isOutletOk,
  type Outlet,
} from "@/features/outlets";
import { exportPnlPdf } from "@/lib/pdf-export";
import { formatRupiah } from "@/lib/format";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

interface PnlViewProps {
  viewerRole: Role;
}

export function PnlView({ viewerRole }: PnlViewProps) {
  const today = todayJakarta();
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<PnlReport | null>(null);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (viewerRole !== "owner") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [reportRes, outletRes] = await Promise.all([
        getPnlReport(from, to),
        getOwnOutlet(),
      ]);
      if (cancelled) return;
      if (isOk(reportRes)) setReport(reportRes.data);
      if (isOutletOk(outletRes)) setOutlet(outletRes.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to, viewerRole]);

  function onExport() {
    if (!report || !outlet) return;
    exportPnlPdf(report, outlet);
  }

  if (viewerRole !== "owner") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-5 text-neutral-500" aria-hidden />
            P&amp;L — Owner Only
          </CardTitle>
          <CardDescription>
            Laporan P&amp;L hanya bisa diakses Owner per RBAC §3.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Simple P&amp;L
            <Badge variant="signature" className="ml-2">
              Owner Only
            </Badge>
          </h2>
          <p className="text-xs text-neutral-500">
            Revenue vs expenses sederhana — bukan akuntansi resmi.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onExport}
          disabled={!report || !outlet || loading}
          aria-label="Export PDF"
        >
          <Download className="size-4" /> Export PDF
        </Button>
      </header>

      <Card>
        <CardHeader>
          <DateRangePicker
            label="Periode"
            value={{ from, to }}
            onChange={(v) => {
              setFrom(v.from ?? monthStart);
              setTo(v.to ?? today);
            }}
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3" role="status" aria-label="Memuat P&L">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !report ? (
            <p className="text-sm text-danger-500">Gagal load laporan</p>
          ) : (
            <div className="space-y-6">
              {/* Income */}
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  Pendapatan
                </h3>
                <div className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-3">
                  <Row
                    label="POS Revenue"
                    value={formatRupiah(report.income.posRevenue)}
                  />
                  <Row
                    label="Manual Income (non-POS)"
                    value={formatRupiah(report.income.manualIncome)}
                  />
                  {report.income.historicalIncome > 0 ? (
                    <Row
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          Histori (Majoo / POS lama)
                          <span className="rounded-full bg-warning-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning-700">
                            Histori
                          </span>
                        </span>
                      }
                      value={formatRupiah(report.income.historicalIncome)}
                    />
                  ) : null}
                  <div className="border-t border-dashed border-neutral-200 pt-1.5">
                    <Row
                      label="Total Pendapatan"
                      value={formatRupiah(report.income.total)}
                      bold
                    />
                  </div>
                </div>
              </div>

              {/* COGS / HPP */}
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  HPP (Cost of Goods Sold)
                </h3>
                <div className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-3">
                  <Row
                    label={
                      report.cogs > 0
                        ? "HPP Live (snapshot saat transaksi)"
                        : "Belum ada COGS data — set up resep dulu"
                    }
                    value={formatRupiah(report.cogs)}
                  />
                  {report.historicalCogs > 0 ? (
                    <Row
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          HPP Histori (Majoo / POS lama)
                          <span className="rounded-full bg-warning-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning-700">
                            Histori
                          </span>
                        </span>
                      }
                      value={formatRupiah(report.historicalCogs)}
                    />
                  ) : null}
                </div>
              </div>

              {/* Gross Margin */}
              <div className="rounded-md border border-mahakan-green-100 bg-mahakan-green-50/40 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold uppercase tracking-wider text-mahakan-green-900">
                    Laba Kotor (Gross Margin)
                  </p>
                  <p
                    className={cn(
                      "font-mono text-xl font-bold",
                      report.grossMargin >= 0
                        ? "text-mahakan-green-900"
                        : "text-danger-500",
                    )}
                  >
                    {report.grossMargin >= 0 ? "+" : ""}
                    {formatRupiah(report.grossMargin)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-mahakan-green-900/70">
                  Pendapatan − HPP. Mengukur margin sebelum biaya operasional.
                </p>
              </div>

              {/* Expenses */}
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  Pengeluaran Operasional
                </h3>
                <div className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-3">
                  {report.expenses.byCategory.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      Tidak ada pengeluaran di range ini.
                    </p>
                  ) : (
                    report.expenses.byCategory.map((row) => (
                      <Row
                        key={row.name}
                        label={row.name}
                        value={formatRupiah(row.amount)}
                      />
                    ))
                  )}
                  {report.expenses.historicalTotal > 0 ? (
                    <Row
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          Histori (Majoo / POS lama)
                          <span className="rounded-full bg-warning-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning-700">
                            Histori
                          </span>
                        </span>
                      }
                      value={formatRupiah(report.expenses.historicalTotal)}
                    />
                  ) : null}
                  <div className="border-t border-dashed border-neutral-200 pt-1.5">
                    <Row
                      label="Total Pengeluaran"
                      value={formatRupiah(report.expenses.total)}
                      bold
                    />
                  </div>
                </div>
              </div>

              {/* Net Profit */}
              <div className="rounded-md bg-mahakan-green-100 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wider text-mahakan-green-900">
                      Laba Bersih
                    </p>
                    <p className="text-xs text-mahakan-green-900/70">
                      {report.period.from} — {report.period.to}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "font-mono text-3xl font-bold",
                      report.netProfit >= 0
                        ? "text-mahakan-green-900"
                        : "text-danger-500",
                    )}
                  >
                    {report.netProfit >= 0 ? "+" : ""}
                    {formatRupiah(report.netProfit)}
                  </p>
                </div>
              </div>

              <p className="rounded-md bg-warning-100 p-3 text-xs text-warning-500">
                ⚠️ {report.disclaimer}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: ReactNode;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        bold ? "text-base font-bold" : "text-sm",
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
