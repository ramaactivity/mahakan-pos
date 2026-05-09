"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Landmark,
  Plus,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button, Skeleton } from "@/components/ui";
import {
  fetchCashDepositDashboard,
  fetchCashDeposits,
} from "@/features/finance/actions";
import type {
  CashDailyRollup,
  CashDeposit,
  CashDepositDashboard,
} from "@/features/finance/types";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { CashDepositModal } from "./finance/CashDepositModal";
import { VerifyDepositModal } from "./finance/VerifyDepositModal";
import { SetoranTunaiView } from "./finance/SetoranTunaiView";

// Sesi AE-13 — shared cache key untuk dashboard. Dipakai di SetoranTunai
// section + KasOwnerPanel + VerifyDepositModal supaya satu fetch share
// across components (TanStack Query dedup).
const DEPOSIT_DASHBOARD_KEY = ["finance", "deposit-dashboard"] as const;
const DEPOSIT_PENDING_KEY = ["finance", "deposits", "pending"] as const;

type Tab = "riwayat" | "daftar" | "pending";

interface Props {
  viewerRole: Role;
}

type DepositRow = CashDeposit & {
  depositorName: string | null;
  verifierName: string | null;
};

/**
 * Sesi AE-8 — top-level Setoran Tunai module untuk owner + manager.
 *
 * Menggantikan sub-tab "deposits" di FinanceSection. Tujuan: transparansi
 * cashflow harian + anti-fraud verifikasi setoran. Mirror pattern
 * spreadsheet DAILY CASHIER REPORT yang owner biasa pake.
 *
 * Layout:
 *   - Header: 4 stat cards (Cash on Hand / Outstanding / Last Verified / Pending)
 *   - 3 inner tabs:
 *     - Riwayat Harian (default): daily roll-up 30 hari mirror spreadsheet
 *     - Daftar Setoran: full table dari SetoranTunaiView (existing)
 *     - Pending: queue untuk owner verify cepat
 *
 * Foto bukti wajib at verify (anti-fraud, sesi AE-8 actions enforcement).
 * Dashboard data via fetchCashDepositDashboard single aggregate query.
 */
export function SetoranTunaiSection({ viewerRole }: Props) {
  const [tab, setTab] = useState<Tab>("riwayat");
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const canCreate = hasPermission(viewerRole, "cash_deposit.create");

  // Sesi AE-13 — TanStack Query cache. Dashboard cached 30 detik —
  // switching tab di-dalam Setoran Tunai = instant (cached), bukan re-fetch.
  const dashboardQuery = useQuery({
    queryKey: DEPOSIT_DASHBOARD_KEY,
    queryFn: async () => {
      const res = await fetchCashDepositDashboard();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });
  const dashboard = dashboardQuery.data ?? null;
  const loadingDashboard = dashboardQuery.isLoading;

  function handleSaved() {
    setCreateOpen(false);
    void queryClient.invalidateQueries({ queryKey: DEPOSIT_DASHBOARD_KEY });
    void queryClient.invalidateQueries({ queryKey: DEPOSIT_PENDING_KEY });
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposits", "list"],
    });
  }

  function handleChanged() {
    void queryClient.invalidateQueries({ queryKey: DEPOSIT_DASHBOARD_KEY });
    void queryClient.invalidateQueries({ queryKey: DEPOSIT_PENDING_KEY });
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposits", "list"],
    });
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Landmark className="size-6" aria-hidden /> Setoran Tunai
          </h1>
          <p className="text-sm text-neutral-600">
            Tracking pergerakan kas dari hari ke hari, validasi setoran
            owner, anti-fraud foto bukti.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)} size="lg">
            <Plus className="size-4" aria-hidden /> Catat Setoran
          </Button>
        ) : null}
      </header>

      {/* ============ Anti-fraud banners (sesi AE-10) ============ */}
      <AntiFraudBanners dashboard={dashboard} onSeePending={() => setTab("pending")} />

      {/* ============ Dashboard cards ============ */}
      <CashOnHandCards
        dashboard={dashboard}
        loading={loadingDashboard}
      />

      {/* ============ Inner tabs ============ */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        <TabButton
          active={tab === "riwayat"}
          onClick={() => setTab("riwayat")}
        >
          Riwayat Harian
        </TabButton>
        <TabButton
          active={tab === "daftar"}
          onClick={() => setTab("daftar")}
        >
          Daftar Setoran
        </TabButton>
        <TabButton
          active={tab === "pending"}
          onClick={() => setTab("pending")}
        >
          Pending
          {dashboard && dashboard.pendingCount > 0 ? (
            <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning-500 px-1.5 text-[10px] font-bold text-white">
              {dashboard.pendingCount}
            </span>
          ) : null}
        </TabButton>
      </div>

      <div>
        {tab === "riwayat" ? (
          <DailyRollupTable
            rows={dashboard?.last30DaysFlow ?? []}
            threshold={dashboard?.thresholdIdr ?? 5_000_000}
            loading={loadingDashboard}
          />
        ) : tab === "daftar" ? (
          <SetoranTunaiView viewerRole={viewerRole} />
        ) : (
          <PendingDepositsList
            viewerRole={viewerRole}
            onChanged={handleChanged}
          />
        )}
      </div>

      <CashDepositModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}

// ============================================================
// Anti-fraud banners (sesi AE-10) — surface time gap + negative cash
// ============================================================

function AntiFraudBanners({
  dashboard,
  onSeePending,
}: {
  dashboard: CashDepositDashboard | null;
  onSeePending: () => void;
}) {
  if (!dashboard) return null;
  const banners: React.ReactElement[] = [];

  if (dashboard.isCashNegative) {
    banners.push(
      <div
        key="negative-cash"
        className="flex items-start gap-3 rounded-xl border-2 border-danger-500 bg-danger-100 p-4 text-danger-700"
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="flex-1 space-y-0.5">
          <p className="text-sm font-bold">Kas tersedia minus</p>
          <p className="text-xs">
            Sistem mendeteksi cashOnHand{" "}
            <strong className="font-mono">
              {formatRupiah(dashboard.cashOnHand)}
            </strong>{" "}
            (negatif). Kemungkinan ada deposit yang seharusnya rejected
            atau cash leak ga ke-record. Cek pending list + audit log
            sebelum verify setoran baru.
          </p>
        </div>
      </div>,
    );
  }

  if (
    dashboard.oldestPendingDays !== null &&
    dashboard.oldestPendingDays > 3
  ) {
    banners.push(
      <div
        key="time-gap"
        className="flex items-start gap-3 rounded-xl border-2 border-warning-500 bg-warning-100 p-4 text-warning-700"
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="flex-1 space-y-0.5">
          <p className="text-sm font-bold">
            Setoran pending {dashboard.oldestPendingDays} hari belum verified
          </p>
          <p className="text-xs">
            Pending tertua sudah {dashboard.oldestPendingDays} hari menunggu
            owner approve. Total {dashboard.pendingCount} setoran (
            {formatRupiah(dashboard.pendingTotal)}). Verify atau reject
            supaya kas tracking tetap accurate.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onSeePending}>
          Buka Pending
        </Button>
      </div>,
    );
  }

  if (banners.length === 0) return null;
  return <div className="space-y-2">{banners}</div>;
}

// ============================================================
// Stat cards (4): Cash on Hand / Outstanding / Last Verified / Pending
// ============================================================

function CashOnHandCards({
  dashboard,
  loading,
}: {
  dashboard: CashDepositDashboard | null;
  loading: boolean;
}) {
  if (loading || !dashboard) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  const overThreshold = dashboard.isOverThreshold;
  const hasPending = dashboard.pendingCount > 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        Icon={Wallet}
        label="Kas Tersedia di Outlet"
        value={formatRupiah(dashboard.cashOnHand)}
        sub={
          overThreshold
            ? `⚠ Lewat threshold ${formatRupiah(dashboard.thresholdIdr)}`
            : "Sisa kas fisik (closed shifts)"
        }
        accent={overThreshold ? "warning" : "default"}
      />
      <StatCard
        Icon={ArrowRight}
        label="Belum Disetor"
        value={formatRupiah(dashboard.outstandingToDeposit)}
        sub={
          dashboard.outstandingToDeposit > 0
            ? "Kas tahan — perlu setor ke bank/owner"
            : "Sudah disetor semua"
        }
        accent={dashboard.outstandingToDeposit > 0 ? "warning" : "success"}
      />
      <StatCard
        Icon={CheckCircle2}
        label="Setoran Verified Terakhir"
        value={
          dashboard.lastVerified
            ? formatRupiah(dashboard.lastVerified.amount)
            : "—"
        }
        sub={
          dashboard.lastVerified
            ? `${formatIndonesianDate(dashboard.lastVerified.depositDate)} · ${dashboard.lastVerified.bankDestination}`
            : "Belum ada setoran verified"
        }
        accent="success"
      />
      <StatCard
        Icon={ClipboardList}
        label="Pending Verifikasi"
        value={String(dashboard.pendingCount)}
        sub={
          hasPending
            ? `Total ${formatRupiah(dashboard.pendingTotal)} menunggu approve`
            : "Tidak ada antrian"
        }
        accent={hasPending ? "warning" : "default"}
      />
    </div>
  );
}

function StatCard({
  Icon,
  label,
  value,
  sub,
  accent,
}: {
  Icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
  accent: "default" | "warning" | "success" | "danger";
}) {
  const accentClasses = {
    default: "border-neutral-200 bg-white",
    warning: "border-warning-300 bg-warning-100",
    success: "border-mahakan-green-200 bg-mahakan-green-50",
    danger: "border-danger-300 bg-danger-100",
  }[accent];
  const iconColor = {
    default: "text-neutral-500",
    warning: "text-warning-500",
    success: "text-mahakan-green-700",
    danger: "text-danger-500",
  }[accent];

  return (
    <div className={cn("rounded-xl border p-4", accentClasses)}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
        <Icon className={cn("size-4", iconColor)} aria-hidden />
        {label}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-neutral-900">
        {value}
      </div>
      <p className="mt-0.5 text-[11px] text-neutral-600">{sub}</p>
    </div>
  );
}

// ============================================================
// Daily rollup table — mirror DAILY CASHIER REPORT spreadsheet
// ============================================================

function DailyRollupTable({
  rows,
  threshold,
  loading,
}: {
  rows: CashDailyRollup[];
  threshold: number;
  loading: boolean;
}) {
  // Hooks WAJIB before any early return.
  const monthSummary = useMonthSummary(rows);
  // Show oldest first by default, but reverse for display (newest top).
  const ordered = useMemo(() => [...rows].reverse(), [rows]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
        Belum ada data 30 hari terakhir.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3 rounded-md border border-mahakan-green-200 bg-mahakan-green-50 p-3 text-sm">
        <span className="flex items-center gap-1.5 text-mahakan-green-900">
          <TrendingUp className="size-4" aria-hidden />
          <strong>30 hari terakhir</strong>
        </span>
        <span className="text-neutral-700">
          Penjualan tunai{" "}
          <strong className="font-mono">
            {formatRupiah(monthSummary.totalCashSales)}
          </strong>
        </span>
        <span className="text-neutral-700">
          Pengeluaran{" "}
          <strong className="font-mono">
            {formatRupiah(monthSummary.totalExpenses)}
          </strong>
        </span>
        <span className="text-neutral-700">
          Setoran verified{" "}
          <strong className="font-mono">
            {formatRupiah(monthSummary.totalDeposits)}
          </strong>
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tanggal</th>
              <th className="px-3 py-2 text-right font-medium">
                Sisa Kemarin
              </th>
              <th className="px-3 py-2 text-right font-medium">+ Kas Tunai</th>
              <th className="px-3 py-2 text-right font-medium">
                − Pengeluaran
              </th>
              <th className="px-3 py-2 text-right font-medium">− Setoran</th>
              <th className="px-3 py-2 text-right font-medium">
                = Sisa Hari Ini
              </th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r) => {
              const status = computeStatus(r.sisaAkhir, threshold);
              const hasActivity =
                r.cashSales > 0 ||
                r.cashExpenses > 0 ||
                r.depositsVerified > 0 ||
                r.depositsPending > 0 ||
                r.shiftCount > 0;
              return (
                <tr
                  key={r.date}
                  className={cn(
                    "border-t border-neutral-100",
                    !hasActivity ? "bg-neutral-50/60 text-neutral-500" : "",
                  )}
                >
                  <td className="px-3 py-2 font-medium">
                    {formatIndonesianDate(r.date)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.sisaAwal > 0 ? formatRupiah(r.sisaAwal) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-mahakan-green-800">
                    {r.cashSales > 0 ? formatRupiah(r.cashSales) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-danger-600">
                    {r.cashExpenses > 0 ? formatRupiah(r.cashExpenses) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="font-mono tabular-nums text-mahakan-green-800">
                      {r.depositsVerified > 0
                        ? formatRupiah(r.depositsVerified)
                        : "—"}
                    </div>
                    {r.depositsPending > 0 ? (
                      <div className="text-[10px] text-warning-500">
                        +{formatRupiah(r.depositsPending)} pending
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-bold tabular-nums text-neutral-900">
                    {formatRupiah(r.sisaAkhir)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function useMonthSummary(rows: CashDailyRollup[]) {
  return useMemo(() => {
    const totalCashSales = rows.reduce((s, r) => s + r.cashSales, 0);
    const totalExpenses = rows.reduce((s, r) => s + r.cashExpenses, 0);
    const totalDeposits = rows.reduce((s, r) => s + r.depositsVerified, 0);
    return { totalCashSales, totalExpenses, totalDeposits };
  }, [rows]);
}

function computeStatus(
  sisaAkhir: number,
  threshold: number,
): "ok" | "tahan" | "negative" {
  if (sisaAkhir < 0) return "negative";
  if (sisaAkhir > threshold) return "tahan";
  return "ok";
}

function StatusBadge({ status }: { status: "ok" | "tahan" | "negative" }) {
  const map = {
    ok: {
      label: "Pas",
      className: "bg-mahakan-green-100 text-mahakan-green-900",
      Icon: CheckCircle2,
    },
    tahan: {
      label: "Kas tahan",
      className: "bg-warning-100 text-warning-700",
      Icon: AlertTriangle,
    },
    negative: {
      label: "Minus",
      className: "bg-danger-100 text-danger-700",
      Icon: AlertTriangle,
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        map.className,
      )}
    >
      <map.Icon className="size-3" aria-hidden /> {map.label}
    </span>
  );
}

// ============================================================
// Pending list — owner-focused queue
// ============================================================

function PendingDepositsList({
  viewerRole,
  onChanged,
}: {
  viewerRole: Role;
  onChanged: () => void;
}) {
  const [verifying, setVerifying] = useState<DepositRow | null>(null);
  const [editing, setEditing] = useState<DepositRow | null>(null);

  const canVerify = hasPermission(viewerRole, "cash_deposit.verify");
  const canEdit = hasPermission(viewerRole, "cash_deposit.create");

  const pendingQuery = useQuery({
    queryKey: DEPOSIT_PENDING_KEY,
    queryFn: async () => {
      const res = await fetchCashDeposits({
        status: "pending_verification",
        limit: 100,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data.rows;
    },
    staleTime: 15 * 1000,
  });
  const rows = pendingQuery.data ?? [];
  const loading = pendingQuery.isLoading;

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 bg-mahakan-green-50 p-6 text-center text-sm text-mahakan-green-900">
        <CheckCircle2
          className="mx-auto mb-2 size-6 text-mahakan-green-700"
          aria-hidden
        />
        Tidak ada antrian setoran. Semua sudah diverifikasi.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const noPhoto = !r.photoUrl;
        return (
          <div
            key={r.id}
            className={cn(
              "rounded-lg border bg-white p-4",
              noPhoto
                ? "border-warning-300 bg-warning-50"
                : "border-neutral-200",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <strong className="font-mono text-lg text-neutral-900">
                    {formatRupiah(r.amount)}
                  </strong>
                  <span className="text-sm text-neutral-700">
                    → {r.bankDestination}
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  {formatIndonesianDate(r.depositDate)} · setor oleh{" "}
                  <strong>{r.depositorName ?? "—"}</strong>
                </p>
                <p className="text-[11px] text-neutral-500">
                  Periode kas: {formatIndonesianDate(r.coversFromDate)} →{" "}
                  {formatIndonesianDate(r.coversToDate)}
                </p>
                {r.notes ? (
                  <p className="text-[11px] italic text-neutral-600">
                    &ldquo;{r.notes}&rdquo;
                  </p>
                ) : null}
                {noPhoto ? (
                  <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning-200 px-2 py-0.5 text-[10px] font-semibold text-warning-700">
                    <AlertTriangle className="size-3" aria-hidden />
                    Foto bukti belum di-upload — wajib sebelum verify
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {r.photoUrl ? (
                  <a
                    href={r.photoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-mahakan-green-700 px-3 text-sm font-medium text-mahakan-green-900 hover:bg-mahakan-green-50"
                  >
                    Lihat Bukti
                  </a>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(r)}
                  >
                    Edit / Upload Foto
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
                        : "Verifikasi setoran"
                    }
                  >
                    Verifikasi
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      <CashDepositModal
        open={editing !== null}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
      <VerifyDepositModal
        open={verifying !== null}
        deposit={verifying}
        onClose={() => setVerifying(null)}
        onChanged={() => {
          setVerifying(null);
          onChanged();
        }}
      />
    </div>
  );
}

// ============================================================
// Tab button
// ============================================================

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-1 px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "text-mahakan-green-900"
          : "text-neutral-600 hover:text-neutral-900",
      )}
    >
      {children}
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-0.5 bg-mahakan-green-700" />
      ) : null}
    </button>
  );
}
