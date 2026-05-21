"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Filter,
  Info,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  Badge,
  Button,
  DateRangePicker,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  deleteDraftJournalEntry,
  fetchJournalEntries,
  reverseJournalEntry,
} from "@/features/accounting/actions";
import type {
  JournalEntryStatus,
  JournalEntryWithLines,
} from "@/features/accounting/types";
import {
  getOwnOutlet,
  isOk as outletIsOk,
  updateFeatures,
} from "@/features/outlets";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";
import { JournalEntryModal } from "./JournalEntryModal";

const STATUS_LABEL: Record<JournalEntryStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  reversed: "Reversed",
};

const STATUS_VARIANT: Record<
  JournalEntryStatus,
  "warning" | "success" | "neutral"
> = {
  draft: "warning",
  posted: "success",
  reversed: "neutral",
};

const SOURCE_TYPE_OPTIONS = [
  { value: "all", label: "Semua sumber" },
  { value: "manual", label: "Manual" },
  { value: "opening_balance", label: "Jurnal Pembukaan" },
  { value: "pos_sale", label: "POS Sale" },
  { value: "pos_refund", label: "POS Refund" },
  { value: "pos_compliment", label: "POS Compliment" },
  { value: "purchase_create", label: "Purchase Create" },
  { value: "purchase_pay", label: "Purchase Pay (TOP)" },
  { value: "purchase_cancel", label: "Purchase Cancel" },
  { value: "payroll_paid", label: "Payroll Paid" },
  { value: "expense_create", label: "Expense" },
  { value: "income_create", label: "Income" },
  { value: "cash_deposit_verified", label: "Cash Deposit Verified" },
  { value: "aggregator_settlement", label: "Aggregator Settlement" },
  { value: "shift_variance", label: "Shift Variance" },
  { value: "opname_adjustment", label: "Opname Adjustment" },
  { value: "period_close", label: "Period Close" },
  { value: "period_reopen", label: "Period Reopen" },
];

const STATUS_FILTER_OPTIONS: Array<{ value: "all" | JournalEntryStatus; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "posted", label: "Posted" },
  { value: "draft", label: "Draft" },
  { value: "reversed", label: "Reversed" },
];

export function JournalView({ viewerRole }: { viewerRole: Role }) {
  const [rows, setRows] = useState<JournalEntryWithLines[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /* Sesi AE-63 phase4 — edit-in-place untuk draft entry. */
  const [editEntry, setEditEntry] = useState<JournalEntryWithLines | null>(
    null,
  );

  // Filters
  const [filterSourceType, setFilterSourceType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | JournalEntryStatus>(
    "all",
  );
  const [filterRange, setFilterRange] = useState<{
    from: string | null;
    to: string | null;
  }>({ from: null, to: null });

  const canDraft = hasPermission(viewerRole, "accounting.journal.draft");
  const canPost = hasPermission(viewerRole, "accounting.journal.post");
  const canReverse = hasPermission(viewerRole, "accounting.journal.reverse");

  // Sesi AE-62c — auto-journal flag awareness untuk empty state CTA
  const queryClient = useQueryClient();
  const outletQuery = useQuery({
    queryKey: ["admin", "outlet", "own"],
    queryFn: async () => {
      const res = await getOwnOutlet();
      if (!outletIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const autoJournalEnabled =
    outletQuery.data?.settings?.features?.accounting_auto_journal === true;
  const [activating, setActivating] = useState(false);

  async function handleEnableAutoJournal() {
    setActivating(true);
    try {
      const res = await updateFeatures({ accounting_auto_journal: true });
      if (!outletIsOk(res)) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Auto-Journal aktif. Coba buat 1 transaksi POS untuk test.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "outlet"] });
    } finally {
      setActivating(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetchJournalEntries({
        limit: 100,
        sourceType: filterSourceType === "all" ? undefined : filterSourceType,
        status: filterStatus === "all" ? undefined : filterStatus,
        fromDate: filterRange.from ?? undefined,
        toDate: filterRange.to ?? undefined,
      });
      if (res.ok) setRows(res.data);
      else toast.error(res.error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [filterSourceType, filterStatus, filterRange.from, filterRange.to]);

  const hasActiveFilter =
    filterSourceType !== "all" ||
    filterStatus !== "all" ||
    filterRange.from !== null ||
    filterRange.to !== null;

  function clearFilters() {
    setFilterSourceType("all");
    setFilterStatus("all");
    setFilterRange({ from: null, to: null });
  }

  async function onReverse(entry: JournalEntryWithLines) {
    const reason = prompt(
      `Alasan reverse ${entry.entryNumber}? (min 10 karakter)`,
    );
    if (!reason || reason.trim().length < 10) {
      if (reason !== null) toast.error("Alasan minimal 10 karakter");
      return;
    }
    const res = await reverseJournalEntry(entry.id, reason.trim());
    if (res.ok) {
      toast.success(`Entry ${entry.entryNumber} ter-reverse`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  /* Sesi AE-63 phase4 — staff finance: "kita buat jurnal manual ada
   * kesalahan pencatatan ada fitur untuk edit/hapus". Posted entries
   * harus reverse (audit). Draft entries boleh di-hapus langsung. */
  async function onDeleteDraft(entry: JournalEntryWithLines) {
    if (
      !confirm(
        `Hapus draft ${entry.entryNumber}?\n\n` +
          `${entry.description}\n\n` +
          `Aksi ini tidak bisa di-undo. Lines + header akan ke-hapus permanen.`,
      )
    ) {
      return;
    }
    const res = await deleteDraftJournalEntry(entry.id);
    if (res.ok) {
      toast.success(`Draft ${entry.entryNumber} ter-hapus`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-700">
          Daftar entri jurnal (max 100). Auto-jurnal aktif kalau Owner toggle
          flag di Settings.
        </p>
        {canDraft || canPost ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Buat Entry Manual
          </Button>
        ) : null}
      </div>

      {/* Filters */}
      <div className="rounded-md border border-neutral-200 bg-neutral-50/50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Filter className="size-4 text-neutral-500" />
          <span className="text-xs font-medium uppercase text-neutral-500">
            Filter
          </span>
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              <X className="size-3" /> Reset
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Select
            label="Sumber"
            options={SOURCE_TYPE_OPTIONS}
            value={filterSourceType}
            onValueChange={setFilterSourceType}
            size="sm"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Status
            </label>
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilterStatus(opt.value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    filterStatus === opt.value
                      ? "bg-mahakan-green-700 text-white"
                      : "bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <DateRangePicker
            label="Rentang Tanggal"
            value={filterRange}
            onChange={(r) => setFilterRange({ from: r.from, to: r.to })}
          />
        </div>
        {hasActiveFilter ? (
          <p className="mt-2 text-xs text-neutral-500">
            Menampilkan {rows.length} entri dengan filter aktif
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        autoJournalEnabled ? (
          // Flag ON tapi 0 entri — informational
          <div className="rounded-md border border-dashed border-mahakan-green-300 bg-mahakan-green-50/30 p-10 text-center">
            <CheckCircle2
              className="mx-auto size-10 text-mahakan-green-700"
              aria-hidden
            />
            <h3 className="mt-3 text-sm font-medium text-mahakan-green-900">
              Auto-Journal AKTIF — belum ada entri
            </h3>
            <p className="mt-1 text-xs text-neutral-600">
              Sistem siap. Buat 1 transaksi POS / pembelian / setoran tunai →
              jurnal otomatis ter-post di sini. Atau buat manual via tombol di
              atas.
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-neutral-500">
              <Info className="size-3" /> Cutover &ldquo;Jurnal
              Pembukaan&rdquo; saldo per 31 Mei 2026 di-post via tombol di tab
              Periode.
            </p>
          </div>
        ) : (
          // Flag OFF — actionable empty state
          <div className="rounded-lg border-2 border-warning-500/50 bg-warning-50/30 p-8">
            <div className="mx-auto max-w-2xl">
              <div className="flex items-start gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning-100">
                  <Zap className="size-6 text-warning-700" aria-hidden />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-warning-900">
                    Auto-Journal NONAKTIF
                  </h3>
                  <p className="mt-1 text-sm text-neutral-700">
                    Saat ini transaksi POS / pembelian / payroll / setoran TIDAK
                    auto-post ke jurnal. Itu sebabnya tab ini kosong walau
                    transaksi sudah jalan di POS.
                  </p>
                  <p className="mt-2 text-xs text-neutral-600">
                    Klik tombol di kanan untuk aktifkan. Aman dicoba — jurnal
                    yang gagal akan di-track via audit log{" "}
                    <code className="rounded bg-neutral-100 px-1">
                      journal.posting_failed
                    </code>{" "}
                    (tidak fail transaksi POS-nya).
                  </p>
                </div>
                <Button
                  onClick={handleEnableAutoJournal}
                  disabled={activating}
                  className="shrink-0"
                >
                  {activating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Zap className="size-4" aria-hidden />
                  )}{" "}
                  Aktifkan
                </Button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                  <div className="font-semibold text-neutral-900">
                    Yang akan auto-jurnal:
                  </div>
                  <ul className="mt-1 space-y-0.5 list-disc pl-4">
                    <li>POS sale + refund + compliment</li>
                    <li>Pembelian (create / pay / cancel)</li>
                    <li>Payroll (mark paid)</li>
                    <li>Expense + income</li>
                    <li>Setoran tunai + aggregator settlement</li>
                    <li>Shift variance + opname adjustment</li>
                  </ul>
                </div>
                <div className="rounded-md border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                  <div className="font-semibold text-neutral-900">
                    Setelah aktif:
                  </div>
                  <ul className="mt-1 space-y-0.5 list-disc pl-4">
                    <li>Saldo Akun otomatis terupdate per transaksi</li>
                    <li>P&L + Trial Balance live</li>
                    <li>Period akuntansi auto-create kalau belum ada</li>
                    <li>Bisa toggle balik OFF kapan saja di Settings</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        <RowList
          rows={rows}
          canReverse={canReverse}
          canDeleteDraft={canDraft}
          canEditDraft={canDraft}
          onReverse={onReverse}
          onDeleteDraft={onDeleteDraft}
          onEditDraft={setEditEntry}
        />
      )}

      {createOpen ? (
        <JournalEntryModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void load();
          }}
          isOwner={viewerRole === "owner"}
        />
      ) : null}

      {editEntry ? (
        <JournalEntryModal
          open={editEntry != null}
          editEntry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => {
            setEditEntry(null);
            void load();
          }}
          isOwner={viewerRole === "owner"}
        />
      ) : null}
    </div>
  );
}

function RowList({
  rows,
  canReverse,
  canDeleteDraft,
  canEditDraft,
  onReverse,
  onDeleteDraft,
  onEditDraft,
}: {
  rows: JournalEntryWithLines[];
  canReverse: boolean;
  canDeleteDraft: boolean;
  canEditDraft: boolean;
  onReverse: (e: JournalEntryWithLines) => void;
  onDeleteDraft: (e: JournalEntryWithLines) => void;
  onEditDraft: (e: JournalEntryWithLines) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((entry) => {
        const totalDebit = entry.lines.reduce(
          (s, l) => s + Number(l.debit),
          0,
        );
        return (
          <details
            key={entry.id}
            className="group rounded-md border border-neutral-200 bg-white"
          >
            <summary className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-50">
              <span className="font-mono text-xs font-medium text-neutral-700">
                {entry.entryNumber}
              </span>
              <span className="text-xs text-neutral-500">
                {String(entry.entryDate)}
              </span>
              <span className="flex-1 truncate text-neutral-800">
                {entry.description}
              </span>
              <Badge variant={STATUS_VARIANT[entry.status]}>
                {STATUS_LABEL[entry.status]}
              </Badge>
              <span className="font-mono text-sm font-medium text-neutral-900">
                {formatRupiah(totalDebit)}
              </span>
              {canReverse && entry.status === "posted" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onReverse(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-danger-500"
                  aria-label={`Reverse ${entry.entryNumber}`}
                  title="Reverse entry (posted)"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              ) : null}
              {/* Sesi AE-63 phase4 — edit draft entry (only draft+manual). */}
              {canEditDraft &&
              entry.status === "draft" &&
              entry.sourceType === "manual" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onEditDraft(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-mahakan-green-700"
                  aria-label={`Edit draft ${entry.entryNumber}`}
                  title="Edit draft"
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
              {/* Sesi AE-63 phase4 — delete draft entry (only draft+manual). */}
              {canDeleteDraft &&
              entry.status === "draft" &&
              entry.sourceType === "manual" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onDeleteDraft(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-danger-50 hover:text-danger-500"
                  aria-label={`Hapus draft ${entry.entryNumber}`}
                  title="Hapus draft"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </summary>
            <div className="border-t border-neutral-100 bg-neutral-50/50 px-3 py-2">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="py-1 text-left">Akun</th>
                    <th className="py-1 text-right">Debit</th>
                    <th className="py-1 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((l) => (
                    <tr key={l.id} className="text-neutral-800">
                      <td className="py-1">
                        <span className="font-mono text-neutral-500">
                          {l.accountCode}
                        </span>{" "}
                        {l.accountName}
                        {l.description ? (
                          <span className="ml-2 text-neutral-500">
                            — {l.description}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {Number(l.debit) > 0 ? formatRupiah(Number(l.debit)) : "—"}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {Number(l.credit) > 0
                          ? formatRupiah(Number(l.credit))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
