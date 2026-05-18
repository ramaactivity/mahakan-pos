"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  DatePicker,
  DateRangePicker,
  Input,
  Modal,
  NumericInput,
  Skeleton,
  toast,
  type DateRangeValue,
} from "@/components/ui";
import {
  deleteSettlementLog,
  exportSettlementLogsCsv,
  getDailySettlementCrudReport,
  upsertSettlementLog,
} from "@/features/settlement-logs/actions";
import {
  classifyVariance,
  isOk,
  type ChannelSettlementRow,
  type DailySettlementCrudReport,
  type VarianceTier,
} from "@/features/settlement-logs/types";
import { formatRupiah } from "@/lib/format";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";

function todayIso(): string {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wib = new Date(now.getTime() + wibOffset);
  return wib.toISOString().slice(0, 10);
}

function startOfMonthIso(): string {
  const d = todayIso();
  return d.slice(0, 7) + "-01";
}

const TIER_LABEL: Record<VarianceTier, string> = {
  match: "Match",
  warn: "Waspada",
  alert: "Selisih Besar",
};

const TIER_BADGE: Record<VarianceTier, "success" | "warning" | "danger"> = {
  match: "success",
  warn: "warning",
  alert: "danger",
};

interface BankSettlementViewProps {
  viewerRole: Role;
}

export function BankSettlementView({ viewerRole }: BankSettlementViewProps) {
  const [date, setDate] = useState<string>(todayIso());
  const [report, setReport] = useState<DailySettlementCrudReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editTarget, setEditTarget] = useState<ChannelSettlementRow | null>(null);
  const [actualInput, setActualInput] = useState("0");
  /* Sesi AE-63 phase4 — tanggal bank credited (T+1 typical). Optional. */
  const [settledAtInput, setSettledAtInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<DateRangeValue>({
    from: startOfMonthIso(),
    to: todayIso(),
  });
  const [exportLoading, setExportLoading] = useState(false);

  const canEdit = useMemo(
    () => hasPermission(viewerRole, "settlement_log.create"),
    [viewerRole],
  );
  const canDelete = useMemo(
    () => hasPermission(viewerRole, "settlement_log.delete"),
    [viewerRole],
  );

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await getDailySettlementCrudReport(date);
      if (cancelled) return;
      if (isOk(res)) setReport(res.data);
      else setError(res.error.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, refreshKey]);

  function openEdit(row: ChannelSettlementRow) {
    setEditTarget(row);
    setActualInput(String(row.log?.actualAmount ?? row.expected));
    setSettledAtInput(row.log?.settledAt ?? "");
    setNotesInput(row.log?.notes ?? "");
  }

  async function submitEdit() {
    if (!editTarget) return;
    const actual = parseInt(actualInput, 10);
    if (!Number.isFinite(actual) || actual < 0) {
      toast.error("Actual harus angka non-negatif");
      return;
    }
    setSubmitting(true);
    const res = await upsertSettlementLog({
      settlementDate: date,
      channel: editTarget.channel,
      expectedAmount: editTarget.expected,
      actualAmount: actual,
      settledAt: settledAtInput.trim() || null,
      notes: notesInput.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Mutasi disimpan");
    setEditTarget(null);
    setRefreshKey((k) => k + 1);
  }

  async function handleDelete(row: ChannelSettlementRow) {
    if (!row.log) return;
    if (!confirm(`Hapus mutasi ${row.label}?`)) return;
    const res = await deleteSettlementLog(row.log.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Mutasi dihapus");
    setRefreshKey((k) => k + 1);
  }

  async function handleExport() {
    if (!exportRange.from || !exportRange.to) {
      toast.error("Pilih rentang tanggal");
      return;
    }
    setExportLoading(true);
    const res = await exportSettlementLogsCsv({
      from: exportRange.from,
      to: exportRange.to,
    });
    setExportLoading(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    if (res.data.rowCount === 0) {
      toast.info("Tidak ada data di rentang tanggal");
      return;
    }
    const blob = new Blob([res.data.csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.data.filename;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    toast.success(`CSV diekspor (${res.data.rowCount} baris)`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DatePicker
          label="Tanggal"
          value={date}
          onChange={(v) => setDate(v ?? todayIso())}
        />
        <Button variant="outline" onClick={() => setExportOpen(true)}>
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : !report ? null : (
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="p-3">Channel</th>
                <th className="p-3 text-right">Expected (POS)</th>
                <th className="p-3 text-right">Actual (Bank)</th>
                <th className="p-3 text-right">Selisih</th>
                <th className="p-3">Status</th>
                <th className="p-3">Catatan</th>
                <th className="p-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const tier = row.log ? classifyVariance(row.log) : null;
                return (
                  <tr
                    key={row.channel}
                    className="border-t border-neutral-200 hover:bg-neutral-50"
                  >
                    <td className="p-3 font-medium text-neutral-900">
                      {row.label}
                    </td>
                    <td className="p-3 text-right font-mono text-neutral-700">
                      {formatRupiah(row.expected)}
                    </td>
                    <td
                      className={cn(
                        "p-3 text-right font-mono",
                        row.log ? "text-neutral-900" : "text-neutral-400",
                      )}
                    >
                      {row.log
                        ? formatRupiah(Number(row.log.actualAmount))
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "p-3 text-right font-mono",
                        !row.log
                          ? "text-neutral-400"
                          : row.log.variance === 0
                            ? "text-neutral-700"
                            : row.log.variance > 0
                              ? "text-emerald-700"
                              : "text-rose-700",
                      )}
                    >
                      {row.log ? formatVariance(row.log.variance) : "—"}
                    </td>
                    <td className="p-3">
                      {tier ? (
                        <Badge variant={TIER_BADGE[tier]}>
                          {TIER_LABEL[tier]}
                          {row.log!.variancePct > 0
                            ? ` ${(row.log!.variancePct * 100).toFixed(1)}%`
                            : ""}
                        </Badge>
                      ) : (
                        <span className="text-xs text-neutral-400">
                          Belum input
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-neutral-700">
                      {row.log?.notes ?? "—"}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(row)}
                            aria-label={`Edit ${row.label}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {canDelete && row.log ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(row)}
                            aria-label={`Hapus ${row.label}`}
                          >
                            <Trash2 className="size-4 text-rose-700" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-neutral-50 text-sm font-semibold">
              <tr className="border-t-2 border-neutral-300">
                <td className="p-3">Total</td>
                <td className="p-3 text-right font-mono">
                  {formatRupiah(report.totals.expected)}
                </td>
                <td className="p-3 text-right font-mono">
                  {formatRupiah(report.totals.actual)}
                </td>
                <td
                  className={cn(
                    "p-3 text-right font-mono",
                    report.totals.variance === 0
                      ? "text-neutral-700"
                      : report.totals.variance > 0
                        ? "text-emerald-700"
                        : "text-rose-700",
                  )}
                >
                  {formatVariance(report.totals.variance)}
                </td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Threshold default: ≤ 1% Match · 1–5% Waspada · &gt; 5% Selisih Besar.
        Aggregator (GoFood/GrabFood/ShopeeFood) tidak auto-expected — input
        actual berdasarkan settlement aktual dari aplikasi.
      </p>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Input Mutasi ${editTarget.label}` : ""}
        description={`Tanggal ${date}`}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setEditTarget(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={submitEdit} disabled={submitting}>
              {submitting ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        }
      >
        {editTarget ? (
          <div className="space-y-3">
            <div className="rounded-md bg-neutral-50 p-3 text-sm">
              <p className="text-neutral-600">Expected dari POS</p>
              <p className="font-mono text-base font-semibold text-neutral-900">
                {formatRupiah(editTarget.expected)}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Actual mutasi bank (Rp)
              </label>
              <NumericInput
                value={actualInput}
                onChange={setActualInput}
                allowDecimal={false}
                prefix="Rp"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Tanggal settle ke bank{" "}
                <span className="text-xs font-normal text-neutral-500">
                  (opsional · biasanya T+1)
                </span>
              </label>
              <Input
                type="date"
                value={settledAtInput}
                min={date}
                onChange={(e) => setSettledAtInput(e.target.value)}
              />
              <p className="mt-1 text-xs text-neutral-500">
                Tanggal saat uang actually masuk rekening. Tanggal sale (POS):{" "}
                <span className="font-mono">{date}</span>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Catatan (opsional)
              </label>
              <Input
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Mis. mutasi belum masuk, tunda T+2"
              />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export Settlement Logs"
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setExportOpen(false)}
              disabled={exportLoading}
            >
              Batal
            </Button>
            <Button onClick={handleExport} disabled={exportLoading}>
              {exportLoading ? "Mengunduh..." : "Download CSV"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <DateRangePicker
            label="Rentang tanggal"
            value={exportRange}
            onChange={setExportRange}
          />
          <p className="text-xs text-neutral-500">
            CSV memuat semua channel & catatan dalam rentang yang dipilih.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function formatVariance(n: number): string {
  if (n === 0) return formatRupiah(0);
  const sign = n > 0 ? "+" : "−";
  return `${sign} ${formatRupiah(Math.abs(n))}`;
}
