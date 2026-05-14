"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import {
  Button,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  fetchReconciliationDrillDownAction,
  setReconciliationStatus,
} from "@/features/finance/actions";
import type {
  AggregatorChannel,
  ReconciliationDrillDown,
  ReconciliationStatus,
} from "@/features/finance/types";
import { formatRupiah } from "@/lib/money";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";

const CHANNEL_LABEL: Record<AggregatorChannel, string> = {
  cash: "Cash (Tunai)",
  edc_bca: "EDC BCA",
  qris: "QRIS",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
};

const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
  disputed: "Disputed",
};

const STATUS_COLOR: Record<ReconciliationStatus, string> = {
  open: "bg-neutral-100 text-neutral-700",
  investigating: "bg-warning-50 text-warning-500",
  resolved: "bg-mahakan-green-50 text-mahakan-green-900",
  disputed: "bg-danger-100 text-danger-500",
};

interface Props {
  open: boolean;
  onClose: () => void;
  channel: AggregatorChannel;
  fromDate: string;
  toDate: string;
  currentStatus: ReconciliationStatus;
  currentNote: string | null;
  viewerRole: Role;
  /** Called after status saved successfully (parent reloads). */
  onStatusSaved?: () => void;
}

type Tab = "trx" | "shifts" | "agg" | "deposits" | "status";

export function ReconciliationDrillDownModal({
  open,
  onClose,
  channel,
  fromDate,
  toDate,
  currentStatus,
  currentNote,
  viewerRole,
  onStatusSaved,
}: Props) {
  const [data, setData] = useState<ReconciliationDrillDown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("trx");

  // Status form state
  const [status, setStatus] = useState<ReconciliationStatus>(currentStatus);
  const [note, setNote] = useState(currentNote ?? "");
  const [saving, setSaving] = useState(false);

  const canUpdate = hasPermission(viewerRole, "reconciliation.update");

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(currentStatus);
    setNote(currentNote ?? "");
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetchReconciliationDrillDownAction(
        channel,
        fromDate,
        toDate,
      );
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.error.message);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, channel, fromDate, toDate, currentStatus, currentNote]);

  const tabs = useMemo(() => {
    const arr: Array<{ key: Tab; label: string; count?: number }> = [];
    if (channel !== "gofood" && channel !== "grabfood" && channel !== "shopeefood") {
      arr.push({
        key: "trx",
        label: "Transaksi POS",
        count: data?.transactions.length,
      });
    }
    arr.push({
      key: "shifts",
      label: "Shift Reports",
      count: data?.shiftReports.length,
    });
    if (channel !== "cash") {
      arr.push({
        key: "agg",
        label: "Aggregator",
        count: data?.aggregators.length,
      });
    }
    if (channel === "cash") {
      arr.push({
        key: "deposits",
        label: "Setoran Bank",
        count: data?.deposits.length,
      });
    }
    arr.push({ key: "status", label: "Status & Catatan" });
    return arr;
  }, [channel, data]);

  // Derived active tab: if current tab not in visible tabs, fall back to first
  const activeTab: Tab = tabs.find((t) => t.key === tab)
    ? tab
    : (tabs[0]?.key ?? "trx");

  async function onSaveStatus() {
    if (saving) return;
    setSaving(true);
    // Use first date in range as periodDate (per spec: status per channel per
    // day; range mode pakai fromDate sebagai canonical)
    const res = await setReconciliationStatus({
      channel,
      periodDate: fromDate,
      status,
      note: note.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Status rekonsiliasi disimpan");
    onStatusSaved?.();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Detail Rekonsiliasi — ${CHANNEL_LABEL[channel]}`}
      description={`Periode ${fromDate} → ${toDate}`}
      size="lg"
    >
      <div className="space-y-3">
        {/* Tabs */}
        <div
          role="tablist"
          className="flex flex-wrap gap-1 border-b border-neutral-200"
        >
          {tabs.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-mahakan-green-700 text-mahakan-green-900"
                    : "border-transparent text-neutral-600 hover:text-neutral-900",
                )}
              >
                {t.label}
                {typeof t.count === "number" ? (
                  <span className="ml-1 text-[10px] text-neutral-500">
                    ({t.count})
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-danger-100 bg-danger-100 p-3 text-sm text-danger-500">
            {error}
          </div>
        ) : !data ? null : (
          <>
            {data.truncated ? (
              <div className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 p-2 text-xs text-warning-500">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Hasil dipotong (1.000 row max per kategori). Persempit range
                  untuk lihat semua.
                </span>
              </div>
            ) : null}

            {activeTab === "trx" && (
              <TrxTab data={data} />
            )}
            {activeTab === "shifts" && (
              <ShiftsTab data={data} channel={channel} />
            )}
            {activeTab === "agg" && (
              <AggTab data={data} />
            )}
            {activeTab === "deposits" && (
              <DepositsTab data={data} />
            )}
            {activeTab === "status" && (
              <StatusTab
                canUpdate={canUpdate}
                status={status}
                onStatusChange={setStatus}
                note={note}
                onNoteChange={setNote}
                onSave={onSaveStatus}
                saving={saving}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function TrxTab({ data }: { data: ReconciliationDrillDown }) {
  if (data.transactions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        <Search className="mx-auto mb-2 size-6 text-neutral-300" />
        Belum ada transaksi POS di channel ini untuk range yang dipilih.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">No</th>
            <th className="px-2 py-1.5 text-left font-medium">Tanggal/Jam</th>
            <th className="px-2 py-1.5 text-left font-medium">Kasir</th>
            <th className="px-2 py-1.5 text-right font-medium">Total</th>
            <th className="px-2 py-1.5 text-right font-medium">Refund</th>
            <th className="px-2 py-1.5 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          {data.transactions.map((t) => (
            <tr key={t.transactionId} className="border-t border-neutral-100">
              <td className="px-2 py-1.5 font-mono text-[11px]">
                {t.transactionNumber}
              </td>
              <td className="px-2 py-1.5">
                {new Date(t.closedAt).toLocaleString("id-ID", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="px-2 py-1.5">{t.cashierName ?? "—"}</td>
              <td className="px-2 py-1.5 text-right font-mono">
                {formatRupiah(t.total)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-danger-500">
                {t.refundedAmount > 0 ? `-${formatRupiah(t.refundedAmount)}` : "—"}
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-semibold">
                {formatRupiah(t.netTotal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-neutral-50 font-semibold">
          <tr>
            <td colSpan={5} className="px-2 py-1.5 text-right text-neutral-700">
              Total Net
            </td>
            <td className="px-2 py-1.5 text-right font-mono">
              {formatRupiah(data.totals.transactionsSum)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ShiftsTab({
  data,
  channel,
}: {
  data: ReconciliationDrillDown;
  channel: AggregatorChannel;
}) {
  if (data.shiftReports.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        Belum ada shift closed di range ini.
      </p>
    );
  }
  const label =
    channel === "cash" ? "Cash Drawer" : `Setoran ${CHANNEL_LABEL[channel]}`;
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Tanggal</th>
            <th className="px-2 py-1.5 text-left font-medium">Kasir</th>
            <th className="px-2 py-1.5 text-right font-medium">{label}</th>
          </tr>
        </thead>
        <tbody>
          {data.shiftReports.map((s) => (
            <tr key={s.shiftId} className="border-t border-neutral-100">
              <td className="px-2 py-1.5">{s.shiftDate}</td>
              <td className="px-2 py-1.5">{s.cashierName}</td>
              <td className="px-2 py-1.5 text-right font-mono">
                {formatRupiah(s.reportedAmount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-neutral-50 font-semibold">
          <tr>
            <td colSpan={2} className="px-2 py-1.5 text-right text-neutral-700">
              Total
            </td>
            <td className="px-2 py-1.5 text-right font-mono">
              {formatRupiah(data.totals.shiftReportsSum)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function AggTab({ data }: { data: ReconciliationDrillDown }) {
  if (data.aggregators.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        Belum ada record settlement aggregator. Catat via tombol Catat
        Settlement di tab Rekonsiliasi.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Periode</th>
            <th className="px-2 py-1.5 text-right font-medium">Gross</th>
            <th className="px-2 py-1.5 text-right font-medium">Fee</th>
            <th className="px-2 py-1.5 text-right font-medium">Net</th>
            <th className="px-2 py-1.5 text-left font-medium">Ref</th>
          </tr>
        </thead>
        <tbody>
          {data.aggregators.map((a) => (
            <tr key={a.settlementId} className="border-t border-neutral-100">
              <td className="px-2 py-1.5">
                {a.periodFrom} → {a.periodTo}
              </td>
              <td className="px-2 py-1.5 text-right font-mono">
                {formatRupiah(a.grossAmount)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-neutral-500">
                {formatRupiah(a.feeAmount)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-semibold">
                {formatRupiah(a.netAmount)}
              </td>
              <td className="px-2 py-1.5 text-neutral-500">
                {a.referenceNo ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-neutral-50 font-semibold">
          <tr>
            <td className="px-2 py-1.5 text-right text-neutral-700">Total Gross</td>
            <td className="px-2 py-1.5 text-right font-mono">
              {formatRupiah(data.totals.aggregatorsGross)}
            </td>
            <td colSpan={3}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DepositsTab({ data }: { data: ReconciliationDrillDown }) {
  if (data.deposits.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        Belum ada setoran tunai di range ini.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Tanggal</th>
            <th className="px-2 py-1.5 text-left font-medium">Bank</th>
            <th className="px-2 py-1.5 text-right font-medium">Amount</th>
            <th className="px-2 py-1.5 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.deposits.map((d) => (
            <tr key={d.depositId} className="border-t border-neutral-100">
              <td className="px-2 py-1.5">{d.depositDate}</td>
              <td className="px-2 py-1.5">{d.bankDestination}</td>
              <td className="px-2 py-1.5 text-right font-mono">
                {formatRupiah(d.amount)}
              </td>
              <td className="px-2 py-1.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    d.status === "verified"
                      ? "bg-mahakan-green-50 text-mahakan-green-900"
                      : d.status === "rejected"
                        ? "bg-danger-100 text-danger-500"
                        : "bg-warning-50 text-warning-500",
                  )}
                >
                  {d.status === "verified"
                    ? "Verified"
                    : d.status === "rejected"
                      ? "Rejected"
                      : "Pending"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-neutral-50 font-semibold">
          <tr>
            <td colSpan={2} className="px-2 py-1.5 text-right text-neutral-700">
              Total Verified
            </td>
            <td className="px-2 py-1.5 text-right font-mono">
              {formatRupiah(data.totals.depositsSum)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function StatusTab({
  canUpdate,
  status,
  onStatusChange,
  note,
  onNoteChange,
  onSave,
  saving,
}: {
  canUpdate: boolean;
  status: ReconciliationStatus;
  onStatusChange: (s: ReconciliationStatus) => void;
  note: string;
  onNoteChange: (n: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const allStatuses: ReconciliationStatus[] = [
    "open",
    "investigating",
    "resolved",
    "disputed",
  ];
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-neutral-600">
          Status
        </label>
        <div className="flex flex-wrap gap-1.5">
          {allStatuses.map((s) => {
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                disabled={!canUpdate || saving}
                onClick={() => onStatusChange(s)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  active
                    ? STATUS_COLOR[s]
                    : "border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50",
                  (!canUpdate || saving) && "opacity-60 cursor-not-allowed",
                )}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-neutral-600">
          Catatan (opsional)
        </label>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value.slice(0, 2000))}
          disabled={!canUpdate || saving}
          rows={4}
          maxLength={2000}
          placeholder="Mis. selisih sudah dicek CCTV, mungkin kasir salah hitung"
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-1 focus:ring-mahakan-green-700 disabled:bg-neutral-50 disabled:opacity-60"
        />
        <p className="mt-1 text-[10px] text-neutral-500">
          {note.length}/2000 karakter
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        {!canUpdate ? (
          <p className="text-xs text-neutral-500">
            Hanya Owner/Manager yang bisa edit status rekonsiliasi.
          </p>
        ) : null}
        <Button
          onClick={onSave}
          disabled={!canUpdate || saving}
          variant={status === "resolved" ? "primary" : "outline"}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : status === "resolved" ? (
            <CheckCircle2 className="size-4" />
          ) : null}
          Simpan Status
        </Button>
      </div>
    </div>
  );
}
