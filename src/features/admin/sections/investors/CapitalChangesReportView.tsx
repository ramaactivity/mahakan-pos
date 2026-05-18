"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyCard,
  Skeleton,
} from "@/components/ui";
import {
  fetchCapitalChangesReport,
  isOk,
  type CapitalChangeRow,
} from "@/features/profit-distributions";
import { formatRupiah } from "@/lib/format";

/**
 * Sesi AE-63e — Laporan Perubahan Modal (Statement of Changes in Equity).
 *
 * Per period (default tahun berjalan):
 *  Saldo Awal + Setoran + Dividen Credit - Withdrawal ± Adjustment = Saldo Akhir
 * Per holder breakdown + summary totals.
 */
export function CapitalChangesReportView() {
  const today = new Date();
  const defaultYear = today.getUTCFullYear();
  const [year, setYear] = useState(defaultYear);

  const periodStart = `${year}-01-01`;
  const periodEnd = `${year}-12-31`;

  const reportQuery = useQuery({
    queryKey: ["capital-changes-report", year],
    queryFn: async () => {
      const res = await fetchCapitalChangesReport({
        periodStart,
        periodEnd,
      });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const report = reportQuery.data;

  const exportCsv = useMemo(() => {
    if (!report) return "";
    const header =
      "Tipe,Nama,Modal Disetor,Saldo Awal,Setoran,Dividen,Withdrawal,Adjustment,Saldo Akhir";
    const rows = [
      ...report.pengelola.map(rowToCsv("Pengelola")),
      ...report.investors.map(rowToCsv("Investor")),
    ].join("\n");
    return `${header}\n${rows}`;
  }, [report]);

  function downloadCsv() {
    if (!exportCsv) return;
    const blob = new Blob([exportCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-perubahan-modal-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Laporan Perubahan Modal</CardTitle>
            <p className="mt-1 text-xs text-neutral-600">
              Saldo Awal + Setoran + Dividen − Withdrawal = Saldo Akhir per
              holder. Periode {periodStart} sampai {periodEnd}.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
            >
              {[defaultYear - 2, defaultYear - 1, defaultYear].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={downloadCsv}
              disabled={!report}
            >
              <Download className="mr-1.5 size-4" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !report ? (
            <EmptyCard
              title="Belum ada data"
              description="Belum ada movement modal di period ini."
            />
          ) : (
            <>
              {/* Summary cards */}
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard
                  label="Saldo Awal Investor"
                  value={report.totals.saldoAwalInvestor}
                />
                <SummaryCard
                  label="Saldo Awal Pengelola"
                  value={report.totals.saldoAwalPengelola}
                />
                <SummaryCard
                  label="Setoran Periode"
                  value={report.totals.setoranTotal}
                  tone="success"
                />
                <SummaryCard
                  label="Dividen Periode"
                  value={report.totals.dividenTotal}
                  tone="info"
                />
                <SummaryCard
                  label="Withdrawal Periode"
                  value={report.totals.withdrawalTotal}
                  tone="danger"
                />
                <SummaryCard
                  label="Saldo Akhir Investor"
                  value={report.totals.saldoAkhirInvestor}
                  tone="primary"
                />
                <SummaryCard
                  label="Saldo Akhir Pengelola"
                  value={report.totals.saldoAkhirPengelola}
                  tone="primary"
                />
                <SummaryCard
                  label="TOTAL Saldo Akhir"
                  value={
                    report.totals.saldoAkhirInvestor +
                    report.totals.saldoAkhirPengelola
                  }
                  tone="primary"
                />
              </div>

              {/* Pengelola table */}
              {report.pengelola.length > 0 ? (
                <section className="mb-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
                    Pengelola ({report.pengelola.length})
                  </h4>
                  <RowsTable rows={report.pengelola} />
                </section>
              ) : null}

              {/* Investor table */}
              {report.investors.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
                    Investor ({report.investors.length})
                  </h4>
                  <RowsTable rows={report.investors} />
                </section>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function rowToCsv(holderTypeLabel: string) {
  return (r: CapitalChangeRow) =>
    [
      holderTypeLabel,
      `"${r.holderName.replace(/"/g, "''")}"`,
      r.modalDisetor,
      r.saldoAwal,
      r.setoran,
      r.dividen,
      r.withdrawal,
      r.adjustment,
      r.saldoAkhir,
    ].join(",");
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "primary" | "info" | "success" | "danger";
}) {
  const cls =
    tone === "primary"
      ? "border-mahakan-green-700/30 bg-mahakan-green-50 text-mahakan-green-900"
      : tone === "info"
        ? "border-blue-200 bg-blue-50 text-blue-900"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : tone === "danger"
            ? "border-red-200 bg-red-50 text-red-900"
            : "border-neutral-200 bg-white text-neutral-900";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-sm font-bold tabular-nums">{formatRupiah(value)}</p>
    </div>
  );
}

function RowsTable({ rows }: { rows: CapitalChangeRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-left text-neutral-600">
          <tr>
            <th className="px-2 py-1.5">Nama</th>
            <th className="px-2 py-1.5 text-right">Modal Disetor</th>
            <th className="px-2 py-1.5 text-right">Saldo Awal</th>
            <th className="px-2 py-1.5 text-right">Setoran</th>
            <th className="px-2 py-1.5 text-right">Dividen</th>
            <th className="px-2 py-1.5 text-right">Withdrawal</th>
            <th className="px-2 py-1.5 text-right">Saldo Akhir</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={`${r.holderType}:${r.holderId}`}>
              <td className="px-2 py-1 font-medium">{r.holderName}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-700">
                {formatRupiah(r.modalDisetor)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {formatRupiah(r.saldoAwal)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-emerald-700">
                {r.setoran > 0 ? `+${formatRupiah(r.setoran)}` : "—"}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-blue-700">
                {r.dividen > 0 ? `+${formatRupiah(r.dividen)}` : "—"}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-red-700">
                {r.withdrawal > 0 ? `-${formatRupiah(r.withdrawal)}` : "—"}
              </td>
              <td className="px-2 py-1 text-right tabular-nums font-bold">
                {formatRupiah(r.saldoAkhir)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
