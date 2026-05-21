"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Building2,
  PieChart,
  RefreshCw,
  RotateCcw,
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
import {
  listInvestors,
  isOk as investorsIsOk,
} from "@/features/investors";
import {
  fetchShareTransactions,
  isOk,
  reverseShareTransaction,
  type ShareTransactionListRow,
} from "@/features/share-transactions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CompanyBuybackModal } from "./CompanyBuybackModal";
import { ShareTransferModal } from "./ShareTransferModal";

interface ShareTransactionsTabProps {
  canManage: boolean;
}

export function ShareTransactionsTab({ canManage }: ShareTransactionsTabProps) {
  const queryClient = useQueryClient();
  const [showTransfer, setShowTransfer] = useState(false);
  const [showBuyback, setShowBuyback] = useState(false);
  const [reverseTarget, setReverseTarget] =
    useState<ShareTransactionListRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const investorsQuery = useQuery({
    queryKey: ["admin", "investors", "share-tab"],
    queryFn: async () => {
      const res = await listInvestors({ status: "active", pageSize: 200 });
      if (!investorsIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const txQuery = useQuery({
    queryKey: ["admin", "share-transactions"],
    queryFn: async () => {
      const res = await fetchShareTransactions({ limit: 100 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  function refreshAll() {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "investors"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "share-transactions"],
    });
  }

  const investors = investorsQuery.data?.items ?? [];
  const transactions = txQuery.data ?? [];

  const totalShare = useMemo(
    () => investors.reduce((s, i) => s + Number(i.sharePct), 0),
    [investors],
  );
  const treasuryShare = Math.max(0, 100 - totalShare);
  const isBalanced = Math.abs(totalShare - 100) < 0.0001;

  async function handleReverseSubmit() {
    if (submitting || !reverseTarget) return;
    if (reverseReason.trim().length < 5) {
      toast.error("Alasan min 5 char");
      return;
    }
    setSubmitting(true);
    const res = await reverseShareTransaction({
      id: reverseTarget.id,
      reason: reverseReason.trim(),
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Mutasi saham di-reverse");
    setReverseTarget(null);
    setReverseReason("");
    refreshAll();
  }

  function kindLabel(k: string) {
    switch (k) {
      case "p2p_transfer":
        return "P2P Transfer";
      case "company_buyback":
        return "Company Buyback";
      case "top_up":
        return "Top Up Modal";
      case "initial":
        return "Initial Deposit";
      default:
        return k;
    }
  }

  return (
    <div className="space-y-4">
      {/* Top status banner — sum share invariant */}
      <Card
        className={cn(
          "p-4",
          isBalanced
            ? "border-success-300 bg-success-50/40"
            : "border-warning-300 bg-warning-50/40",
        )}
      >
        <div className="flex items-start gap-3">
          <PieChart
            className={cn(
              "size-5 mt-0.5",
              isBalanced ? "text-success-700" : "text-warning-700",
            )}
          />
          <div className="flex-1">
            <div className="flex items-baseline justify-between">
              <p
                className={cn(
                  "text-sm font-semibold",
                  isBalanced ? "text-success-700" : "text-warning-700",
                )}
              >
                Total Share Investor Aktif:{" "}
                <span className="font-mono">{totalShare.toFixed(4)}%</span>
              </p>
              {!isBalanced ? (
                <Badge variant="warning">
                  ⚠ {treasuryShare.toFixed(4)}% treasury
                </Badge>
              ) : (
                <Badge variant="success">✓ Balanced 100%</Badge>
              )}
            </div>
            <p className="mt-1 text-[11px] text-neutral-600">
              {isBalanced
                ? "Semua share investor sum 100%. Distribusi v2 langsung dialokasikan ke investor pool tanpa treasury hold."
                : `Sisa ${treasuryShare.toFixed(4)}% di-treat sebagai "company hold" (treasury). Compute v2 alokasi sisa% ke pengelola_pool.`}
            </p>
          </div>
        </div>
      </Card>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <>
            <Button onClick={() => setShowTransfer(true)}>
              <ArrowRightLeft className="size-4" aria-hidden /> P2P Transfer
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowBuyback(true)}
            >
              <Building2 className="size-4" aria-hidden /> Company Buyback
            </Button>
          </>
        ) : null}
        <div className="flex-1" />
        <Button variant="ghost" onClick={refreshAll}>
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </div>

      {/* Investor share table */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Share % per Investor Aktif
            </h3>
          </div>
          {investorsQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : investors.length === 0 ? (
            <EmptyCard
              icon={PieChart}
              title="Belum ada investor aktif"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Investor</th>
                    <th className="px-3 py-2 text-right">Modal Disetor</th>
                    <th className="px-3 py-2 text-right">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {[...investors]
                    .sort((a, b) => Number(b.sharePct) - Number(a.sharePct))
                    .slice(0, 30)
                    .map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-3 py-2 text-neutral-900">
                          {inv.fullName}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {formatRupiah(inv.modalDisetor)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                          {Number(inv.sharePct).toFixed(4)}%
                        </td>
                      </tr>
                    ))}
                  {investors.length > 30 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-2 text-center text-[11px] text-neutral-500"
                      >
                        … {investors.length - 30} investor lainnya (lihat tab
                        Investor untuk full list)
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Share transactions history */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Riwayat Mutasi Saham
            </h3>
          </div>
          {txQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : transactions.length === 0 ? (
            <EmptyCard
              icon={ArrowRightLeft}
              title="Belum ada mutasi saham"
              description="P2P transfer, buyback, top-up, atau initial deposit akan muncul di sini."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Tanggal</th>
                    <th className="px-3 py-2 text-left">Jenis</th>
                    <th className="px-3 py-2 text-left">Dari → Ke</th>
                    <th className="px-3 py-2 text-right">Share %</th>
                    <th className="px-3 py-2 text-right">Nominal</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    {canManage ? (
                      <th className="px-3 py-2 text-right">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 text-xs text-neutral-700">
                        {new Date(t.occurredAt).toLocaleDateString("id-ID")}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <Badge variant="neutral">{kindLabel(t.kind)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {t.fromInvestorName ?? "—"}{" "}
                        <span className="text-neutral-400">→</span>{" "}
                        {t.toInvestorName ?? "(treasury)"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(t.sharePctDelta).toFixed(4)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {t.amountIdr > 0 ? formatRupiah(t.amountIdr) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            t.status === "posted" ? "success" : "neutral"
                          }
                        >
                          {t.status === "posted" ? "Posted ✓" : "Reversed ↺"}
                        </Badge>
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2 text-right">
                          {t.status === "posted" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReverseTarget(t)}
                              className="text-danger-600 hover:bg-danger-50"
                              title="Reverse"
                            >
                              <RotateCcw className="size-3" />
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

      {/* Modals */}
      <ShareTransferModal
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        onSaved={() => {
          setShowTransfer(false);
          refreshAll();
        }}
      />
      <CompanyBuybackModal
        open={showBuyback}
        onClose={() => setShowBuyback(false)}
        onSaved={() => {
          setShowBuyback(false);
          refreshAll();
        }}
      />

      {/* Reverse modal */}
      <Modal
        open={!!reverseTarget}
        onClose={() => {
          setReverseTarget(null);
          setReverseReason("");
        }}
        title="Reverse Mutasi Saham?"
        description={
          reverseTarget
            ? `${kindLabel(reverseTarget.kind)} — ${Number(reverseTarget.sharePctDelta).toFixed(4)}%`
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
              Reverse
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-neutral-700">
            {reverseTarget?.kind === "p2p_transfer"
              ? "Share akan di-swap kembali (from ← to). Tidak ada jurnal."
              : "Jurnal pembalik akan di-post. Share dikembalikan ke investor."}
          </p>
          <Input
            label="Alasan reverse"
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
