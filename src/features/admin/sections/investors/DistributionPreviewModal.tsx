"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Badge, Button, Modal, toast } from "@/components/ui";
import {
  approveAndPostDistribution,
  cancelDistribution,
  isOk,
  type DistributionWithLines,
} from "@/features/profit-distributions";
import { formatRupiah } from "@/lib/format";

interface DistributionPreviewModalProps {
  open: boolean;
  distribution: DistributionWithLines | null;
  onClose: () => void;
  onChanged: () => void;
  /** Owner only — show approve button. */
  canApprove: boolean;
}

const MONTH_LABELS_ID = [
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

export function DistributionPreviewModal({
  open,
  distribution: dist,
  onClose,
  onChanged,
  canApprove,
}: DistributionPreviewModalProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!dist) return null;
  const periodLabel = `${MONTH_LABELS_ID[dist.periodMonth - 1]} ${dist.periodYear}`;
  const isDraft = dist.status === "draft";
  const isPosted = dist.status === "posted";

  async function handleApprove() {
    if (submitting || !dist) return;
    if (
      !window.confirm(
        `Yakin approve & post distribusi ${periodLabel}? Ini akan membuat jurnal Dr 3201 / Cr 1101 dan email statement ke ${dist.lines.length} holder.`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await approveAndPostDistribution(dist.id);
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Distribusi ${periodLabel} berhasil di-post`);
    onChanged();
    onClose();
  }

  async function handleCancel() {
    if (submitting || !dist) return;
    const reason = window.prompt("Alasan cancel distribusi:", "");
    if (!reason || reason.trim().length < 3) {
      toast.error("Alasan minimal 3 karakter");
      return;
    }
    setSubmitting(true);
    const res = await cancelDistribution(dist.id, reason);
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Distribusi di-cancel");
    onChanged();
    onClose();
  }

  const investorLines = dist.lines.filter((l) => l.holderType === "investor");
  const pengelolaLines = dist.lines.filter(
    (l) => l.holderType === "pengelola",
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Distribusi Dividen — ${periodLabel}`}
      description={`Status: ${dist.status.toUpperCase()} · Net Profit: ${formatRupiah(dist.netProfitSnapshot)}`}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Tutup
          </Button>
          {isDraft && canApprove ? (
            <>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={submitting}
              >
                <X className="mr-1.5 size-4" /> Cancel
              </Button>
              <Button onClick={handleApprove} loading={submitting}>
                <CheckCircle2 className="mr-1.5 size-4" /> Approve & Post
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {/* Status badge */}
      <div className="mb-3">
        <Badge
          variant={
            isPosted
              ? "success"
              : dist.status === "cancelled"
                ? "danger"
                : isDraft
                  ? "warning"
                  : "info"
          }
        >
          {dist.status.toUpperCase()}
        </Badge>
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard label="Net Profit" value={dist.netProfitSnapshot} />
        <SummaryCard label="Bagi Hasil" value={dist.bagiHasilAmount} tone="primary" />
        <SummaryCard label="Loss & Bricket" value={dist.lossAmount} />
        <SummaryCard label="Capex" value={dist.capexAmount} />
        <SummaryCard label="Retained" value={dist.retainedAmount} />
        <SummaryCard
          label={`Investor Pool (${dist.investorPoolPct}%)`}
          value={dist.investorPoolAmount}
          tone="info"
        />
        <SummaryCard
          label={`Pengelola Pool (${dist.pengelolaPoolPct}%)`}
          value={dist.pengelolaPoolAmount}
          tone="info"
        />
        <SummaryCard label="Total Lines" value={dist.totalLinesAmount} />
      </div>

      {dist.bagiHasilAmount === 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Tidak ada Bagi Hasil</p>
            <p>
              Net Profit ≤ 0 untuk period ini (loss month). Approve action akan
              ditolak.
            </p>
          </div>
        </div>
      ) : null}

      {/* Pengelola lines */}
      {pengelolaLines.length > 0 ? (
        <section className="mb-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
            Pengelola ({pengelolaLines.length})
          </h4>
          <LinesTable lines={pengelolaLines} />
        </section>
      ) : null}

      {/* Investor lines */}
      {investorLines.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
            Investor ({investorLines.length})
          </h4>
          <LinesTable lines={investorLines} />
        </section>
      ) : null}
    </Modal>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "primary" | "info";
}) {
  const cls =
    tone === "primary"
      ? "border-mahakan-green-700/30 bg-mahakan-green-50"
      : tone === "info"
        ? "border-blue-200 bg-blue-50"
        : "border-neutral-200 bg-white";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wide text-neutral-600">
        {label}
      </p>
      <p className="text-sm font-bold tabular-nums text-neutral-900">
        {formatRupiah(value)}
      </p>
    </div>
  );
}

function LinesTable({
  lines,
}: {
  lines: { id: string; holderName: string; modalDisetorSnapshot: number; sharePct: string; amountRupiah: number }[];
}) {
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-neutral-200">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-600">
          <tr>
            <th className="px-2 py-1.5">Nama</th>
            <th className="px-2 py-1.5 text-right">Modal</th>
            <th className="px-2 py-1.5 text-right">Share %</th>
            <th className="px-2 py-1.5 text-right">Dividen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-2 py-1 font-medium">{l.holderName}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                {formatRupiah(l.modalDisetorSnapshot)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                {Number(l.sharePct).toFixed(2)}%
              </td>
              <td className="px-2 py-1 text-right tabular-nums font-bold text-mahakan-green-900">
                {formatRupiah(l.amountRupiah)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
