"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  HandCoins,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  UserRound,
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
import {
  deleteCreditor,
  fetchCreditors,
  fetchCreditorSummary,
  fetchRepayments,
  isOk,
  reverseRepayment,
  type Creditor,
  type CreditorListRow,
  type CreditorRepaymentListRow,
} from "@/features/creditors";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConvertInvestorToCreditorModal } from "./ConvertInvestorToCreditorModal";
import { CreditorFormModal } from "./CreditorFormModal";
import { CreditorImportWizard } from "./CreditorImportWizard";
import { CreditorRepaymentModal } from "./CreditorRepaymentModal";

interface CreditorsTabProps {
  canManage: boolean;
}

export function CreditorsTab({ canManage }: CreditorsTabProps) {
  const queryClient = useQueryClient();
  /* Sesi AE-184 — default "all" supaya kreditur yang sudah lunas ikut
   * kelihatan sejak halaman dibuka. Dengan default "active", riwayat
   * pelunasan seolah hilang padahal cuma tersaring. */
  const [statusFilter, setStatusFilter] = useState<
    "active" | "settled" | "defaulted" | "all"
  >("all");
  const [formTarget, setFormTarget] = useState<Creditor | null | undefined>(
    undefined,
  );
  const [repaymentTarget, setRepaymentTarget] = useState<Creditor | null>(null);
  const [reverseTarget, setReverseTarget] =
    useState<CreditorRepaymentListRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const creditorsQuery = useQuery({
    queryKey: ["admin", "creditors", statusFilter],
    queryFn: async () => {
      const res = await fetchCreditors({ status: statusFilter });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const repaymentsQuery = useQuery({
    queryKey: ["admin", "creditor-repayments"],
    queryFn: async () => {
      const res = await fetchRepayments({ limit: 100 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  /* Sesi AE-184 follow-up — kartu ringkasan pakai query summary server-side
   * sendiri, queryKey TANPA statusFilter. Sebelumnya kartu dihitung dari
   * creditorsQuery yang sudah tersaring server (tab "Lunas" → outstanding
   * Rp 0 / "0 kreditur aktif" padahal 2150 masih ada saldo), dan Bunga YTD
   * dijumlah dari fetchRepayments({ limit: 100 }) — undercount diam-diam
   * begitu cicilan setahun lewat 100 baris. */
  const summaryQuery = useQuery({
    queryKey: ["admin", "creditor-summary"],
    queryFn: async () => {
      const res = await fetchCreditorSummary();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  function refreshAll() {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "creditors"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "creditor-repayments"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "creditor-summary"],
    });
  }

  const creditors = creditorsQuery.data ?? [];
  const repayments = repaymentsQuery.data ?? [];
  const summary = summaryQuery.data;

  async function handleDelete(c: CreditorListRow) {
    if (!confirm(`Hapus kreditur ${c.fullName}? Tidak bisa di-undo.`)) {
      return;
    }
    const res = await deleteCreditor(c.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Kreditur ${c.fullName} dihapus`);
    refreshAll();
  }

  async function handleReverseSubmit() {
    if (submitting || !reverseTarget) return;
    if (reverseReason.trim().length < 5) {
      toast.error("Alasan reverse min 5 char");
      return;
    }
    setSubmitting(true);
    const res = await reverseRepayment({
      id: reverseTarget.id,
      reason: reverseReason.trim(),
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Cicilan di-reverse, outstanding kreditur dikembalikan`);
    setReverseTarget(null);
    setReverseReason("");
    refreshAll();
  }

  return (
    <div className="space-y-4">
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
                {summaryQuery.isLoading ? (
                  <Skeleton className="h-7 w-32" />
                ) : (
                  formatRupiah(summary?.totalOutstanding ?? 0)
                )}
              </p>
              <p className="text-[11px] text-neutral-600">
                {summary?.activeCount ?? 0} kreditur aktif
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Banknote className="size-5 text-danger-700 mt-0.5" />
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Bunga YTD (Tahun Ini)
              </p>
              <p className="text-xl font-bold text-danger-700 font-mono">
                {summaryQuery.isLoading ? (
                  <Skeleton className="h-7 w-32" />
                ) : (
                  formatRupiah(summary?.interestYtd ?? 0)
                )}
              </p>
              <p className="text-[11px] text-neutral-600">
                Total beban bunga dibayar tahun ini
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Wallet className="size-5 text-neutral-500 mt-0.5" />
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
          {(["active", "settled", "defaulted", "all"] as const).map((s) => (
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
              {s === "all"
                ? "Semua"
                : s === "active"
                  ? "Aktif"
                  : s === "settled"
                    ? "Lunas"
                    : "Default"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {canManage ? (
          <>
            <Button
              variant="ghost"
              onClick={() => setImportOpen(true)}
              title="Bulk import kreditur dari CSV"
            >
              <Upload className="size-4" aria-hidden /> Import CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConvertOpen(true)}
              title="Convert investor existing menjadi kreditur (re-classify modal → hutang)"
            >
              <ArrowRightLeft className="size-4" aria-hidden /> Convert dari
              Investor
            </Button>
            <Button onClick={() => setFormTarget(null)}>
              <Plus className="size-4" aria-hidden /> Tambah Kreditur
            </Button>
          </>
        ) : null}
      </div>

      {/* Creditor list */}
      <Card>
        <CardContent className="p-0">
          {creditorsQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : creditorsQuery.isError ? (
            <Card className="m-4 border-danger-300 bg-danger-50/40 p-3 text-sm text-danger-700">
              Gagal memuat:{" "}
              {creditorsQuery.error instanceof Error
                ? creditorsQuery.error.message
                : String(creditorsQuery.error)}
            </Card>
          ) : creditors.length === 0 ? (
            <EmptyCard
              icon={HandCoins}
              title={
                statusFilter === "active"
                  ? "Belum ada kreditur aktif"
                  : "Belum ada kreditur untuk filter ini"
              }
              description="Kreditur = pemberi pinjaman (bukan investor). Tambah kalau ada pinjaman dengan bunga."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Kreditur</th>
                    <th className="px-3 py-2 text-right">Pokok Awal</th>
                    <th className="px-3 py-2 text-right">Sisa Hutang</th>
                    <th className="px-3 py-2 text-right">Bunga</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    {canManage ? (
                      <th className="px-3 py-2 text-right">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {creditors.map((c) => (
                    <tr key={c.id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-neutral-900">
                            {c.fullName}
                          </span>
                          {c.convertedFromInvestorAt ? (
                            <Badge
                              variant="neutral"
                              className="gap-1 bg-mahakan-green-50 text-mahakan-green-700"
                              title={`Dari investor di-convert pada ${new Date(c.convertedFromInvestorAt).toLocaleDateString("id-ID")}`}
                            >
                              <ArrowRightLeft className="size-2.5" /> ex-Investor
                            </Badge>
                          ) : c.linkedInvestorId ? (
                            <Badge
                              variant="neutral"
                              className="gap-1 bg-neutral-100 text-neutral-700"
                              title="Linked ke profil investor existing"
                            >
                              <Link2 className="size-2.5" /> Linked
                            </Badge>
                          ) : null}
                        </div>
                        {c.bankName ? (
                          <div className="text-[11px] text-neutral-500">
                            {c.bankName} {c.bankAccountNumber}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatRupiah(c.principalOriginal)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-warning-700">
                        {formatRupiah(c.principalOutstanding)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        {c.interestRatePct}% / {c.interestPeriod}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            c.status === "active"
                              ? "warning"
                              : c.status === "settled"
                                ? "success"
                                : "danger"
                          }
                        >
                          {c.status === "active"
                            ? "Aktif"
                            : c.status === "settled"
                              ? "Lunas ✓"
                              : "Default ⚠"}
                        </Badge>
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            {c.status === "active" &&
                            c.principalOutstanding > 0 ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setRepaymentTarget(c)}
                                title="Bayar cicilan"
                              >
                                Cicil
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setFormTarget(c)}
                              title="Edit"
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(c)}
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
              description="Klik 'Cicil' pada kreditur aktif untuk catat pembayaran."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Tanggal</th>
                    <th className="px-3 py-2 text-left">Kreditur</th>
                    <th className="px-3 py-2 text-right">Pokok</th>
                    <th className="px-3 py-2 text-right">Bunga</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    {/* Sesi AE-208 — kolom Bank jadi Sumber Dana: bisa
                     * rekening perusahaan atau talangan pengelola. */}
                    <th className="px-3 py-2 text-left">Sumber Dana</th>
                    <th className="px-3 py-2 text-left">Bukti</th>
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
                        {r.creditorName}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatRupiah(r.principalAmount)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-danger-600">
                        {r.interestAmount > 0
                          ? formatRupiah(r.interestAmount)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                        {formatRupiah(r.principalAmount + r.interestAmount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {r.fundingSource === "pengelola" ? (
                          <span
                            className="inline-flex items-center gap-1 text-mahakan-green-700"
                            title={`Ditalangi uang pribadi ${r.paidByPengelolaName ?? "pengelola"} — modalnya naik ${formatRupiah(r.principalAmount + r.interestAmount)}`}
                          >
                            <UserRound className="size-3 shrink-0" aria-hidden />
                            {r.paidByPengelolaName ?? "Pengelola"}{" "}
                            <span className="text-neutral-500">(pribadi)</span>
                          </span>
                        ) : (
                          (r.bankLabel || "—")
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.receiptImageUrl ? (
                          <a
                            href={r.receiptImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-mahakan-green-700 hover:underline"
                          >
                            <Paperclip className="size-3 shrink-0" aria-hidden />
                            Lihat bukti
                          </a>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
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
                              onClick={() => setReverseTarget(r)}
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

      {/* CSV import wizard */}
      <CreditorImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          refreshAll();
        }}
      />

      {/* Convert investor → kreditur modal */}
      <ConvertInvestorToCreditorModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        onSaved={() => {
          setConvertOpen(false);
          refreshAll();
          /* Invalidate investors cache karena salah satu jadi exited. */
          void queryClient.invalidateQueries({ queryKey: ["admin", "investors"] });
        }}
      />

      {/* Form modal */}
      {formTarget !== undefined ? (
        <CreditorFormModal
          open
          initial={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            refreshAll();
          }}
        />
      ) : null}

      {/* Repayment modal */}
      {repaymentTarget ? (
        <CreditorRepaymentModal
          open
          creditor={repaymentTarget}
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
        title="Reverse Cicilan?"
        description={
          reverseTarget
            ? `${reverseTarget.creditorName} — pokok ${formatRupiah(reverseTarget.principalAmount)}${reverseTarget.interestAmount > 0 ? `, bunga ${formatRupiah(reverseTarget.interestAmount)}` : ""}`
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
              Reverse Cicilan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            <AlertTriangle className="mr-1 inline size-3" />
            Outstanding kreditur akan dikembalikan + jurnal pembalik di-post.
            {/* Sesi AE-208 — reversal talangan pengelola juga menarik balik
             * kenaikan modalnya, jadi sebut angkanya di depan. */}
            {reverseTarget?.fundingSource === "pengelola" ? (
              <>
                {" "}
                Modal{" "}
                {reverseTarget.paidByPengelolaName ?? "pengelola"} juga dikurangi
                lagi{" "}
                {formatRupiah(
                  reverseTarget.principalAmount + reverseTarget.interestAmount,
                )}
                .
              </>
            ) : null}
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
