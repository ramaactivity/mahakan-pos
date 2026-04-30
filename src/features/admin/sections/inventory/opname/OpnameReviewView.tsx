"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Modal,
  toast,
} from "@/components/ui";
import {
  computeDiffStats,
  finalizeOpname,
  isOk,
  reopenOpname,
  type OpnameSessionDetail,
} from "@/features/stock-opname";
import type { Role } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { downloadOpnameResult } from "./opname-csv";
import { cn } from "@/lib/utils";

interface OpnameReviewViewProps {
  detail: OpnameSessionDetail;
  role: Role;
  onCancel: () => void;
  onFinalized: () => void;
  onReopened: () => void;
}

export function OpnameReviewView({
  detail,
  role,
  onCancel,
  onFinalized,
  onReopened,
}: OpnameReviewViewProps) {
  const canFinalize = hasPermission(role, "inventory.opname.finalize");
  const canCancel = hasPermission(role, "inventory.opname.cancel");

  const [showAll, setShowAll] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeErr, setFinalizeErr] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenSubmitting, setReopenSubmitting] = useState(false);

  const stats = useMemo(
    () =>
      computeDiffStats(
        detail.lines.map((l) => ({
          expectedQty: l.expectedQty,
          actualQty: l.actualQty,
          unitCostAtSnapshot: l.unitCostAtSnapshot,
        })),
      ),
    [detail.lines],
  );

  const sortedLines = useMemo(() => {
    return [...detail.lines].sort((a, b) => {
      const aDiff =
        a.actualQty !== null
          ? Math.abs(a.actualQty - a.expectedQty)
          : -1;
      const bDiff =
        b.actualQty !== null
          ? Math.abs(b.actualQty - b.expectedQty)
          : -1;
      if (aDiff !== bDiff) return bDiff - aDiff;
      return a.ingredientNameSnapshot.localeCompare(
        b.ingredientNameSnapshot,
        "id-ID",
      );
    });
  }, [detail.lines]);

  const visibleLines = showAll
    ? sortedLines
    : sortedLines.filter((l) => {
        if (l.actualQty === null) return true;
        return l.actualQty - l.expectedQty !== 0;
      });

  async function onFinalize() {
    if (finalizing) return;
    setFinalizing(true);
    setFinalizeErr(null);
    const res = await finalizeOpname({ sessionId: detail.id });
    setFinalizing(false);
    if (!isOk(res)) {
      setFinalizeErr(res.error.message);
      return;
    }
    toast.success(
      `Opname selesai — ${res.data.movementsCreated} adjust dicatat`,
    );
    setConfirmFinalize(false);
    onFinalized();
  }

  async function onReopen() {
    if (reopenSubmitting) return;
    setReopenSubmitting(true);
    const res = await reopenOpname({ sessionId: detail.id });
    setReopenSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Opname dibuka kembali — staff bisa lanjut input");
    setReopenOpen(false);
    onReopened();
  }

  function onExport() {
    downloadOpnameResult(detail.periodLabel, detail.lines);
    toast.success("Export hasil opname di-download");
  }

  return (
    <div className="space-y-4">
      <Card className="border-warning-500/40 bg-warning-100/30">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">
                Review Opname {detail.periodLabel}
              </h2>
              <p className="text-xs text-neutral-600">
                Disubmit{" "}
                {detail.submittedAt
                  ? new Date(detail.submittedAt).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "—"}{" "}
                oleh {detail.submittedByName ?? "—"}
              </p>
            </div>
            <Badge variant="warning">Menunggu review</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat
              label="Sesuai"
              value={`${stats.matchingLines}`}
              tone="ok"
            />
            <Stat
              label="Selisih"
              value={`${stats.surplusLines + stats.shortageLines}`}
              tone={
                stats.surplusLines + stats.shortageLines > 0
                  ? "warn"
                  : "ok"
              }
            />
            <Stat
              label="Δ Qty (abs)"
              value={stats.totalAbsDiffQty.toLocaleString("id-ID")}
            />
            <Stat
              label="Δ Cost (abs)"
              value={formatRupiah(stats.totalAbsDiffCost)}
              tone={stats.totalAbsDiffCost > 0 ? "warn" : "ok"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canFinalize ? (
              <Button
                size="sm"
                onClick={() => setConfirmFinalize(true)}
                disabled={stats.countedLines === 0}
              >
                <CheckCircle2 className="size-4" aria-hidden /> Finalize
                (Tulis Adjust)
              </Button>
            ) : (
              <p className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
                <AlertCircle className="mr-1 inline size-3.5" aria-hidden />{" "}
                Menunggu manager / owner untuk finalize.
              </p>
            )}
            {canFinalize ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReopenOpen(true)}
              >
                <ArrowLeft className="size-4" aria-hidden /> Reopen untuk
                Revisi
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onExport}>
              <Download className="size-4" aria-hidden /> Hasil (CSV)
            </Button>
            {canCancel ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onCancel}
                className="ml-auto text-danger-500 hover:bg-danger-100"
              >
                <X className="size-4" aria-hidden /> Cancel Sesi
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <h3 className="text-sm font-semibold text-neutral-900">
            Hasil Hitung
          </h3>
          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
            />
            Tampilkan semua bahan ({stats.matchingLines} yg sesuai
            disembunyikan default)
          </label>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Bahan</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Expected
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Aktual
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Selisih
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Δ Cost
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    Catatan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibleLines.map((l) => {
                  const actual = l.actualQty;
                  const diff =
                    actual !== null ? actual - l.expectedQty : null;
                  const cost =
                    diff !== null ? diff * l.unitCostAtSnapshot : null;
                  return (
                    <tr key={l.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-neutral-900">
                          {l.ingredientNameSnapshot}
                        </span>
                        <span className="ml-1 text-xs text-neutral-500">
                          ({l.unitSnapshot})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {l.expectedQty.toLocaleString("id-ID")}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {actual !== null ? (
                          actual.toLocaleString("id-ID")
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-mono",
                          diff === null
                            ? "text-neutral-400"
                            : diff === 0
                              ? "text-neutral-500"
                              : diff > 0
                                ? "text-success-500"
                                : "text-danger-500",
                        )}
                      >
                        {diff === null
                          ? "—"
                          : diff === 0
                            ? "0"
                            : `${diff > 0 ? "+" : ""}${diff.toLocaleString(
                                "id-ID",
                              )}`}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-mono text-xs",
                          cost === null
                            ? "text-neutral-400"
                            : cost === 0
                              ? "text-neutral-500"
                              : cost > 0
                                ? "text-success-500"
                                : "text-danger-500",
                        )}
                      >
                        {cost === null
                          ? "—"
                          : cost === 0
                            ? formatRupiah(0)
                            : `${cost > 0 ? "+" : "-"}${formatRupiah(
                                Math.abs(cost),
                              )}`}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {l.note ?? (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleLines.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500">
                Semua bahan sesuai expected — tidak ada selisih.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Modal
        open={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        title="Finalize opname?"
        description={`Akan dibuat ${stats.surplusLines + stats.shortageLines} adjust movements. Stok bahan akan di-update sesuai hasil count.`}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmFinalize(false)}
              disabled={finalizing}
            >
              Batal
            </Button>
            <Button onClick={onFinalize} loading={finalizing}>
              Finalize
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-neutral-700">
            Aksi ini tidak bisa di-undo. Setelah finalize:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-700">
            <li>
              {stats.surplusLines} bahan dengan kelebihan stok akan di-tambah
            </li>
            <li>
              {stats.shortageLines} bahan dengan kekurangan stok akan di-kurang
            </li>
            <li>
              {stats.matchingLines} bahan yang sesuai expected — tidak ada
              perubahan
            </li>
          </ul>
          {stats.totalAbsDiffCost > 0 ? (
            <p className="rounded-md bg-warning-100/40 p-2 text-xs text-warning-500">
              Total dampak biaya (absolute):{" "}
              <strong>{formatRupiah(stats.totalAbsDiffCost)}</strong>
            </p>
          ) : null}
          {finalizeErr ? (
            <p className="rounded-md bg-danger-100 p-2 text-xs text-danger-500">
              {finalizeErr}
            </p>
          ) : null}
        </div>
      </Modal>

      <ReopenModal
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        onConfirm={onReopen}
        submitting={reopenSubmitting}
      />
    </div>
  );
}

function ReopenModal({
  open,
  onClose,
  onConfirm,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reopen opname untuk revisi?"
      description="Sesi akan kembali ke status berjalan dan staff bisa edit count lagi."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onConfirm} loading={submitting}>
            Reopen
          </Button>
        </>
      }
    >
      <p className="text-sm text-neutral-700">
        Pakai ini kalau ada angka yang masih perlu dikoreksi sebelum
        finalize.
      </p>
    </Modal>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-md p-2",
        tone === "ok"
          ? "bg-mahakan-green-100/40"
          : tone === "warn"
            ? "bg-warning-100/40"
            : "bg-neutral-50",
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="font-mono text-base font-semibold text-neutral-900">
        {value}
      </p>
    </div>
  );
}
