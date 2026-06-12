"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  HandCoins,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
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
import { hasPermission, type Role } from "@/lib/auth/rbac";
import {
  deleteInternalDebtParty,
  fetchInternalDebtEntries,
  fetchInternalDebtParties,
  fetchInternalDebtRepayments,
  isOk,
  reverseInternalDebtEntry,
  reverseInternalDebtRepayment,
  PARTY_TYPE_LABELS,
  type InternalDebtEntryListRow,
  type InternalDebtParty,
  type InternalDebtPartyListRow,
  type InternalDebtPartyType,
  type InternalDebtRepaymentListRow,
} from "@/features/internal-debts";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InternalDebtEntryModal } from "./internal-debts/InternalDebtEntryModal";
import { InternalDebtPartyFormModal } from "./internal-debts/InternalDebtPartyFormModal";
import { InternalDebtRepaymentModal } from "./internal-debts/InternalDebtRepaymentModal";

/**
 * Sesi AE-180 — Halaman Hutang Internal (Talangan Owner/Pengelola).
 *
 * Tracking hutang bisnis ke orang dalam (owner/manager/dll) yang nalangin
 * pengeluaran atau minjamin tunai tanpa bunga. Terpisah dari halaman
 * Investor (owner directive). Pinjaman formal berbunga → Hutang Kreditur.
 */

interface InternalDebtsSectionProps {
  viewerRole: Role;
}

type ReverseTarget =
  | { type: "entry"; row: InternalDebtEntryListRow }
  | { type: "repayment"; row: InternalDebtRepaymentListRow };

export function InternalDebtsSection({ viewerRole }: InternalDebtsSectionProps) {
  const queryClient = useQueryClient();
  const canManage = hasPermission(viewerRole, "distribution.approve");

  const [statusFilter, setStatusFilter] = useState<
    "active" | "settled" | "all"
  >("active");
  const [partyFormTarget, setPartyFormTarget] = useState<
    InternalDebtParty | null | undefined
  >(undefined);
  const [entryModalParty, setEntryModalParty] = useState<
    string | null | undefined
  >(undefined);
  const [repaymentTarget, setRepaymentTarget] =
    useState<InternalDebtPartyListRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<ReverseTarget | null>(
    null,
  );
  const [reverseReason, setReverseReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const partiesQuery = useQuery({
    queryKey: ["admin", "internal-debt-parties", statusFilter],
    queryFn: async () => {
      const res = await fetchInternalDebtParties({ status: statusFilter });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const entriesQuery = useQuery({
    queryKey: ["admin", "internal-debt-entries"],
    queryFn: async () => {
      const res = await fetchInternalDebtEntries({ limit: 100 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const repaymentsQuery = useQuery({
    queryKey: ["admin", "internal-debt-repayments"],
    queryFn: async () => {
      const res = await fetchInternalDebtRepayments({ limit: 100 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  function refreshAll() {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "internal-debt-parties"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "internal-debt-entries"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "internal-debt-repayments"],
    });
  }

  const parties = partiesQuery.data ?? [];
  const entries = entriesQuery.data ?? [];
  const repayments = repaymentsQuery.data ?? [];
  const totalOutstanding = parties.reduce(
    (s, p) => s + p.totalOutstanding,
    0,
  );
  const activeCount = parties.filter((p) => p.totalOutstanding > 0).length;

  async function handleDeleteParty(p: InternalDebtPartyListRow) {
    if (!confirm(`Hapus ${p.name} dari daftar pihak? Tidak bisa di-undo.`)) {
      return;
    }
    const res = await deleteInternalDebtParty(p.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`${p.name} dihapus`);
    refreshAll();
  }

  async function handleReverseSubmit() {
    if (submitting || !reverseTarget) return;
    if (reverseReason.trim().length < 5) {
      toast.error("Alasan reverse min 5 karakter");
      return;
    }
    setSubmitting(true);
    const res =
      reverseTarget.type === "entry"
        ? await reverseInternalDebtEntry({
            id: reverseTarget.row.id,
            reason: reverseReason.trim(),
          })
        : await reverseInternalDebtRepayment({
            id: reverseTarget.row.id,
            reason: reverseReason.trim(),
          });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      reverseTarget.type === "entry"
        ? "Entry hutang di-reverse, jurnal pembalik di-post"
        : "Cicilan di-reverse, sisa hutang dikembalikan",
    );
    setReverseTarget(null);
    setReverseReason("");
    refreshAll();
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Hutang Internal
          </h1>
          <p className="text-sm text-neutral-700">
            Talangan owner/pengelola: biaya yang dibayar pakai uang pribadi
            atau pinjaman tunai ke bisnis (tanpa bunga). Pinjaman formal
            berbunga tetap di Hutang Kreditur.
          </p>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <HandCoins className="size-5 text-warning-700 mt-0.5" />
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Total Hutang Outstanding
              </p>
              <p className="text-xl font-bold text-warning-700 font-mono">
                {partiesQuery.isLoading ? (
                  <Skeleton className="h-7 w-32" />
                ) : (
                  formatRupiah(totalOutstanding)
                )}
              </p>
              <p className="text-[11px] text-neutral-600">
                {activeCount} pihak belum lunas
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Landmark className="size-5 text-mahakan-green-700 mt-0.5" />
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Hutang Masuk (Riwayat)
              </p>
              <p className="text-xl font-bold text-neutral-900">
                {entriesQuery.isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  `${entries.length} entry`
                )}
              </p>
              <p className="text-[11px] text-neutral-600">
                Talangan biaya + pinjaman tunai
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Banknote className="size-5 text-neutral-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Riwayat Cicilan
              </p>
              <p className="text-xl font-bold text-neutral-900">
                {repaymentsQuery.isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  `${repayments.length} transaksi`
                )}
              </p>
              <Button
                variant="ghost"
                onClick={refreshAll}
                className="mt-1 h-auto p-0 text-[11px] text-mahakan-green-700"
              >
                <RefreshCw className="size-3" /> Refresh
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border border-neutral-200 bg-white p-1">
          {(["active", "settled", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium",
                statusFilter === s
                  ? "bg-mahakan-green-700 text-white"
                  : "text-neutral-600 hover:bg-neutral-100",
              )}
            >
              {s === "all" ? "Semua" : s === "active" ? "Belum Lunas" : "Lunas"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {canManage ? (
          <>
            <Button
              variant="ghost"
              onClick={() => setPartyFormTarget(null)}
              title="Tambah orang yang bisa dipinjami"
            >
              <Users className="size-4" aria-hidden /> Tambah Pihak
            </Button>
            <Button
              onClick={() => setEntryModalParty(null)}
              disabled={parties.length === 0 && !partiesQuery.isLoading}
              title={
                parties.length === 0
                  ? "Tambah pihak dulu sebelum catat hutang"
                  : "Catat talangan biaya / pinjaman tunai baru"
              }
            >
              <Plus className="size-4" aria-hidden /> Catat Hutang
            </Button>
          </>
        ) : null}
      </div>

      {/* Party list */}
      <Card>
        <CardContent className="p-0">
          {partiesQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : partiesQuery.isError ? (
            <Card className="m-4 border-danger-300 bg-danger-50/40 p-3 text-sm text-danger-700">
              Gagal memuat:{" "}
              {partiesQuery.error instanceof Error
                ? partiesQuery.error.message
                : String(partiesQuery.error)}
            </Card>
          ) : parties.length === 0 ? (
            <EmptyCard
              icon={HandCoins}
              title={
                statusFilter === "active"
                  ? "Tidak ada hutang internal berjalan"
                  : "Belum ada pihak untuk filter ini"
              }
              description="Klik 'Tambah Pihak' lalu 'Catat Hutang' saat owner/pengelola nalangin pengeluaran."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Pihak</th>
                    <th className="px-3 py-2 text-right">Total Hutang</th>
                    <th className="px-3 py-2 text-right">Sudah Dicicil</th>
                    <th className="px-3 py-2 text-right">Sisa Hutang</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    {canManage ? (
                      <th className="px-3 py-2 text-right">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {parties.map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-neutral-900">
                            {p.name}
                          </span>
                          <Badge
                            variant="neutral"
                            className="bg-neutral-100 text-neutral-700"
                          >
                            {PARTY_TYPE_LABELS[
                              p.partyType as InternalDebtPartyType
                            ] ?? p.partyType}
                          </Badge>
                        </div>
                        {p.bankName ? (
                          <div className="text-[11px] text-neutral-500">
                            {p.bankName} {p.bankAccountNumber}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatRupiah(p.totalDebt)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-mahakan-green-700">
                        {formatRupiah(p.totalRepaid)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-warning-700">
                        {formatRupiah(p.totalOutstanding)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            p.totalOutstanding > 0 ? "warning" : "success"
                          }
                        >
                          {p.totalOutstanding > 0 ? "Belum Lunas" : "Lunas ✓"}
                        </Badge>
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            {p.totalOutstanding > 0 ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setRepaymentTarget(p)}
                                title="Bayar cicilan"
                              >
                                Cicil
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEntryModalParty(p.id)}
                              title="Catat hutang baru untuk pihak ini"
                            >
                              <Plus className="size-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPartyFormTarget(p)}
                              title="Edit"
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteParty(p)}
                              className="text-danger-600 hover:bg-danger-50"
                              title="Hapus"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
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

      {/* Entry history */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Riwayat Hutang Masuk
            </h3>
          </div>
          {entriesQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : entries.length === 0 ? (
            <EmptyCard
              icon={Landmark}
              title="Belum ada hutang masuk"
              description="Klik 'Catat Hutang' saat owner/pengelola nalangin biaya atau minjamin tunai."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Tanggal</th>
                    <th className="px-3 py-2 text-left">Pihak</th>
                    <th className="px-3 py-2 text-left">Jenis</th>
                    <th className="px-3 py-2 text-left">Deskripsi</th>
                    <th className="px-3 py-2 text-right">Nominal</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    {canManage ? (
                      <th className="px-3 py-2 text-right">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-xs text-neutral-700">
                        {new Date(e.occurredAt).toLocaleDateString("id-ID")}
                      </td>
                      <td className="px-3 py-2 text-neutral-900">
                        {e.partyName}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="neutral"
                          className={
                            e.kind === "expense_advance"
                              ? "bg-warning-50 text-warning-700"
                              : "bg-mahakan-green-50 text-mahakan-green-700"
                          }
                        >
                          {e.kind === "expense_advance"
                            ? "Talangan Biaya"
                            : "Pinjaman Tunai"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {e.description}
                        {e.kind === "expense_advance" && e.categoryName ? (
                          <span className="text-neutral-400">
                            {" "}
                            · {e.categoryName}
                          </span>
                        ) : null}
                        {e.kind === "cash_loan" && e.bankLabel ? (
                          <span className="text-neutral-400">
                            {" "}
                            · masuk {e.bankLabel}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                        {formatRupiah(e.amount)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            e.status === "posted" ? "success" : "neutral"
                          }
                        >
                          {e.status === "posted" ? "Posted ✓" : "Reversed ↺"}
                        </Badge>
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2 text-right">
                          {e.status === "posted" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setReverseTarget({ type: "entry", row: e })
                              }
                              className="text-danger-600 hover:bg-danger-50"
                              title="Reverse entry (salah input)"
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

      {/* Repayment history */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Riwayat Cicilan
            </h3>
          </div>
          {repaymentsQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : repayments.length === 0 ? (
            <EmptyCard
              icon={Banknote}
              title="Belum ada cicilan"
              description="Klik 'Cicil' pada pihak yang belum lunas untuk catat pembayaran."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Tanggal</th>
                    <th className="px-3 py-2 text-left">Pihak</th>
                    <th className="px-3 py-2 text-right">Nominal</th>
                    <th className="px-3 py-2 text-left">Bank</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    {canManage ? (
                      <th className="px-3 py-2 text-right">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {repayments.map((r) => (
                    <tr key={r.id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-xs text-neutral-700">
                        {new Date(r.occurredAt).toLocaleDateString("id-ID")}
                      </td>
                      <td className="px-3 py-2 text-neutral-900">
                        {r.partyName}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                        {formatRupiah(r.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {r.bankLabel}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            r.status === "posted" ? "success" : "neutral"
                          }
                        >
                          {r.status === "posted" ? "Posted ✓" : "Reversed ↺"}
                        </Badge>
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2 text-right">
                          {r.status === "posted" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setReverseTarget({
                                  type: "repayment",
                                  row: r,
                                })
                              }
                              className="text-danger-600 hover:bg-danger-50"
                              title="Reverse cicilan"
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

      {/* Party form modal */}
      {partyFormTarget !== undefined ? (
        <InternalDebtPartyFormModal
          open
          initial={partyFormTarget}
          onClose={() => setPartyFormTarget(undefined)}
          onSaved={() => {
            setPartyFormTarget(undefined);
            refreshAll();
          }}
        />
      ) : null}

      {/* Entry modal */}
      {entryModalParty !== undefined ? (
        <InternalDebtEntryModal
          open
          parties={parties}
          initialPartyId={entryModalParty}
          onClose={() => setEntryModalParty(undefined)}
          onSaved={() => {
            setEntryModalParty(undefined);
            refreshAll();
            /* Talangan biaya juga bikin row Pengeluaran. */
            void queryClient.invalidateQueries({
              queryKey: ["admin", "expenses"],
            });
          }}
        />
      ) : null}

      {/* Repayment modal */}
      {repaymentTarget ? (
        <InternalDebtRepaymentModal
          open
          party={repaymentTarget}
          onClose={() => setRepaymentTarget(null)}
          onSaved={() => {
            setRepaymentTarget(null);
            refreshAll();
          }}
        />
      ) : null}

      {/* Reverse modal */}
      <Modal
        open={!!reverseTarget}
        onClose={() => {
          setReverseTarget(null);
          setReverseReason("");
        }}
        title={
          reverseTarget?.type === "entry"
            ? "Reverse Entry Hutang?"
            : "Reverse Cicilan?"
        }
        description={
          reverseTarget
            ? `${reverseTarget.row.partyName} — ${formatRupiah(reverseTarget.row.amount)}`
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
          <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            <AlertTriangle className="mr-1 inline size-3" />
            {reverseTarget?.type === "entry"
              ? "Hutang pihak ini akan dikurangi + jurnal pembalik di-post. Untuk talangan biaya, row Pengeluaran terkait ikut dihapus."
              : "Sisa hutang pihak ini akan dikembalikan + jurnal pembalik di-post."}
          </div>
          <Input
            label="Alasan reverse"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="mis. salah input nominal"
            maxLength={500}
          />
        </div>
      </Modal>
    </div>
  );
}
