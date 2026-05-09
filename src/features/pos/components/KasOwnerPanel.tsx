"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Landmark,
  Plus,
  Wallet,
} from "lucide-react";
import { Button, Skeleton } from "@/components/ui";
import {
  fetchCashDepositDashboard,
  fetchCashDeposits,
} from "@/features/finance/actions";
import type { CashDeposit } from "@/features/finance/types";
import { CashDepositModal } from "@/features/admin/sections/finance/CashDepositModal";
import { VerifyDepositModal } from "@/features/admin/sections/finance/VerifyDepositModal";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDate } from "@/lib/date";
import { cn } from "@/lib/utils";

interface Props {
  viewerRole: Role;
}

type DepositRow = CashDeposit & {
  depositorName: string | null;
  verifierName: string | null;
};

/**
 * Sesi AE-8 — POS Kas tab untuk owner + manager + supervisor.
 *
 * Owner / manager yang dateng ke outlet bisa langsung review pending
 * deposits + verify + catat setoran on-the-spot tanpa harus buka
 * backoffice di laptop.
 *
 * Layout (mobile-first karena tablet POS):
 *   - 4 stat cards di atas
 *   - Pending deposits queue (card list dengan quick verify)
 *   - Catat Setoran Manual button
 *   - Link ke Backoffice untuk full history
 */
export function KasOwnerPanel({ viewerRole }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DepositRow | null>(null);
  const [verifying, setVerifying] = useState<DepositRow | null>(null);
  const queryClient = useQueryClient();

  const canCreate = hasPermission(viewerRole, "cash_deposit.create");
  const canVerify = hasPermission(viewerRole, "cash_deposit.verify");

  // Sesi AE-13 — TanStack Query share cache dengan SetoranTunaiSection di
  // backoffice. Owner switching POS Kas tab ↔ Backoffice Setoran tidak
  // refetch (cache hit kalau staleTime belum expire).
  const dashboardQuery = useQuery({
    queryKey: ["finance", "deposit-dashboard"],
    queryFn: async () => {
      const res = await fetchCashDepositDashboard();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });
  const pendingQuery = useQuery({
    queryKey: ["finance", "deposits", "pending"],
    queryFn: async () => {
      const res = await fetchCashDeposits({
        status: "pending_verification",
        limit: 50,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data.rows as DepositRow[];
    },
    staleTime: 15 * 1000,
  });
  const dashboard = dashboardQuery.data ?? null;
  const pending = pendingQuery.data ?? [];
  const loading = dashboardQuery.isLoading || pendingQuery.isLoading;

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposit-dashboard"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposits", "pending"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposits", "list"],
    });
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto p-4 touch:p-3"
      style={{ overscrollBehavior: "contain" }}
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-mahakan-green-900 touch:text-lg">
            <Landmark className="size-5" aria-hidden /> Kas & Setoran
          </h2>
          <p className="text-xs text-neutral-600">
            Cek kas tersedia, verify setoran pending, catat setoran manual.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)} size="lg">
            <Plus className="size-4" aria-hidden /> Catat Setoran
          </Button>
        ) : null}
      </header>

      {/* Stat cards */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 touch:gap-2">
        {loading || !dashboard ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </>
        ) : (
          <>
            <MiniStat
              Icon={Wallet}
              label="Kas Tersedia"
              value={formatRupiah(dashboard.cashOnHand)}
              accent={dashboard.isOverThreshold ? "warning" : "default"}
            />
            <MiniStat
              Icon={ArrowRight}
              label="Belum Disetor"
              value={formatRupiah(dashboard.outstandingToDeposit)}
              accent={
                dashboard.outstandingToDeposit > 0 ? "warning" : "success"
              }
            />
            <MiniStat
              Icon={CheckCircle2}
              label="Verified Bulan Ini"
              value={formatRupiah(dashboard.totalDepositedThisMonth)}
              accent="success"
            />
            <MiniStat
              Icon={ClipboardList}
              label="Pending"
              value={String(dashboard.pendingCount)}
              sub={
                dashboard.pendingCount > 0
                  ? `Total ${formatRupiah(dashboard.pendingTotal)}`
                  : "Tidak ada antrian"
              }
              accent={dashboard.pendingCount > 0 ? "warning" : "default"}
            />
          </>
        )}
      </div>

      {/* Pending list */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-600">
          Antrian Verifikasi
        </h3>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : pending.length === 0 ? (
          <div className="rounded-md border border-neutral-200 bg-mahakan-green-50 p-4 text-center text-sm text-mahakan-green-900">
            <CheckCircle2
              className="mx-auto mb-1 size-5 text-mahakan-green-700"
              aria-hidden
            />
            Tidak ada setoran pending. Semua sudah diverifikasi.
          </div>
        ) : (
          pending.map((r) => {
            const noPhoto = !r.photoUrl;
            return (
              <div
                key={r.id}
                className={cn(
                  "rounded-lg border bg-white p-3 touch:p-2",
                  noPhoto
                    ? "border-warning-300 bg-warning-50"
                    : "border-neutral-200",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <strong className="font-mono text-base text-neutral-900 touch:text-sm">
                        {formatRupiah(r.amount)}
                      </strong>
                      <span className="text-xs text-neutral-700">
                        → {r.bankDestination}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-600">
                      {formatIndonesianDate(r.depositDate)} ·{" "}
                      {r.depositorName ?? "—"}
                    </p>
                    {noPhoto ? (
                      <p className="inline-flex items-center gap-1 rounded-full bg-warning-200 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700">
                        <AlertTriangle className="size-3" aria-hidden />
                        Foto belum di-upload
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.photoUrl ? (
                      <a
                        href={r.photoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-mahakan-green-700 px-2 text-xs font-medium text-mahakan-green-900 hover:bg-mahakan-green-50 touch:h-10"
                      >
                        Bukti
                      </a>
                    ) : null}
                    {canCreate ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(r)}
                        className="touch:!h-10"
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canVerify ? (
                      <Button
                        size="sm"
                        onClick={() => setVerifying(r)}
                        disabled={noPhoto}
                        title={
                          noPhoto
                            ? "Upload foto dulu lewat Edit"
                            : "Verifikasi"
                        }
                        className="touch:!h-10"
                      >
                        Verify
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      <footer className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
        <p className="flex items-center gap-1.5">
          <ExternalLink className="size-3.5" aria-hidden /> Riwayat lengkap +
          daily roll-up tersedia di <strong>Back Office → Setoran Tunai</strong>
          .
        </p>
      </footer>

      <CashDepositModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
      <CashDepositModal
        open={editing !== null}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
      <VerifyDepositModal
        open={verifying !== null}
        deposit={verifying}
        onClose={() => setVerifying(null)}
        onChanged={() => {
          setVerifying(null);
          refresh();
        }}
      />
    </div>
  );
}

function MiniStat({
  Icon,
  label,
  value,
  sub,
  accent,
}: {
  Icon: typeof Wallet;
  label: string;
  value: string;
  sub?: string;
  accent: "default" | "warning" | "success";
}) {
  const accentClasses = {
    default: "border-neutral-200 bg-white",
    warning: "border-warning-300 bg-warning-100",
    success: "border-mahakan-green-200 bg-mahakan-green-50",
  }[accent];
  const iconColor = {
    default: "text-neutral-500",
    warning: "text-warning-500",
    success: "text-mahakan-green-700",
  }[accent];

  return (
    <div className={cn("rounded-lg border p-3 touch:p-2", accentClasses)}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
        <Icon className={cn("size-3.5", iconColor)} aria-hidden />
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-bold tabular-nums text-neutral-900 touch:text-base">
        {value}
      </div>
      {sub ? (
        <p className="mt-0.5 text-[10px] text-neutral-600">{sub}</p>
      ) : null}
    </div>
  );
}
