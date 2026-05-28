"use client";

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  KeyRound,
  Mail,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import { formatTimeAgoFriendly } from "@/lib/duration";
import { cn } from "@/lib/utils";
import type { ApprovalKind, UnifiedApprovalItem } from "@/features/approvals";

/* ---------- Visual config per kind ---------- */

const KIND_META: Record<
  ApprovalKind,
  {
    label: string;
    badge: "info" | "warning" | "danger" | "success" | "neutral";
  }
> = {
  void: { label: "Void", badge: "danger" },
  refund: { label: "Refund", badge: "warning" },
  correction: { label: "Koreksi", badge: "warning" },
  rebalance: { label: "Rebalance", badge: "info" },
  entry_change: { label: "Edit Catatan", badge: "neutral" },
};

const STALE_THRESHOLD_MIN = 60;

export interface ApprovalCardProps {
  item: UnifiedApprovalItem;
  /** Milliseconds clock dari parent (ticking) untuk age calculation. */
  nowMs: number;
  isSubmitter: boolean;
  /** Owner-only: direct approve langsung tanpa kode. */
  onDirectApprove?: () => void;
  /** Manager/Supervisor: input kode 6-digit. */
  onApproveWithCode?: () => void;
  /** Owner/Manager: reject dengan alasan. */
  onReject?: () => void;
  /** Submitter sendiri: cancel pengajuan. */
  onCancel?: () => void;
}

export function ApprovalCard({
  item,
  nowMs,
  isSubmitter,
  onDirectApprove,
  onApproveWithCode,
  onReject,
  onCancel,
}: ApprovalCardProps) {
  const meta = KIND_META[item.kind];
  const ageMin = Math.floor((nowMs - item.requestedAt.getTime()) / 60_000);
  const isStale = item.status === "pending" && ageMin > STALE_THRESHOLD_MIN;
  const ageFriendly = formatTimeAgoFriendly(item.requestedAt, nowMs);

  return (
    <Card
      className={cn(
        "transition-colors",
        isStale && "border-warning-500/40 bg-warning-100/20",
        item.status === "approved" && "border-success-500/30 bg-success-50/40",
        item.status === "rejected" && "border-danger-500/30 bg-danger-50/40",
        (item.status === "cancelled" || item.status === "expired") &&
          "opacity-70",
      )}
    >
      <CardContent className="space-y-2 p-4">
        {/* Header row: type chip + status + age */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={meta.badge}>{meta.label}</Badge>
              <StatusBadge status={item.status} />
              {isSubmitter && item.status === "pending" ? (
                <Badge variant="info">Pengajuan Anda</Badge>
              ) : null}
              {isStale ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning-700"
                  title={`Diajukan ${formatIndonesianDateTime(item.requestedAt)}`}
                >
                  <Clock className="size-3" /> {ageFriendly}
                </span>
              ) : item.status === "pending" ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-neutral-500"
                  title={`Diajukan ${formatIndonesianDateTime(item.requestedAt)}`}
                >
                  <Clock className="size-3" /> {ageFriendly}
                </span>
              ) : null}
            </div>
            <p className="mt-1 font-semibold text-neutral-900">{item.title}</p>
            <p className="text-xs text-neutral-700">{item.subtitle}</p>
            <p className="mt-1 text-[11px] text-neutral-500">
              Diajukan {formatIndonesianDateTime(item.requestedAt)} oleh{" "}
              {item.requesterName ?? "—"}
              {item.codeFirstTwo ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-info-100/60 px-1.5 py-0.5 text-info-700">
                  <Mail className="size-3" /> Kode {item.codeFirstTwo}…
                </span>
              ) : null}
            </p>
          </div>

          {/* Right column: action buttons (context-aware) */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {onDirectApprove ? (
              <Button
                size="sm"
                onClick={onDirectApprove}
                className="bg-mahakan-green-700 hover:bg-mahakan-green-800"
              >
                <ShieldCheck className="size-4" /> Approve
              </Button>
            ) : null}
            {onApproveWithCode ? (
              <Button size="sm" variant="outline" onClick={onApproveWithCode}>
                <KeyRound className="size-4" /> Input Kode
              </Button>
            ) : null}
            {onReject ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onReject}
                className="text-danger-500 hover:bg-danger-100"
              >
                <XCircle className="size-4" /> Tolak
              </Button>
            ) : null}
            {onCancel ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onCancel}
                className="text-warning-700 hover:bg-warning-100"
              >
                <Ban className="size-4" /> Batalkan
              </Button>
            ) : null}
          </div>
        </div>

        {/* Amount + reason row */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
          {item.amount !== null && item.amount !== 0 ? (
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-neutral-500">
                Dampak:
              </span>
              <span
                className={cn(
                  "font-mono font-semibold",
                  item.amount > 0
                    ? "text-mahakan-green-700"
                    : "text-danger-500",
                )}
              >
                {item.amount > 0 ? "+" : ""}
                {formatRupiah(item.amount)}
              </span>
            </div>
          ) : (
            <span className="text-xs text-neutral-500">—</span>
          )}
          <p className="min-w-0 flex-1 text-right text-xs italic text-neutral-700">
            <span className="font-medium">Alasan:</span> {item.reason}
          </p>
        </div>

        {/* Resolved meta (approved/rejected/cancelled) */}
        {item.status === "approved" ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-success-700">
            <CheckCircle2 className="size-3.5" />
            <span>
              Approved{" "}
              {item.resolverName ? `oleh ${item.resolverName}` : ""}
              {item.resolvedAt ? ` · ${formatIndonesianDateTime(item.resolvedAt)}` : ""}
            </span>
            <JournalShiftIndicator
              journal={item.journalStatus}
              shift={item.shiftCorrectionStatus}
            />
          </div>
        ) : null}
        {item.status === "rejected" ? (
          <p className="flex items-center gap-1.5 text-[11px] text-danger-700">
            <XCircle className="size-3.5" />
            Ditolak: {item.rejectedReason ?? "—"}
          </p>
        ) : null}
        {item.status === "cancelled" ? (
          <p className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            <Ban className="size-3.5" />
            Dibatalkan oleh requester
          </p>
        ) : null}
        {item.status === "expired" ? (
          <p className="flex items-center gap-1.5 text-[11px] text-warning-700">
            <AlertTriangle className="size-3.5" />
            Kadaluarsa — minta requester ajukan ulang
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: UnifiedApprovalItem["status"] }) {
  const map: Record<
    UnifiedApprovalItem["status"],
    { label: string; variant: "info" | "success" | "danger" | "neutral" | "warning" }
  > = {
    pending: { label: "Pending", variant: "info" },
    approved: { label: "Approved", variant: "success" },
    rejected: { label: "Ditolak", variant: "danger" },
    cancelled: { label: "Dibatalkan", variant: "neutral" },
    expired: { label: "Kadaluarsa", variant: "warning" },
  };
  const cfg = map[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function JournalShiftIndicator({
  journal,
  shift,
}: {
  journal: UnifiedApprovalItem["journalStatus"];
  shift: UnifiedApprovalItem["shiftCorrectionStatus"];
}) {
  if (journal === "n/a" && shift === "n/a") return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-success-200 bg-white px-1.5 py-0.5">
      {shift === "applied" ? (
        <span className="inline-flex items-center gap-0.5 text-success-700">
          <CheckCircle2 className="size-3" /> Shift
        </span>
      ) : shift === "pending" ? (
        <span className="inline-flex items-center gap-0.5 text-warning-700">
          <Clock className="size-3" /> Shift
        </span>
      ) : null}
      {journal === "posted" ? (
        <span className="inline-flex items-center gap-0.5 text-success-700">
          <CheckCircle2 className="size-3" /> Jurnal
        </span>
      ) : journal === "pending" ? (
        <span className="inline-flex items-center gap-0.5 text-warning-700">
          <Clock className="size-3" /> Jurnal
        </span>
      ) : null}
    </span>
  );
}
