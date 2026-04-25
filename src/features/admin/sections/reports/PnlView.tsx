"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
} from "@/components/ui";
import { isOk, reportService } from "@/mocks/services";
import type { PnlReport } from "@/mocks/services/reportService";
import { formatRupiah } from "@/lib/format";
import type { Role } from "@/mocks/types";
import { cn } from "@/lib/utils";

interface PnlViewProps {
  viewerRole: Role;
}

export function PnlView({ viewerRole }: PnlViewProps) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<PnlReport | null>(null);
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
      const res = await reportService.getPnlReport(from, to);
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to, viewerRole]);

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
      <header>
        <h2 className="text-lg font-semibold text-neutral-900">
          Simple P&amp;L
          <Badge variant="signature" className="ml-2">
            Owner Only
          </Badge>
        </h2>
        <p className="text-xs text-neutral-500">
          Revenue vs expenses sederhana — bukan akuntansi resmi.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              label="Dari Tanggal"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="Sampai Tanggal"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner className="size-6 text-mahakan-green-700" />
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
                  <div className="border-t border-dashed border-neutral-200 pt-1.5">
                    <Row
                      label="Total Pendapatan"
                      value={formatRupiah(report.income.total)}
                      bold
                    />
                  </div>
                </div>
              </div>

              {/* Expenses */}
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  Pengeluaran
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
                  <div className="border-t border-dashed border-neutral-200 pt-1.5">
                    <Row
                      label="Total Pengeluaran"
                      value={formatRupiah(report.expenses.total)}
                      bold
                    />
                  </div>
                </div>
              </div>

              {/* Profit */}
              <div className="rounded-md bg-mahakan-green-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wider text-mahakan-green-900">
                      Laba Kotor
                    </p>
                    <p className="text-xs text-mahakan-green-900/70">
                      {report.period.from} — {report.period.to}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "font-mono text-3xl font-bold",
                      report.grossProfit >= 0
                        ? "text-mahakan-green-900"
                        : "text-danger-500",
                    )}
                  >
                    {report.grossProfit >= 0 ? "+" : ""}
                    {formatRupiah(report.grossProfit)}
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
  label: string;
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
