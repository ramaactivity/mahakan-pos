"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Eye, Receipt, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyCard,
  Skeleton,
} from "@/components/ui";
import { ShiftDetailModal } from "./shifts/ShiftDetailModal";
import { useApprovalsSummary } from "@/features/approvals/useApprovalsSummary";
import { isOk, listShifts, type Shift } from "@/features/shifts";
import { ForceCloseShiftModal } from "./shifts/ForceCloseShiftModal";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { getOwnOutlet } from "@/features/outlets";
import { listUsers, type PublicUser } from "@/features/users";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

/* Sesi AE-62t — variance threshold default kalau outlet belum loaded.
 * Live value di-fetch dari outlet.settings.thresholds.shiftVarianceAlert. */
const DEFAULT_VARIANCE_THRESHOLD = 10_000;

interface ShiftsSectionProps {
  /** Audit POS E2E 2026-06-12 — gate tombol Tutup Paksa (owner only). */
  viewerRole?: Role;
}

export function ShiftsSection({ viewerRole }: ShiftsSectionProps) {
  const [varianceFilter, setVarianceFilter] = useState<"all" | "flag">("all");
  const [openShift, setOpenShift] = useState<Shift | null>(null);
  const [forceCloseTarget, setForceCloseTarget] = useState<Shift | null>(null);
  const canForceClose = viewerRole
    ? hasPermission(viewerRole, "shift.force_close")
    : false;
  /* Sesi AE-160 — Rebalancing & Entry Changes queue dipindah ke Pusat
   * Persetujuan (#approvals). Halaman Shifts kembali fokus ke history. */
  const approvalsSummary = useApprovalsSummary(true);
  const rebalancePending = approvalsSummary.data?.byKind.rebalance ?? 0;

  // Sesi AE-14 — TanStack Query, parallel + cached.
  const shiftsQuery = useQuery({
    queryKey: ["admin", "shifts", "list", { limit: 100 }],
    queryFn: async () => {
      const res = await listShifts({ limit: 100 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data.items;
    },
  });
  const usersQuery = useQuery({
    queryKey: ["admin", "users", "list"],
    queryFn: async () => {
      const res = await listUsers();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data.items;
    },
  });
  /* Sesi AE-62t — fetch outlet untuk pull live variance threshold. Cached
   * sangat lama (settings rarely change), shared dengan section lain. */
  const outletQuery = useQuery({
    queryKey: ["admin", "outlet", "own"],
    queryFn: async () => {
      const res = await getOwnOutlet();
      if (res.success !== true) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const VARIANCE_THRESHOLD =
    outletQuery.data?.settings?.thresholds?.shiftVarianceAlert ??
    DEFAULT_VARIANCE_THRESHOLD;
  const shifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data]);
  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const loading = shiftsQuery.isLoading || usersQuery.isLoading;

  const userById = useMemo(() => {
    const m: Record<string, PublicUser> = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);

  const filteredShifts = useMemo(() => {
    if (varianceFilter === "flag") {
      return shifts.filter(
        (s) => s.variance !== null && Math.abs(s.variance) > VARIANCE_THRESHOLD,
      );
    }
    return shifts;
  }, [shifts, varianceFilter]);

  const flaggedCount = shifts.filter(
    (s) => s.variance !== null && Math.abs(s.variance) > VARIANCE_THRESHOLD,
  ).length;

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Shift History
          </h1>
          <p className="text-sm text-neutral-700">
            Riwayat shift semua kasir.{" "}
            {flaggedCount > 0 ? (
              <span className="font-medium text-danger-500">
                {flaggedCount} shift dengan variance &gt; {formatRupiah(
                  VARIANCE_THRESHOLD,
                )}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={varianceFilter === "all" ? "primary" : "outline"}
            onClick={() => setVarianceFilter("all")}
          >
            Semua ({shifts.length})
          </Button>
          <Button
            size="sm"
            variant={varianceFilter === "flag" ? "primary" : "outline"}
            onClick={() => setVarianceFilter("flag")}
          >
            <AlertTriangle className="size-4" aria-hidden /> Flagged (
            {flaggedCount})
          </Button>
        </div>
      </header>

      {/* Sesi AE-160 — Rebalancing queue dipindah ke Pusat Persetujuan. */}
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined") {
            window.location.hash = "#approvals";
          }
        }}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:bg-neutral-50",
          rebalancePending > 0
            ? "border-warning-300 bg-warning-50/40"
            : "border-neutral-200",
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-full",
              rebalancePending > 0
                ? "bg-warning-100 text-warning-700"
                : "bg-mahakan-green-100 text-mahakan-green-700",
            )}
          >
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Rebalancing & Approval pindah ke{" "}
              <span className="text-mahakan-green-800">Pusat Persetujuan</span>
            </p>
            <p className="text-xs text-neutral-600">
              Semua queue void / refund / koreksi / rebalance / edit catatan
              terpusat di sana.
              {rebalancePending > 0
                ? ` ${rebalancePending} rebalance menunggu approval.`
                : ""}
            </p>
          </div>
        </div>
        <ArrowRight className="size-5 text-neutral-400" />
      </button>

      <Card>
        <CardHeader />
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat shift">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredShifts.length === 0 ? (
            <EmptyCard
              icon={Receipt}
              title="Tidak ada shift yang cocok"
              description="Coba ubah filter tanggal atau status di atas."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">User</th>
                    <th className="px-3 py-2 text-left font-medium">Tutup</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Kas Awal
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Kas Aktual
                    </th>
                    <th className="px-3 py-2 text-right font-medium">QRIS</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Settlement
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Selisih
                    </th>
                    <th className="px-3 py-2 text-center font-medium">
                      Status
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredShifts.map((shift) => {
                    const user = userById[shift.userId];
                    const flagged =
                      shift.variance !== null &&
                      Math.abs(shift.variance) > VARIANCE_THRESHOLD;
                    // Sesi AE-56 — tampilkan QRIS + total settlement aggregator
                    // langsung di list, kasih insight tanpa buka modal detail
                    const sh = shift as Shift & {
                      qrisSettlement?: number | null;
                      edcSettlement?: number | null;
                      gofoodSettlement?: number | null;
                      grabfoodSettlement?: number | null;
                      shopeefoodSettlement?: number | null;
                    };
                    const qris = sh.qrisSettlement ?? null;
                    const settlementTotal =
                      (sh.edcSettlement ?? 0) +
                      (sh.gofoodSettlement ?? 0) +
                      (sh.grabfoodSettlement ?? 0) +
                      (sh.shopeefoodSettlement ?? 0);
                    return (
                      <tr
                        key={shift.id}
                        className={cn(
                          "hover:bg-neutral-50",
                          flagged && "bg-danger-100/30",
                        )}
                      >
                        <td className="px-3 py-3 font-medium text-neutral-900">
                          <div>{user?.name ?? shift.userId}</div>
                          <div className="text-[10px] font-normal text-neutral-500">
                            Buka {formatIndonesianDateTime(shift.openedAt)}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-neutral-700">
                          {shift.closedAt
                            ? formatIndonesianDateTime(shift.closedAt)
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs">
                          {formatRupiah(shift.openingCash)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs">
                          {shift.actualCash !== null
                            ? formatRupiah(shift.actualCash)
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-neutral-700">
                          {qris === null ? "—" : formatRupiah(qris)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-neutral-700">
                          {settlementTotal > 0
                            ? formatRupiah(settlementTotal)
                            : "—"}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-3 text-right font-mono text-xs",
                            shift.variance === null
                              ? "text-neutral-400"
                              : shift.variance === 0
                                ? "text-success-500"
                                : flagged
                                  ? "text-danger-500 font-bold"
                                  : "text-warning-500",
                          )}
                        >
                          {shift.variance !== null
                            ? `${shift.variance >= 0 ? "+" : ""}${formatRupiah(shift.variance)}`
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {shift.status === "open" ? (
                            <Badge variant="success">Open</Badge>
                          ) : (
                            <Badge variant="neutral">Closed</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-1">
                            {/* Audit POS E2E 2026-06-12 — tutup paksa shift
                                nginep dari backoffice (owner). Guard open-bill
                                + approval tetap berlaku di server. */}
                            {canForceClose && shift.status === "open" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setForceCloseTarget(shift)}
                                className="border-danger-300 text-danger-500 hover:bg-danger-50"
                              >
                                Tutup Paksa
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setOpenShift(shift)}
                              aria-label="Lihat detail"
                            >
                              <Eye className="size-4" aria-hidden /> Detail
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ShiftDetailModal
        shift={openShift}
        user={openShift ? (userById[openShift.userId] ?? null) : null}
        onClose={() => setOpenShift(null)}
      />

      <ForceCloseShiftModal
        shift={forceCloseTarget}
        openerName={
          forceCloseTarget
            ? (userById[forceCloseTarget.userId]?.name ?? null)
            : null
        }
        onClose={() => setForceCloseTarget(null)}
        onDone={() => {
          setForceCloseTarget(null);
          void shiftsQuery.refetch();
        }}
      />
    </div>
  );
}
