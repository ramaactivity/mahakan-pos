"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Lock,
  CheckCircle2,
  Calendar,
  BookOpen,
  Unlock,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  AlertCircle,
} from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@/components/ui";
import {
  closeAccountingPeriod,
  ensureCurrentPeriod,
  fetchIncomeStatement,
  fetchPeriods,
  lockAccountingPeriod,
  reopenAccountingPeriod,
} from "@/features/accounting/actions";
import type { IncomeStatementReport } from "@/features/accounting/reports";
import { formatRupiah } from "@/lib/money";
import type {
  PeriodStatus,
  PeriodSummary,
} from "@/features/accounting/types";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { CutoverWizard } from "./CutoverWizard";

const MONTH_NAMES = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const STATUS_LABEL: Record<PeriodStatus, string> = {
  open: "Open",
  closed: "Closed",
  locked: "Locked",
};

const STATUS_VARIANT: Record<
  PeriodStatus,
  "warning" | "success" | "neutral"
> = {
  open: "warning",
  closed: "success",
  locked: "neutral",
};

export function PeriodsView({ viewerRole }: { viewerRole: Role }) {
  const [rows, setRows] = useState<PeriodSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cutoverOpen, setCutoverOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<IncomeStatementReport | null>(null);

  const canClose = hasPermission(viewerRole, "accounting.period.close");
  const canReopen = hasPermission(viewerRole, "accounting.period.reopen");
  const canLock = hasPermission(viewerRole, "accounting.period.lock");
  const canCutover = hasPermission(
    viewerRole,
    "accounting.opening_balance.input",
  );

  async function load() {
    setLoading(true);
    try {
      const res = await fetchPeriods();
      if (res.ok) {
        setRows(res.data);
        // Auto-load preview untuk current open period (yang terbaru status='open')
        const currentOpen = res.data.find((p) => p.status === "open");
        if (currentOpen) {
          const yyyy = currentOpen.periodYear;
          const mm = String(currentOpen.periodMonth).padStart(2, "0");
          const lastDay = new Date(yyyy, currentOpen.periodMonth, 0).getDate();
          const previewRes = await fetchIncomeStatement({
            fromDate: `${yyyy}-${mm}-01`,
            toDate: `${yyyy}-${mm}-${String(lastDay).padStart(2, "0")}`,
            periodLabel: `${MONTH_NAMES[currentOpen.periodMonth]} ${yyyy}`,
          });
          if (previewRes.ok) setPreview(previewRes.data);
        } else {
          setPreview(null);
        }
      } else toast.error(res.error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function onEnsure() {
    setCreating(true);
    try {
      const res = await ensureCurrentPeriod();
      if (res.ok) {
        toast.success(
          `Periode ${res.data.periodYear}-${String(res.data.periodMonth).padStart(2, "0")} siap`,
        );
        void load();
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setCreating(false);
    }
  }

  async function onClose(p: PeriodSummary) {
    if (
      !confirm(
        `Tutup periode ${MONTH_NAMES[p.periodMonth]} ${p.periodYear}? Closing entry akan generate (transfer revenue+expense ke 3302 Laba Rugi → 3301 Saldo Laba). Reversible via "Buka Kembali" tapi audit-logged.`,
      )
    ) {
      return;
    }
    setBusy(p.id);
    const res = await closeAccountingPeriod(p.id);
    setBusy(null);
    if (res.ok) {
      toast.success(`Periode ditutup. Closing entry: ${res.data.entryNumber || "—"}`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  async function onReopen(p: PeriodSummary) {
    const reason = prompt(
      `Alasan buka kembali periode ${MONTH_NAMES[p.periodMonth]} ${p.periodYear}? (min 10 karakter, akan masuk audit log)`,
    );
    if (!reason || reason.trim().length < 10) {
      if (reason !== null) toast.error("Alasan minimal 10 karakter");
      return;
    }
    setBusy(p.id);
    const res = await reopenAccountingPeriod(p.id, reason.trim());
    setBusy(null);
    if (res.ok) {
      toast.success(`Periode dibuka kembali`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  async function onLock(p: PeriodSummary) {
    if (
      !confirm(
        `Lock periode ${MONTH_NAMES[p.periodMonth]} ${p.periodYear} permanent? IRREVERSIBLE — tidak ada UI untuk unlock setelah ini.`,
      )
    ) {
      return;
    }
    setBusy(p.id);
    const res = await lockAccountingPeriod(p.id);
    setBusy(null);
    if (res.ok) {
      toast.success(`Periode terkunci permanent`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-700">
          Periode bulanan (Asia/Jakarta calendar). State: <em>open</em> →{" "}
          <em>closed</em> → <em>locked</em> (irreversible).
        </p>
        <div className="flex gap-2">
          {canCutover ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCutoverOpen(true)}
            >
              <BookOpen className="size-4" /> Cutover (Jurnal Pembukaan)
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={onEnsure}
            disabled={creating}
            loading={creating}
          >
            <Plus className="size-4" /> Buat Periode Bulan Ini
          </Button>
        </div>
      </div>

      {/* Period preview tile — current open period quick stats */}
      {preview ? (
        <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/30 p-3">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="size-4 text-mahakan-green-700" />
            <span className="text-sm font-semibold text-mahakan-green-900">
              Ringkasan Periode Berjalan — {preview.periodLabel}
            </span>
            <span className="text-xs text-neutral-500">(preview, before close)</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <PreviewTile
              label="Pendapatan Bersih"
              value={preview.netRevenue}
              positive
            />
            <PreviewTile
              label="HPP"
              value={-preview.cogs.subtotal}
              negative
            />
            <PreviewTile
              label="Beban Operasional"
              value={-preview.expenses.subtotal}
              negative
            />
            <PreviewTile
              label="Laba / Rugi Bersih"
              value={preview.netIncome}
              emphasis
            />
          </div>
          {preview.netIncome < 0 ? (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-warning-500">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              Periode berjalan menunjukkan rugi bersih. Cek anomali di Laporan
              tab sebelum tutup periode.
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-10 text-center">
          <Calendar className="mx-auto size-10 text-neutral-300" aria-hidden />
          <h3 className="mt-3 text-sm font-medium text-neutral-700">
            Belum ada periode akuntansi
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Klik &ldquo;Buat Periode Bulan Ini&rdquo; untuk mulai.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200 bg-white">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Periode
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Status
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                  Entri Aktif
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Tutup
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Lock
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 text-sm font-medium text-neutral-900">
                    {MONTH_NAMES[p.periodMonth]} {p.periodYear}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[p.status as PeriodStatus]}>
                      {p.status === "locked" ? (
                        <Lock className="size-3" />
                      ) : p.status === "closed" ? (
                        <CheckCircle2 className="size-3" />
                      ) : null}
                      {STATUS_LABEL[p.status as PeriodStatus]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-neutral-700">
                    {p.entryCount}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {p.closedAt
                      ? new Date(p.closedAt).toLocaleDateString("id-ID")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {p.lockedAt
                      ? new Date(p.lockedAt).toLocaleDateString("id-ID")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {p.status === "open" && canClose ? (
                        <button
                          type="button"
                          onClick={() => onClose(p)}
                          disabled={busy === p.id}
                          className="rounded p-1 text-success-500 hover:bg-success-100 disabled:opacity-30"
                          aria-label="Tutup periode"
                          title="Tutup periode + closing entry"
                        >
                          <CheckCircle2 className="size-4" />
                        </button>
                      ) : null}
                      {p.status === "closed" && canReopen ? (
                        <button
                          type="button"
                          onClick={() => onReopen(p)}
                          disabled={busy === p.id}
                          className="rounded p-1 text-warning-500 hover:bg-warning-100 disabled:opacity-30"
                          aria-label="Buka kembali periode"
                          title="Buka kembali periode (audit)"
                        >
                          <Unlock className="size-4" />
                        </button>
                      ) : null}
                      {p.status === "closed" && canLock ? (
                        <button
                          type="button"
                          onClick={() => onLock(p)}
                          disabled={busy === p.id}
                          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                          aria-label="Lock periode permanent"
                          title="Lock permanent (irreversible)"
                        >
                          <ShieldCheck className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cutoverOpen ? (
        <CutoverWizard
          open={cutoverOpen}
          onClose={() => setCutoverOpen(false)}
          onPosted={() => {
            setCutoverOpen(false);
            void load();
          }}
        />
      ) : null}

      <p className="text-xs text-neutral-500">
        Closing entry: revenue + beban → 3302 Laba Rugi Berjalan → 3301 Saldo
        Laba. Reopen membuat counter-entry (audit).
      </p>
    </div>
  );
}

function PreviewTile({
  label,
  value,
  positive,
  negative,
  emphasis,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
  emphasis?: boolean;
}) {
  const negNumber = value < 0;
  return (
    <div
      className={
        emphasis
          ? "rounded-md border border-mahakan-green-300 bg-white p-2.5"
          : "rounded-md border border-neutral-200 bg-white p-2.5"
      }
    >
      <div className="flex items-center gap-1 text-xs text-neutral-500">
        {positive ? <TrendingUp className="size-3" /> : null}
        {negative ? <TrendingDown className="size-3" /> : null}
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-sm font-semibold ${
          emphasis
            ? value >= 0
              ? "text-mahakan-green-700"
              : "text-danger-500"
            : negNumber
              ? "text-danger-500"
              : "text-neutral-900"
        }`}
      >
        {negNumber ? "(" : ""}
        {formatRupiah(Math.abs(value))}
        {negNumber ? ")" : ""}
      </div>
    </div>
  );
}
