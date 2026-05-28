"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Heart,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Button,
  EmptyCard,
  Skeleton,
} from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import { listUnifiedApprovals } from "@/features/approvals/queries";
import {
  approvalQueueSummaryKey,
  useApprovalsSummary,
} from "@/features/approvals/useApprovalsSummary";
import { isOk } from "@/features/approval-codes/types";
import type {
  ApprovalKind,
  UnifiedApprovalItem,
} from "@/features/approvals";
import { ApprovalCard } from "./approvals/ApprovalCard";
import {
  ApprovalActionModal,
  type ApprovalActionMode,
} from "./approvals/ApprovalActionModal";
import { ComplimentHistoryPanel } from "./approvals/ComplimentHistoryPanel";

type StatusFilterKey =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "all";

const STATUS_FILTERS: Array<{
  key: StatusFilterKey;
  label: string;
}> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Ditolak" },
  { key: "cancelled", label: "Dibatalkan" },
  { key: "all", label: "Semua" },
];

const KIND_FILTERS: Array<{
  key: ApprovalKind | "all";
  label: string;
}> = [
  { key: "all", label: "Semua Jenis" },
  { key: "void", label: "Void" },
  { key: "refund", label: "Refund" },
  { key: "correction", label: "Koreksi Trx" },
  { key: "rebalance", label: "Rebalance" },
  { key: "entry_change", label: "Edit Catatan" },
];

const SUMMARY_CHIPS: Array<{
  key: keyof NonNullable<ReturnType<typeof useApprovalsSummary>["data"]>["byKind"];
  label: string;
  badge: "info" | "warning" | "danger" | "neutral";
}> = [
  { key: "void", label: "Void", badge: "danger" },
  { key: "refund", label: "Refund", badge: "warning" },
  { key: "correction", label: "Koreksi", badge: "warning" },
  { key: "rebalance", label: "Rebalance", badge: "info" },
  { key: "entry_change", label: "Edit Catatan", badge: "neutral" },
];

export function ApprovalsSection() {
  const { session } = useSession();
  const role = session?.user.role ?? "staff";
  const userId = session?.user.id ?? "";
  const isOwner = role === "owner";
  const canView = hasPermission(role, "approval_code.view");
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("pending");
  const [kindFilter, setKindFilter] = useState<ApprovalKind | "all">("all");
  const [showCompliment, setShowCompliment] = useState(false);

  const [actionTarget, setActionTarget] = useState<UnifiedApprovalItem | null>(
    null,
  );
  const [actionMode, setActionMode] = useState<ApprovalActionMode | null>(null);

  /* Ticking clock untuk live-age. Update tiap 60s. */
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const summary = useApprovalsSummary(canView);

  const listQuery = useQuery({
    queryKey: ["approvals", "list", statusFilter],
    queryFn: async () => {
      const res = await listUnifiedApprovals({
        status: statusFilter,
        limit: 100,
      });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    enabled: canView,
    staleTime: 20 * 1000,
    refetchOnWindowFocus: true,
  });

  const items = useMemo(() => {
    const data = listQuery.data ?? [];
    if (kindFilter === "all") return data;
    return data.filter((it) => it.kind === kindFilter);
  }, [listQuery.data, kindFilter]);

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: approvalQueueSummaryKey });
  }

  if (!canView) {
    return (
      <div className="space-y-4 p-6">
        <header>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Pusat Persetujuan
          </h1>
        </header>
        <EmptyCard
          icon={ShieldCheck}
          title="Tidak punya akses"
          description="Hanya owner / manager / supervisor yang bisa lihat queue approval."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <ShieldCheck className="size-7 text-mahakan-green-700" />
            Pusat Persetujuan
          </h1>
          <p className="text-sm text-neutral-700">
            Antrian void, refund, koreksi transaksi, rebalance shift, dan
            edit catatan dalam satu tempat.{" "}
            {isOwner ? (
              <span className="font-medium text-mahakan-green-800">
                Owner bisa approve langsung tanpa kode.
              </span>
            ) : (
              <span>
                Manager/Supervisor: minta kode 6-digit ke Owner via WA, lalu
                Input Kode.
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={listQuery.isFetching}
        >
          <RefreshCw
            className={cn("size-4", listQuery.isFetching && "animate-spin")}
          />
          Refresh
        </Button>
      </header>

      {/* Summary chips (per-kind pending count) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {SUMMARY_CHIPS.map((chip) => {
          const count = summary.data?.byKind[chip.key] ?? 0;
          const isActive = kindFilter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() =>
                setKindFilter(isActive ? "all" : (chip.key as ApprovalKind))
              }
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg border bg-white p-3 text-left transition-colors",
                isActive
                  ? "border-mahakan-green-700 ring-2 ring-mahakan-green-200"
                  : "border-neutral-200 hover:border-neutral-300",
                count === 0 && "opacity-60",
              )}
              aria-pressed={isActive}
            >
              <div>
                <p className="text-xs text-neutral-500">{chip.label}</p>
                <p
                  className={cn(
                    "text-2xl font-bold leading-tight",
                    count > 0
                      ? chip.badge === "danger"
                        ? "text-danger-500"
                        : chip.badge === "warning"
                          ? "text-warning-700"
                          : chip.badge === "info"
                            ? "text-info-700"
                            : "text-neutral-700"
                      : "text-neutral-400",
                  )}
                >
                  {count}
                </p>
              </div>
              <div
                className={cn(
                  "rounded-full p-2",
                  chip.badge === "danger"
                    ? "bg-danger-100 text-danger-500"
                    : chip.badge === "warning"
                      ? "bg-warning-100 text-warning-700"
                      : chip.badge === "info"
                        ? "bg-info-100 text-info-700"
                        : "bg-neutral-100 text-neutral-700",
                )}
              >
                <ChipIcon kind={chip.key as ApprovalKind} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map((f) => {
            const showCount =
              f.key === "pending" && summary.data
                ? summary.data.total
                : null;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  statusFilter === f.key
                    ? "bg-mahakan-green-700 text-white"
                    : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100",
                )}
              >
                {f.label}
                {showCount !== null && showCount > 0 ? (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                      statusFilter === f.key
                        ? "bg-white/20 text-white"
                        : "bg-warning-500 text-white",
                    )}
                  >
                    {showCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setKindFilter(f.key as ApprovalKind | "all")}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                kindFilter === f.key
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-200 text-neutral-600 hover:bg-neutral-100",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyCard
          icon={CheckCircle2}
          title={
            statusFilter === "pending"
              ? "Tidak ada pending"
              : `Belum ada entry ${STATUS_FILTERS.find((s) => s.key === statusFilter)?.label.toLowerCase()}`
          }
          description={
            statusFilter === "pending"
              ? "Semua pengajuan sudah ter-proses. Mantap!"
              : "Coba ubah filter status di atas."
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isSubmitter = item.requesterId === userId;
            const isPending = item.status === "pending";
            const canCodeApprove =
              item.kind === "rebalance" ||
              item.kind === "correction" ||
              item.kind === "entry_change";

            // Action availability:
            // - Owner: direct + (kode kalau berlaku) + reject (non-submitter) + cancel (any pending)
            // - Manager/Supervisor: kode (kalau bukan submitter) + reject (non-submitter)
            // - Submitter: cancel + kode (kalau ada — submitter dapat kode dari owner via WA)
            const onDirectApprove =
              isOwner && isPending && item.canDirectApprove
                ? () => {
                    setActionTarget(item);
                    setActionMode("direct");
                  }
                : undefined;
            const onApproveWithCode =
              isPending && canCodeApprove
                ? () => {
                    setActionTarget(item);
                    setActionMode("code");
                  }
                : undefined;
            const onReject =
              isPending && !isSubmitter && (isOwner || role === "manager")
                ? () => {
                    setActionTarget(item);
                    setActionMode("reject");
                  }
                : undefined;
            const onCancel =
              isPending && (isSubmitter || isOwner)
                ? () => {
                    setActionTarget(item);
                    setActionMode("cancel");
                  }
                : undefined;

            return (
              <ApprovalCard
                key={item.key}
                item={item}
                nowMs={nowMs}
                isSubmitter={isSubmitter}
                onDirectApprove={onDirectApprove}
                onApproveWithCode={onApproveWithCode}
                onReject={onReject}
                onCancel={onCancel}
              />
            );
          })}
        </div>
      )}

      {/* Komplimen riwayat — collapsible info section */}
      <div>
        <button
          type="button"
          onClick={() => setShowCompliment((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-4 py-3 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          aria-expanded={showCompliment}
        >
          <span className="flex items-center gap-2">
            <Heart className="size-4 text-rose-500" />
            Riwayat Komplimen (info-only, tidak butuh approval)
          </span>
          {showCompliment ? (
            <ChevronUp className="size-4 text-neutral-500" />
          ) : (
            <ChevronDown className="size-4 text-neutral-500" />
          )}
        </button>
        {showCompliment ? (
          <div className="mt-2">
            <ComplimentHistoryPanel />
          </div>
        ) : null}
      </div>

      <ApprovalActionModal
        target={actionTarget}
        mode={actionMode}
        onClose={() => {
          setActionTarget(null);
          setActionMode(null);
        }}
        onChanged={() => {
          setActionTarget(null);
          setActionMode(null);
          refreshAll();
        }}
      />
    </div>
  );
}

function ChipIcon({ kind }: { kind: ApprovalKind }) {
  if (kind === "void") return <Ban className="size-5" />;
  if (kind === "refund") return <RefreshCw className="size-5" />;
  if (kind === "correction") return <KeyRound className="size-5" />;
  if (kind === "rebalance") return <ShieldCheck className="size-5" />;
  return <XCircle className="size-5" />;
}
