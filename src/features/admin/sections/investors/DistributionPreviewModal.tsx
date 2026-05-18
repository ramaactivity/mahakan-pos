"use client";

import { memo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, CheckCircle2, Send, X } from "lucide-react";
import { Badge, Button, Modal, toast } from "@/components/ui";
import {
  approveAndPostDistribution,
  cancelDistribution,
  isOk,
  resendStatementsForDistribution,
  type DistributionWithLines,
} from "@/features/profit-distributions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

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

  async function handleResendAll() {
    if (submitting || !dist) return;
    if (
      !window.confirm(
        `Kirim ulang statement ke ${dist.lines.length} holder periode ${periodLabel}?`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await resendStatementsForDistribution(dist.id);
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const s = res.data;
    toast.success(
      `Statement: ${s.sent} terkirim, ${s.failed} gagal, ${s.skippedNoEmail} tanpa email, ${s.logged} logged`,
    );
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
          {isPosted && canApprove ? (
            <Button
              variant="outline"
              onClick={handleResendAll}
              disabled={submitting}
            >
              <Send className="mr-1.5 size-4" /> Kirim Ulang Statement
            </Button>
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

/* Sesi AE-63 phase2 P2.4 — memoize line row supaya 115 row (5 pengelola +
 * 110 investor) tidak recompute saat parent re-render (submit, approval
 * status change, dst). String-cast `sharePct` di parse sekali per row.
 *
 * Sesi AE-63 phase3 P3.1 — converted dari `<tr>` ke `<div role="row">` grid
 * supaya bisa di-virtualize. Pengelola section (5 row) + Investor section
 * (110 row) sama-sama pakai LinesTable. Investor table jadi list virtual,
 * DOM scroll sebelum: 110 row × 4 cell = 440 nodes; sesudah: ~12 visible. */
interface DistLineProps {
  id: string;
  holderName: string;
  modalDisetorSnapshot: number;
  sharePct: string;
  amountRupiah: number;
}

const LINES_COLS = "grid-cols-[minmax(140px,2fr)_100px_80px_120px]";

const DistLineRow = memo(function DistLineRow({ l }: { l: DistLineProps }) {
  return (
    <div
      role="row"
      className={cn(
        "grid items-center border-b border-neutral-100 text-xs",
        LINES_COLS,
      )}
    >
      <div role="cell" className="px-2 py-1 font-medium">
        {l.holderName}
      </div>
      <div
        role="cell"
        className="px-2 py-1 text-right tabular-nums text-neutral-600"
      >
        {formatRupiah(l.modalDisetorSnapshot)}
      </div>
      <div
        role="cell"
        className="px-2 py-1 text-right tabular-nums text-neutral-600"
      >
        {Number(l.sharePct).toFixed(2)}%
      </div>
      <div
        role="cell"
        className="px-2 py-1 text-right tabular-nums font-bold text-mahakan-green-900"
      >
        {formatRupiah(l.amountRupiah)}
      </div>
    </div>
  );
});

function LinesTable({ lines }: { lines: DistLineProps[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  return (
    <div className="rounded-md border border-neutral-200">
      {/* Header */}
      <div
        role="row"
        className={cn(
          "grid border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-600",
          LINES_COLS,
        )}
      >
        <div role="columnheader" className="px-2 py-1.5">
          Nama
        </div>
        <div role="columnheader" className="px-2 py-1.5 text-right">
          Modal
        </div>
        <div role="columnheader" className="px-2 py-1.5 text-right">
          Share %
        </div>
        <div role="columnheader" className="px-2 py-1.5 text-right">
          Dividen
        </div>
      </div>
      {/* Virtualized body */}
      <div
        ref={parentRef}
        role="rowgroup"
        className="max-h-64 overflow-y-auto"
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const l = lines[vRow.index];
            if (!l) return null;
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                <DistLineRow l={l} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
