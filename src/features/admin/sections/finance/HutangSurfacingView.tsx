"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { fetchHutangOutstanding } from "@/features/finance/actions";
import { formatRupiah } from "@/lib/money";
import { formatIndonesianDate } from "@/lib/date";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  purchaseDate: string;
  dueDate: string | null;
  totalAmount: number;
  supplierName: string | null;
  invoiceNo: string | null;
  paymentMethod: string;
  status: string;
};

function daysUntil(dueIso: string | null): number | null {
  if (!dueIso) return null;
  const due = new Date(`${dueIso}T00:00:00+07:00`);
  const wibOffset = 7 * 60 * 60 * 1000;
  const todayWib = new Date(Date.now() + wibOffset);
  const todayIso = todayWib.toISOString().slice(0, 10);
  const today = new Date(`${todayIso}T00:00:00+07:00`);
  const ms = due.getTime() - today.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function HutangSurfacingView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHutangOutstanding()
      .then((res) => {
        if (res.ok) setRows(res.data);
        else setError(res.error.message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
        Tidak ada hutang dagang outstanding. Semua TOP sudah di-settle.
      </div>
    );
  }

  const total = rows.reduce((s, r) => s + r.totalAmount, 0);
  const overdue = rows.filter((r) => {
    const d = daysUntil(r.dueDate);
    return d !== null && d < 0;
  });
  const dueSoon = rows.filter((r) => {
    const d = daysUntil(r.dueDate);
    return d !== null && d >= 0 && d <= 7;
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          label="Total Outstanding"
          value={formatRupiah(total)}
          accent="info"
        />
        <KpiCard
          label="Jatuh Tempo ≤ 7 Hari"
          value={`${dueSoon.length}× · ${formatRupiah(dueSoon.reduce((s, r) => s + r.totalAmount, 0))}`}
          accent="warning"
        />
        <KpiCard
          label="Overdue"
          value={`${overdue.length}× · ${formatRupiah(overdue.reduce((s, r) => s + r.totalAmount, 0))}`}
          accent="danger"
        />
      </div>

      <section className="rounded-md border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-4 py-2 text-sm font-semibold">
          Hutang Dagang Outstanding ({rows.length})
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tanggal</th>
                <th className="px-3 py-2 text-left font-medium">Supplier</th>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-right font-medium">Nominal</th>
                <th className="px-3 py-2 text-left font-medium">Jatuh Tempo</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = daysUntil(r.dueDate);
                const dueLabel =
                  d === null
                    ? "—"
                    : d < 0
                      ? `Overdue ${-d} hari`
                      : d === 0
                        ? "Hari ini"
                        : `${d} hari lagi`;
                const dueClass =
                  d === null
                    ? "text-neutral-400"
                    : d < 0
                      ? "text-red-700 font-semibold"
                      : d <= 7
                        ? "text-amber-700 font-medium"
                        : "text-neutral-600";
                return (
                  <tr
                    key={r.id}
                    className="border-t border-neutral-100 hover:bg-neutral-50"
                  >
                    <td className="px-3 py-2">
                      {formatIndonesianDate(r.purchaseDate)}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {r.supplierName ?? "Walk-in"}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      {r.invoiceNo ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatRupiah(r.totalAmount)}
                    </td>
                    <td className={cn("px-3 py-2", dueClass)}>
                      {r.dueDate
                        ? `${formatIndonesianDate(r.dueDate)} · ${dueLabel}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 capitalize">
                      {r.paymentMethod}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "info" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-white p-3",
        accent === "info" && "border-mahakan-green-200",
        accent === "warning" && "border-amber-200",
        accent === "danger" && "border-red-200",
      )}
    >
      <div className="text-xs text-neutral-600">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
