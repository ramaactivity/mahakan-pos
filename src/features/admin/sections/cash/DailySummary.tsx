"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from "@/components/ui";
import { expenseService, isOk } from "@/mocks/services";
import type { DailyCashSummary as DailyCashSummaryData } from "@/mocks/services/expenseService";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DailySummary() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<DailyCashSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await expenseService.getDailyCashSummary(date);
      if (cancelled) return;
      if (isOk(res)) setSummary(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Ringkasan Kas Harian
          </h2>
          <p className="text-xs text-neutral-500">
            Net cash flow per hari = (POS revenue + manual income) − expenses − refunds.
          </p>
        </div>
        <div className="w-44">
          <Input
            label="Tanggal"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </header>

      {loading ? (
        <div className="space-y-4" role="status" aria-label="Memuat ringkasan kas">
          <Skeleton className="h-28 w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      ) : !summary ? (
        <p className="text-sm text-danger-500">Gagal load data</p>
      ) : (
        <div className="space-y-4">
          {/* Top: net cash flow */}
          <Card variant="emphasis">
            <CardHeader>
              <CardTitle className="text-base text-mahakan-green-900">
                Net Cash Flow
              </CardTitle>
              <CardDescription>{summary.date}</CardDescription>
            </CardHeader>
            <CardContent>
              <p
                className={cn(
                  "font-mono text-3xl font-bold",
                  summary.netCashFlow >= 0
                    ? "text-mahakan-green-900"
                    : "text-danger-500",
                )}
              >
                {summary.netCashFlow >= 0 ? "+" : ""}
                {formatRupiah(summary.netCashFlow)}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Income breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Pemasukan</CardTitle>
                <CardDescription>
                  Total {formatRupiah(summary.income.total)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Row label="POS Tunai" value={formatRupiah(summary.income.pos.cash)} />
                  <Row label="POS QRIS" value={formatRupiah(summary.income.pos.qris)} />
                  <Row
                    label="POS Kartu BCA"
                    value={formatRupiah(summary.income.pos.cardBca)}
                  />
                  <div className="border-t border-dashed border-neutral-200 pt-2">
                    <Row
                      label="POS Subtotal"
                      value={formatRupiah(summary.income.pos.total)}
                      muted
                    />
                  </div>
                  <Row
                    label={`Manual Income (${summary.income.manual.count} entry)`}
                    value={formatRupiah(summary.income.manual.total)}
                  />
                  <div className="border-t-2 border-neutral-200 pt-2">
                    <Row
                      label="Total Pemasukan"
                      value={formatRupiah(summary.income.total)}
                      bold
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Expenses + refunds */}
            <Card>
              <CardHeader>
                <CardTitle>Pengeluaran</CardTitle>
                <CardDescription>
                  Total {formatRupiah(summary.expenses.total + summary.refunds.total)}{" "}
                  (termasuk refund)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {summary.expenses.byCategory.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      Tidak ada pengeluaran di tanggal ini.
                    </p>
                  ) : (
                    summary.expenses.byCategory.map((row) => (
                      <Row
                        key={row.categoryId}
                        label={`${row.name} (${row.count})`}
                        value={formatRupiah(row.total)}
                      />
                    ))
                  )}
                  <div className="border-t border-dashed border-neutral-200 pt-2">
                    <Row
                      label="Subtotal Pengeluaran"
                      value={formatRupiah(summary.expenses.total)}
                      muted
                    />
                  </div>
                  {summary.refunds.count > 0 ? (
                    <Row
                      label={`Refund Tunai (${summary.refunds.count})`}
                      value={formatRupiah(summary.refunds.total)}
                      danger
                    />
                  ) : null}
                  <div className="border-t-2 border-neutral-200 pt-2">
                    <Row
                      label="Total Keluar"
                      value={formatRupiah(
                        summary.expenses.total + summary.refunds.total,
                      )}
                      bold
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
  danger,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-sm",
        muted ? "text-neutral-500" : "text-neutral-900",
        danger ? "text-danger-500" : "",
        bold ? "text-base font-bold" : "",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="font-mono shrink-0">{value}</span>
    </div>
  );
}
