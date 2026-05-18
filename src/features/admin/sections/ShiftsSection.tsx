"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, Pencil, Receipt } from "lucide-react";
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
import { PendingRebalancesPanel } from "./shifts/PendingRebalancesPanel";
import { isOk, listShifts, type Shift } from "@/features/shifts";
import { getOwnOutlet } from "@/features/outlets";
import { listUsers, type PublicUser } from "@/features/users";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

/* Sesi AE-62t — variance threshold default kalau outlet belum loaded.
 * Live value di-fetch dari outlet.settings.thresholds.shiftVarianceAlert. */
const DEFAULT_VARIANCE_THRESHOLD = 10_000;

export function ShiftsSection() {
  const [tab, setTab] = useState<"history" | "rebalance">("history");
  const [varianceFilter, setVarianceFilter] = useState<"all" | "flag">("all");
  const [openShift, setOpenShift] = useState<Shift | null>(null);

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
          {tab === "history" ? (
            <>
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
            </>
          ) : null}
        </div>
      </header>

      {/* Sesi AE-62o — tab navigation: History | Rebalancing queue */}
      <div className="flex gap-1 border-b border-neutral-200">
        <button
          type="button"
          onClick={() => setTab("history")}
          className={cn(
            "relative px-4 py-2 text-sm font-medium transition-colors",
            tab === "history"
              ? "text-mahakan-green-900"
              : "text-neutral-600 hover:text-neutral-900",
          )}
        >
          Riwayat Shift
          {tab === "history" ? (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-mahakan-green-700" />
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setTab("rebalance")}
          className={cn(
            "relative inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors",
            tab === "rebalance"
              ? "text-mahakan-green-900"
              : "text-neutral-600 hover:text-neutral-900",
          )}
        >
          <Pencil className="size-4" aria-hidden /> Rebalancing
          {tab === "rebalance" ? (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-mahakan-green-700" />
          ) : null}
        </button>
      </div>

      {tab === "rebalance" ? <PendingRebalancesPanel /> : null}

      {tab === "history" ? (
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
                          <div className="flex justify-end">
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
      ) : null}

      <ShiftDetailModal
        shift={openShift}
        user={openShift ? (userById[openShift.userId] ?? null) : null}
        onClose={() => setOpenShift(null)}
      />
    </div>
  );
}
