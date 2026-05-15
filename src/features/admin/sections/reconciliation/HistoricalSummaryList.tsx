"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  deleteHistoricalSummary,
  getHistoricalSummaryRange,
  isOk,
  listHistoricalSummary,
  updateHistoricalSummary,
  type HistoricalDailySummaryRow,
} from "@/features/historical";
import type { Role } from "@/lib/auth";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface HistoricalSummaryListProps {
  viewerRole: Role;
}

const DEFAULT_FROM = () => {
  // Default: 6 bulan ke belakang dari hari ini
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
};
const DEFAULT_TO = () => new Date().toISOString().slice(0, 10);

export function HistoricalSummaryList({
  viewerRole,
}: HistoricalSummaryListProps) {
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [editing, setEditing] = useState<HistoricalDailySummaryRow | null>(
    null,
  );
  const queryClient = useQueryClient();

  const canEdit = viewerRole === "owner";

  const listQuery = useQuery({
    queryKey: ["historical", "summary", "list", from, to],
    queryFn: async () => {
      const res = await listHistoricalSummary({ from, to, limit: 1000 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const aggQuery = useQuery({
    queryKey: ["historical", "summary", "agg", from, to],
    queryFn: async () => {
      const res = await getHistoricalSummaryRange(from, to);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const rows = listQuery.data ?? [];
  const agg = aggQuery.data;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["historical"] });
  }

  async function handleDelete(row: HistoricalDailySummaryRow) {
    if (
      !confirm(
        `Hapus data ${row.businessDate}? Aksi ini tidak bisa di-undo. Lanjut?`,
      )
    )
      return;
    const res = await deleteHistoricalSummary(row.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Data ${row.businessDate} dihapus`);
    refresh();
  }

  return (
    <div className="space-y-4 p-6">
      {/* Range filter */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="text-xs font-medium text-neutral-700">
              Dari
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-700">
              Sampai
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {agg && agg.days > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total Hari" value={String(agg.days)} />
          <Stat label="Total Bruto" value={formatRupiah(agg.totalGross)} />
          <Stat label="Total Bersih" value={formatRupiah(agg.totalNet)} />
          <Stat
            label="Rata-rata Bersih / Hari"
            value={formatRupiah(agg.avgDailyNet)}
          />
        </div>
      ) : null}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyCard
                title="Belum ada data historis di range ini"
                description="Upload CSV via tab Import Histori, atau ubah filter tanggal."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Tanggal</th>
                    <th className="px-3 py-2 text-right">Bruto</th>
                    <th className="px-3 py-2 text-right">Bersih</th>
                    <th className="px-3 py-2 text-right">HPP</th>
                    <th className="px-3 py-2 text-right">Margin %</th>
                    <th className="px-3 py-2 text-right">Trx</th>
                    <th className="px-3 py-2 text-right">Cash / QRIS / EDC / Agg</th>
                    <th className="px-3 py-2 text-left">Sumber</th>
                    {canEdit ? <th className="px-3 py-2">Aksi</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-neutral-100 hover:bg-mahakan-green-50/20"
                    >
                      <td className="px-3 py-2 font-mono">{r.businessDate}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatRupiah(r.grossRevenue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {formatRupiah(r.netRevenue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-600">
                        {r.cogs ? formatRupiah(r.cogs) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.marginPct !== null ? (
                          <span
                            className={cn(
                              r.marginPct >= 50
                                ? "text-success-700"
                                : r.marginPct >= 30
                                  ? "text-warning-700"
                                  : "text-danger-700",
                            )}
                          >
                            {r.marginPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-600">
                        {r.transactionCount}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[10px] text-neutral-500">
                        {formatRupiah(r.cashIn)} · {formatRupiah(r.qrisIn)} ·{" "}
                        {formatRupiah(r.edcIn)} ·{" "}
                        {formatRupiah(r.aggregatorIn)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-semibold text-warning-700">
                          Histori
                        </span>
                        {r.sourceLabel ? (
                          <span className="ml-1 text-[10px] text-neutral-500">
                            {r.sourceLabel}
                          </span>
                        ) : null}
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2">
                          <div className="flex justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setEditing(r)}
                              className="rounded-md p-1.5 text-neutral-600 hover:bg-mahakan-green-50"
                              title="Edit"
                            >
                              <Pencil className="size-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(r)}
                              className="rounded-md p-1.5 text-danger-600 hover:bg-danger-50"
                              title="Hapus"
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <HistoricalEditModal
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-neutral-600">
          {label}
        </div>
        <div className="mt-1 text-xl font-bold text-mahakan-green-900">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoricalEditModal({
  row,
  onClose,
  onSaved,
}: {
  row: HistoricalDailySummaryRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grossRevenue, setGrossRevenue] = useState("");
  const [netRevenue, setNetRevenue] = useState("");
  const [cogs, setCogs] = useState("");
  const [cashIn, setCashIn] = useState("");
  const [qrisIn, setQrisIn] = useState("");
  const [edcIn, setEdcIn] = useState("");
  const [aggregatorIn, setAggregatorIn] = useState("");
  const [transactionCount, setTransactionCount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (row) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setGrossRevenue(String(row.grossRevenue));
      setNetRevenue(String(row.netRevenue));
      setCogs(String(row.cogs));
      setCashIn(String(row.cashIn));
      setQrisIn(String(row.qrisIn));
      setEdcIn(String(row.edcIn));
      setAggregatorIn(String(row.aggregatorIn));
      setTransactionCount(String(row.transactionCount));
      setNotes(row.notes ?? "");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [row]);

  if (!row) return null;

  async function handleSave() {
    if (!row) return;
    setSubmitting(true);
    try {
      const res = await updateHistoricalSummary({
        id: row.id,
        grossRevenue: parseRupiah(grossRevenue) ?? 0,
        netRevenue: parseRupiah(netRevenue) ?? 0,
        cogs: parseRupiah(cogs) ?? 0,
        cashIn: parseRupiah(cashIn) ?? 0,
        qrisIn: parseRupiah(qrisIn) ?? 0,
        edcIn: parseRupiah(edcIn) ?? 0,
        aggregatorIn: parseRupiah(aggregatorIn) ?? 0,
        transactionCount: parseInt(transactionCount, 10) || 0,
        notes: notes || null,
      });
      if (!isOk(res)) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Data ter-update");
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit Historis ${row.businessDate}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}{" "}
            Simpan
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bruto" value={grossRevenue} onChange={setGrossRevenue} />
        <Field label="Bersih" value={netRevenue} onChange={setNetRevenue} />
        <Field label="HPP" value={cogs} onChange={setCogs} />
        <Field
          label="Jumlah Transaksi"
          value={transactionCount}
          onChange={setTransactionCount}
        />
        <Field label="Cash" value={cashIn} onChange={setCashIn} />
        <Field label="QRIS" value={qrisIn} onChange={setQrisIn} />
        <Field label="EDC" value={edcIn} onChange={setEdcIn} />
        <Field
          label="Aggregator"
          value={aggregatorIn}
          onChange={setAggregatorIn}
        />
      </div>
      <div className="mt-3">
        <label className="text-xs font-medium text-neutral-700">
          Catatan
        </label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
          className="mt-1"
        />
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-neutral-700">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 font-mono"
      />
    </div>
  );
}
