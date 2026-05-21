"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Clock,
  RefreshCw,
  RotateCcw,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import { listInvestors, isOk as investorsIsOk } from "@/features/investors";
import {
  fetchWithdrawals,
  isOk as withdrawalsIsOk,
  reverseWithdrawal,
  type WithdrawalListRow,
} from "@/features/withdrawals";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WithdrawalModal } from "./WithdrawalModal";

/**
 * Sesi AE-80 — Tab "Saldo & Pencairan".
 *
 * Section 1: List investor dengan saldo dividen > 0 + tombol "Tarik Saldo".
 * Section 2: Riwayat pencairan dengan reverse button.
 *
 * Auto-refresh setelah withdrawal/reverse via React Query invalidation.
 */

interface BalancesTabProps {
  /** Owner-only operations. */
  canManage: boolean;
}

const MIN_WITHDRAWAL = 50_000;

export function BalancesTab({ canManage }: BalancesTabProps) {
  const queryClient = useQueryClient();
  const [withdrawalTarget, setWithdrawalTarget] = useState<{
    id: string;
    name: string;
    balance: number;
  } | null>(null);
  const [reverseTarget, setReverseTarget] =
    useState<WithdrawalListRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const investorsQuery = useQuery({
    queryKey: ["admin", "investors", "balances-tab"],
    queryFn: async () => {
      const res = await listInvestors({ status: "active", pageSize: 200 });
      if (!investorsIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const withdrawalsQuery = useQuery({
    queryKey: ["admin", "withdrawals"],
    queryFn: async () => {
      const res = await fetchWithdrawals({ limit: 100 });
      if (!withdrawalsIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  function refreshAll() {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "investors", "balances-tab"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "withdrawals"],
    });
  }

  const investors = investorsQuery.data?.items ?? [];
  const withdrawals = withdrawalsQuery.data ?? [];

  const totalBalance = useMemo(
    () => investors.reduce((s, i) => s + (i.dividendBalance ?? 0), 0),
    [investors],
  );
  const eligibleCount = useMemo(
    () =>
      investors.filter((i) => (i.dividendBalance ?? 0) >= MIN_WITHDRAWAL)
        .length,
    [investors],
  );

  async function handleReverseSubmit() {
    if (submitting || !reverseTarget) return;
    if (reverseReason.trim().length < 5) {
      toast.error("Alasan reverse minimal 5 karakter");
      return;
    }
    setSubmitting(true);
    const res = await reverseWithdrawal({
      id: reverseTarget.id,
      reason: reverseReason.trim(),
    });
    setSubmitting(false);
    if (!withdrawalsIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Pencairan ${reverseTarget.investorName} di-reverse, saldo dikembalikan`,
    );
    setReverseTarget(null);
    setReverseReason("");
    refreshAll();
  }

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Wallet className="size-5 text-mahakan-green-700 mt-0.5" />
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Total Saldo Dividen
              </p>
              <p className="text-xl font-bold text-mahakan-green-900 font-mono">
                {investorsQuery.isLoading ? (
                  <Skeleton className="h-7 w-32" />
                ) : (
                  formatRupiah(totalBalance)
                )}
              </p>
              <p className="text-[11px] text-neutral-600">
                {investors.length} investor aktif
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Banknote className="size-5 text-success-700 mt-0.5" />
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Eligible Pencairan
              </p>
              <p className="text-xl font-bold text-neutral-900">
                {investorsQuery.isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  `${eligibleCount} orang`
                )}
              </p>
              <p className="text-[11px] text-neutral-600">
                Saldo ≥ {formatRupiah(MIN_WITHDRAWAL)}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Clock className="size-5 text-neutral-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Riwayat Pencairan
              </p>
              <p className="text-xl font-bold text-neutral-900">
                {withdrawalsQuery.isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  `${withdrawals.length} transaksi`
                )}
              </p>
              <Button
                variant="ghost"
                onClick={refreshAll}
                className="mt-1 h-auto p-0 text-[11px] text-mahakan-green-700"
              >
                <RefreshCw className="size-3" aria-hidden /> Refresh
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* List investor dengan saldo */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Saldo Dividen per Investor
            </h3>
            <p className="text-[11px] text-neutral-600">
              Diurutkan saldo terbesar. Klik "Tarik" untuk pencairan ke
              rekening bank investor.
            </p>
          </div>
          {investorsQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : investorsQuery.isError ? (
            <Card className="m-4 border-danger-300 bg-danger-50/40 p-3">
              <p className="text-sm text-danger-700">
                Gagal memuat data investor:{" "}
                {investorsQuery.error instanceof Error
                  ? investorsQuery.error.message
                  : String(investorsQuery.error)}
              </p>
            </Card>
          ) : investors.length === 0 ? (
            <EmptyCard
              icon={Wallet}
              title="Belum ada investor aktif"
              description="Tambah investor di Tab Investor dulu."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Investor</th>
                    <th className="px-3 py-2 text-right">Modal Disetor</th>
                    <th className="px-3 py-2 text-right">Share %</th>
                    <th className="px-3 py-2 text-right">Saldo Dividen</th>
                    {canManage ? (
                      <th className="px-3 py-2 text-right">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {[...investors]
                    .sort(
                      (a, b) =>
                        (b.dividendBalance ?? 0) - (a.dividendBalance ?? 0),
                    )
                    .map((inv) => {
                      const balance = inv.dividendBalance ?? 0;
                      const eligible = balance >= MIN_WITHDRAWAL;
                      return (
                        <tr key={inv.id} className="hover:bg-neutral-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-neutral-900">
                              {inv.fullName}
                            </div>
                            {inv.bankName ? (
                              <div className="text-[11px] text-neutral-500">
                                {inv.bankName}
                                {inv.bankAccountNumber
                                  ? ` ...${inv.bankAccountNumber.slice(-4)}`
                                  : ""}
                              </div>
                            ) : (
                              <div className="text-[11px] text-warning-700">
                                ⚠ Bank belum di-set
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            {formatRupiah(inv.modalDisetor)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            {Number(inv.sharePct).toFixed(4)}%
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right font-mono",
                              balance > 0
                                ? "font-semibold text-mahakan-green-700"
                                : "text-neutral-400",
                            )}
                          >
                            {formatRupiah(balance)}
                          </td>
                          {canManage ? (
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant={eligible ? "primary" : "ghost"}
                                disabled={!eligible}
                                onClick={() =>
                                  setWithdrawalTarget({
                                    id: inv.id,
                                    name: inv.fullName,
                                    balance,
                                  })
                                }
                                title={
                                  eligible
                                    ? "Tarik saldo"
                                    : `Min ${formatRupiah(MIN_WITHDRAWAL)}`
                                }
                              >
                                Tarik
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Riwayat pencairan */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Riwayat Pencairan
            </h3>
            <p className="text-[11px] text-neutral-600">
              {withdrawals.length} transaksi terakhir.
            </p>
          </div>
          {withdrawalsQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : withdrawals.length === 0 ? (
            <EmptyCard
              icon={Clock}
              title="Belum ada pencairan"
              description="Pencairan pertama akan muncul di sini setelah owner trigger via tombol Tarik."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Tanggal</th>
                    <th className="px-3 py-2 text-left">Investor</th>
                    <th className="px-3 py-2 text-right">Nominal</th>
                    <th className="px-3 py-2 text-left">Bank</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    {canManage ? (
                      <th className="px-3 py-2 text-right">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {withdrawals.map((w) => (
                    <tr key={w.id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-xs text-neutral-700">
                        {new Date(w.occurredAt)
                          .toLocaleString("id-ID", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-neutral-900">
                          {w.investorName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatRupiah(w.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {w.bankLabel}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            w.status === "posted" ? "success" : "neutral"
                          }
                        >
                          {w.status === "posted" ? "Posted ✓" : "Reversed ↺"}
                        </Badge>
                        {w.status === "reversed" && w.reversalReason ? (
                          <div className="mt-0.5 text-[10px] text-neutral-500">
                            {w.reversalReason}
                          </div>
                        ) : null}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2 text-right">
                          {w.status === "posted" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReverseTarget(w)}
                              className="text-danger-600 hover:bg-danger-50"
                              title="Reverse withdrawal"
                            >
                              <RotateCcw className="size-3" aria-hidden />
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* WithdrawalModal */}
      {withdrawalTarget ? (
        <WithdrawalModal
          open
          investorId={withdrawalTarget.id}
          investorName={withdrawalTarget.name}
          dividendBalance={withdrawalTarget.balance}
          onClose={() => setWithdrawalTarget(null)}
          onSaved={() => {
            setWithdrawalTarget(null);
            refreshAll();
          }}
        />
      ) : null}

      {/* Reverse withdrawal modal */}
      <Modal
        open={!!reverseTarget}
        onClose={() => {
          setReverseTarget(null);
          setReverseReason("");
        }}
        title="Reverse Pencairan?"
        description={
          reverseTarget
            ? `${reverseTarget.investorName} — ${formatRupiah(reverseTarget.amount)}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setReverseTarget(null);
                setReverseReason("");
              }}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              onClick={handleReverseSubmit}
              loading={submitting}
              className="bg-danger-600 hover:bg-danger-700"
            >
              Reverse Pencairan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            <AlertTriangle className="mr-1 inline size-3" />
            Jurnal pembalik akan di-post (Dr Bank / Cr 2160). Saldo dividen
            investor akan dikembalikan ke balance sebelumnya.
          </div>
          <Input
            label="Alasan reverse (min 5 char)"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="mis. salah investor"
            maxLength={500}
          />
        </div>
      </Modal>
    </div>
  );
}
