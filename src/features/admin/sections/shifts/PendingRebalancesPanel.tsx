"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  approveShiftRebalance,
  cancelShiftRebalance,
  listShiftRebalances,
  rejectShiftRebalance,
  type ShiftRebalance,
} from "@/features/shifts/rebalance-actions";
import { isOk } from "@/features/shifts/types";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

type RebalanceRow = ShiftRebalance & {
  requesterName: string | null;
  approverName: string | null;
  cashierName: string | null;
  shiftClosedAt: Date | null;
};

const SOURCE_LABEL: Record<string, string> = {
  close_shift: "Dari Close Shift",
  manager_backoffice: "Backoffice Manager",
};

/**
 * Sesi AE-62o — Owner queue untuk approve/reject shift rebalancing requests.
 *
 * Workflow:
 *  1. Tab "Pending" — semua pending requests dengan badge urgent kalau >1h.
 *  2. Click row → modal detail dengan input field code 6-digit.
 *  3. Approve → status='approved' + journal updated otomatis.
 *  4. Reject → status='rejected' dengan reason.
 *
 * History tab: filter ke status approved/rejected/cancelled.
 */
export function PendingRebalancesPanel() {
  const { session } = useSession();
  const role = session?.user.role ?? "staff";
  const canApprove = hasPermission(role, "shift.rebalance.approve");
  const canReject = hasPermission(role, "shift.rebalance.reject");
  const canView = hasPermission(role, "shift.rebalance.view");

  const [filter, setFilter] = useState<
    "pending_approval" | "approved" | "rejected" | "cancelled" | "all"
  >("pending_approval");
  const [rows, setRows] = useState<RebalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionTarget, setActionTarget] = useState<RebalanceRow | null>(null);
  const [actionMode, setActionMode] = useState<"approve" | "reject" | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await listShiftRebalances({ status: filter, limit: 100 });
      if (cancelled) return;
      if (isOk(res)) setRows(res.data as RebalanceRow[]);
      setLoading(false);
    }
    if (canView) void load();
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey, canView]);

  if (!canView) {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
        Tidak punya akses lihat rebalancing.
      </div>
    );
  }

  const pendingCount = rows.filter(
    (r) => r.status === "pending_approval",
  ).length;

  return (
    <>
      <div className="space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-mahakan-green-900">
              Shift Rebalancing
            </h2>
            <p className="text-xs text-neutral-600">
              Approve / reject permintaan koreksi shift dari kasir/manager.
            </p>
          </div>
          <div className="flex gap-1">
            {(
              [
                { k: "pending_approval", l: "Pending", urgent: pendingCount },
                { k: "approved", l: "Approved" },
                { k: "rejected", l: "Rejected" },
                { k: "cancelled", l: "Cancelled" },
                { k: "all", l: "Semua" },
              ] as const
            ).map((b) => (
              <button
                key={b.k}
                type="button"
                onClick={() => setFilter(b.k)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  filter === b.k
                    ? "bg-mahakan-green-700 text-white"
                    : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100",
                )}
              >
                {b.l}
                {"urgent" in b && b.urgent && b.urgent > 0 ? (
                  <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning-500 px-1 text-[10px] font-bold text-white">
                    {b.urgent}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyCard
            icon={CheckCircle2}
            title="Tidak ada rebalancing"
            description={
              filter === "pending_approval"
                ? "Semua koreksi sudah selesai diproses."
                : `Belum ada entry dengan status ${filter}.`
            }
          />
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <RebalanceCard
                key={r.id}
                row={r}
                onApprove={
                  canApprove && r.status === "pending_approval"
                    ? () => {
                        setActionTarget(r);
                        setActionMode("approve");
                      }
                    : undefined
                }
                onReject={
                  canReject && r.status === "pending_approval"
                    ? () => {
                        setActionTarget(r);
                        setActionMode("reject");
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <ActionModal
        target={actionTarget}
        mode={actionMode}
        onClose={() => {
          setActionTarget(null);
          setActionMode(null);
        }}
        onChanged={() => {
          setActionTarget(null);
          setActionMode(null);
          setRefreshKey((k) => k + 1);
        }}
      />
    </>
  );
}

function RebalanceCard({
  row,
  onApprove,
  onReject,
}: {
  row: RebalanceRow;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const ageMin = Math.floor(
    (Date.now() - new Date(row.requestedAt).getTime()) / 60_000,
  );
  const isStale = row.status === "pending_approval" && ageMin > 60;

  const changes: Array<{
    label: string;
    from: number;
    to: number;
  }> = [
    {
      label: "Kas Fisik",
      from: row.originalActualCash,
      to: row.correctedActualCash,
    },
  ];
  if (
    row.correctedQrisSettlement != null &&
    row.correctedQrisSettlement !== row.originalQrisSettlement
  ) {
    changes.push({
      label: "QRIS",
      from: row.originalQrisSettlement ?? 0,
      to: row.correctedQrisSettlement,
    });
  }
  if (
    row.correctedEdcSettlement != null &&
    row.correctedEdcSettlement !== row.originalEdcSettlement
  ) {
    changes.push({
      label: "EDC",
      from: row.originalEdcSettlement ?? 0,
      to: row.correctedEdcSettlement,
    });
  }

  return (
    <Card
      className={cn(
        "transition-colors",
        isStale && "border-warning-500/40 bg-warning-100/20",
        row.status === "approved" && "border-success-500/30 bg-success-50/40",
        row.status === "rejected" && "border-danger-500/30 bg-danger-50/40",
        row.status === "cancelled" && "opacity-70",
      )}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-neutral-900">
                {row.cashierName ?? "Kasir"}
              </p>
              <StatusBadge status={row.status} />
              <span className="text-xs text-neutral-500">
                {SOURCE_LABEL[row.source] ?? row.source}
              </span>
              {isStale ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-warning-700">
                  <Clock className="size-3" /> {ageMin}m
                </span>
              ) : null}
            </div>
            <p className="text-xs text-neutral-600">
              Shift tutup{" "}
              {row.shiftClosedAt
                ? formatIndonesianDateTime(row.shiftClosedAt)
                : "—"}{" "}
              · diajukan {formatIndonesianDateTime(row.requestedAt)} oleh{" "}
              {row.requesterName ?? "—"}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {onApprove ? (
              <Button size="sm" onClick={onApprove}>
                <Mail className="size-4" /> Input Kode
              </Button>
            ) : null}
            {onReject ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onReject}
                className="text-danger-500 hover:bg-danger-100"
              >
                Reject
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-1 rounded-md border border-neutral-200 bg-white p-2">
          {changes.map((c) => {
            const diff = c.to - c.from;
            return (
              <div
                key={c.label}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="font-medium text-neutral-700">{c.label}</span>
                <span className="flex items-baseline gap-2 font-mono">
                  <span className="text-neutral-500">
                    {formatRupiah(c.from)}
                  </span>
                  <span className="text-neutral-400">→</span>
                  <span className="font-semibold text-neutral-900">
                    {formatRupiah(c.to)}
                  </span>
                  <span
                    className={cn(
                      "min-w-[80px] text-right text-[11px] font-semibold",
                      diff === 0
                        ? "text-neutral-500"
                        : diff > 0
                          ? "text-mahakan-green-700"
                          : "text-danger-500",
                    )}
                  >
                    {diff >= 0 ? "+" : ""}
                    {formatRupiah(diff)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <p className="rounded-md bg-warning-50 px-2 py-1.5 text-xs italic text-warning-900">
          <strong>Alasan:</strong> {row.reason}
        </p>

        {row.status === "approved" ? (
          <p className="text-[11px] text-success-700">
            ✓ Approved by {row.approverName ?? "Owner"} di{" "}
            {row.approvedAt ? formatIndonesianDateTime(row.approvedAt) : "—"}
            {row.correctedVariance != null
              ? ` · Variance baru: ${row.correctedVariance >= 0 ? "+" : ""}${formatRupiah(row.correctedVariance)}`
              : ""}
          </p>
        ) : null}
        {row.status === "rejected" ? (
          <p className="text-[11px] text-danger-700">
            ✗ Rejected: {row.rejectedReason ?? "—"}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ShiftRebalance["status"] }) {
  const map: Record<
    ShiftRebalance["status"],
    { label: string; variant: "info" | "success" | "danger" | "neutral" }
  > = {
    pending_approval: { label: "Pending", variant: "info" },
    approved: { label: "Approved", variant: "success" },
    rejected: { label: "Rejected", variant: "danger" },
    cancelled: { label: "Cancelled", variant: "neutral" },
  };
  const cfg = map[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function ActionModal({
  target,
  mode,
  onClose,
  onChanged,
}: {
  target: RebalanceRow | null;
  mode: "approve" | "reject" | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target && mode) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setCode("");
      setReason("");
      setError(null);
      setSubmitting(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [target, mode]);

  if (!target || !mode) return null;

  async function onSubmit() {
    if (!target) return;
    setError(null);
    if (mode === "approve") {
      if (!/^\d{6}$/.test(code.trim())) {
        setError("Kode harus 6 digit");
        return;
      }
      setSubmitting(true);
      const res = await approveShiftRebalance({
        rebalanceId: target.id,
        code: code.trim(),
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success("Rebalancing approved + journal updated");
      onChanged();
    } else {
      if (reason.trim().length < 3) {
        setError("Alasan minimal 3 karakter");
        return;
      }
      setSubmitting(true);
      const res = await rejectShiftRebalance({
        rebalanceId: target.id,
        reason: reason.trim(),
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.info("Rebalancing rejected");
      onChanged();
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => undefined : onClose}
      title={mode === "approve" ? "Approve Rebalancing" : "Reject Rebalancing"}
      description={`Shift ${target.cashierName ?? "kasir"} · alasan: ${target.reason}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={submitting}
            variant={mode === "approve" ? "primary" : "destructive"}
          >
            {mode === "approve" ? (
              <>
                <CheckCircle2 className="size-4" /> Approve
              </>
            ) : (
              <>
                <XCircle className="size-4" /> Reject
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {mode === "approve" ? (
          <>
            <p className="text-xs text-neutral-700">
              Masukkan kode 6-digit yang dikirim ke email Owner.
            </p>
            <Input
              autoFocus
              label="Kode Approval"
              placeholder="123456"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
              }
              maxLength={6}
              inputMode="numeric"
              pattern="\d{6}"
            />
            <div className="rounded-md border border-warning-300 bg-warning-100 p-2 text-xs text-warning-700">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong>Approve = irreversible.</strong> Shift fields akan
                  ter-update + journal lama di-reverse + journal baru di-post.
                  Pastikan correction nya benar.
                </span>
              </p>
            </div>
          </>
        ) : (
          <>
            <Input
              autoFocus
              label="Alasan reject (min 3 karakter)"
              placeholder="mis. correction tidak match dengan bukti, atau alasan kurang jelas"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </>
        )}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-300 bg-danger-100 p-2 text-sm font-medium text-danger-700"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
