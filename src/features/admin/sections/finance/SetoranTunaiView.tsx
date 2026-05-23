"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Undo2, Wallet } from "lucide-react";
import { Badge, Button, Input, Modal, Skeleton, toast } from "@/components/ui";
import {
  fetchCashDeposits,
  unverifyCashDeposit,
} from "@/features/finance/actions";
import type {
  CashDeposit,
  CashDepositStatus,
} from "@/features/finance/types";
import { useCashDepositDashboard } from "@/features/finance/useCashDepositDashboard";
import { formatRupiah } from "@/lib/money";
import { formatIndonesianDate } from "@/lib/date";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/rbac";
import { CashDepositModal } from "./CashDepositModal";
import { VerifyDepositModal } from "./VerifyDepositModal";

interface Props {
  viewerRole: Role;
}

type DepositRow = CashDeposit & {
  depositorName: string | null;
  verifierName: string | null;
};

const STATUS_LABEL: Record<CashDepositStatus, string> = {
  pending_verification: "Pending",
  verified: "Verified",
  rejected: "Rejected",
};

const STATUS_VARIANT: Record<
  CashDepositStatus,
  "warning" | "success" | "danger"
> = {
  pending_verification: "warning",
  verified: "success",
  rejected: "danger",
};

export function SetoranTunaiView({ viewerRole }: Props) {
  const [filter, setFilter] = useState<CashDepositStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DepositRow | null>(null);
  const [verifying, setVerifying] = useState<DepositRow | null>(null);
  // Sesi AE-62k — unverify verified deposit (revert ke pending dengan reason).
  const [unverifying, setUnverifying] = useState<DepositRow | null>(null);
  const [unverifyReason, setUnverifyReason] = useState("");
  const [unverifySubmitting, setUnverifySubmitting] = useState(false);
  const queryClient = useQueryClient();

  const canCreate = hasPermission(viewerRole, "cash_deposit.create");
  const canVerify = hasPermission(viewerRole, "cash_deposit.verify");

  /* Sesi AE-123 — dashboard hook untuk tombol "Setor Semua" + in-app
   * banner pending. Auto-refresh 60 detik. */
  const dashboardQuery = useCashDepositDashboard();
  const dashboard = dashboardQuery.data;
  const outstandingToDeposit = dashboard?.outstandingToDeposit ?? 0;
  const pendingCount = dashboard?.pendingCount ?? 0;
  const oldestPendingDays = dashboard?.oldestPendingDays ?? null;

  // Sesi AE-13 — TanStack Query cache. Per-filter key biar switching tab
  // keep cache untuk yang udah di-load.
  const listQuery = useQuery({
    queryKey: ["finance", "deposits", "list", filter],
    queryFn: async () => {
      const res = await fetchCashDeposits({
        status: filter === "all" ? "all" : filter,
        limit: 100,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data.rows as DepositRow[];
    },
    staleTime: 30 * 1000,
  });
  const rows = listQuery.data ?? [];
  const loading = listQuery.isLoading;

  function invalidateAll() {
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposits", "list"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposit-dashboard"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["finance", "deposits", "pending"],
    });
  }

  const filterChips: Array<{ key: typeof filter; label: string }> = [
    { key: "all", label: "Semua" },
    { key: "pending_verification", label: "Pending" },
    { key: "verified", label: "Verified" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="space-y-3">
      {/* Sesi AE-123 — in-app banner kalau ada setoran pending verify.
       * Auto-refresh tiap 60 detik. Owner-only (yang punya cash_deposit.verify). */}
      {canVerify && pendingCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-300 bg-warning-100/60 px-4 py-3 text-sm text-warning-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">
                {pendingCount} setoran tunai menunggu verifikasi
              </p>
              {oldestPendingDays !== null && oldestPendingDays >= 1 ? (
                <p className="text-xs">
                  Tertua: {oldestPendingDays} hari lalu
                  {oldestPendingDays >= 3
                    ? " — sudah lewat 3 hari, mohon segera review"
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFilter("pending_verification")}
            className="border-warning-500 text-warning-700"
          >
            Tampilkan
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {filterChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={
                filter === c.key
                  ? "rounded-full bg-mahakan-green-700 px-3 py-1 text-xs font-semibold text-white"
                  : "rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
              }
            >
              {c.label}
              {c.key === "pending_verification" && pendingCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-warning-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {pendingCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="ml-auto" />
        {/* Sesi AE-123 — tombol "Setor Semua" one-click open create modal.
         * Smart defaults effect di CashDepositModal akan auto-prefill 3
         * field (amount, coversFromDate, coversToDate) via dashboard.
         * Tampil hanya kalau ada outstanding cash yang belum disetor. */}
        {canCreate && outstandingToDeposit > 0 ? (
          <Button
            variant="outline"
            onClick={() => setCreateOpen(true)}
            title="Setor semua kas yang belum disetor dengan periode auto-prefill"
          >
            <Wallet className="size-4" /> Setor Semua{" "}
            <span className="font-mono">
              {formatRupiah(outstandingToDeposit)}
            </span>
          </Button>
        ) : null}
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Catat Setoran
          </Button>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
          Belum ada setoran tunai{" "}
          {filter !== "all" ? `dengan status ${STATUS_LABEL[filter]}` : ""}.
        </div>
      ) : (
        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Tanggal</th>
                  <th className="px-3 py-2 text-right font-medium">Nominal</th>
                  <th className="px-3 py-2 text-left font-medium">Bank</th>
                  <th className="px-3 py-2 text-left font-medium">Periode</th>
                  <th className="px-3 py-2 text-left font-medium">Setor oleh</th>
                  <th className="px-3 py-2 text-left font-medium">Verifikator</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-neutral-100 hover:bg-neutral-50"
                  >
                    <td className="px-3 py-2">
                      {formatIndonesianDate(r.depositDate)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatRupiah(r.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.bankDestination}</div>
                      {r.referenceNo ? (
                        <div className="text-[10px] text-neutral-500">
                          Ref: {r.referenceNo}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      {formatIndonesianDate(r.coversFromDate)} →{" "}
                      {formatIndonesianDate(r.coversToDate)}
                    </td>
                    <td className="px-3 py-2">{r.depositorName ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.verifierName ?? "—"}
                      {r.status === "rejected" && r.rejectedReason ? (
                        <div className="text-[10px] text-red-700">
                          {r.rejectedReason}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_VARIANT[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {r.status === "pending_verification" && canCreate ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(r)}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {r.status === "pending_verification" && canVerify ? (
                          <Button
                            size="sm"
                            onClick={() => setVerifying(r)}
                          >
                            Verifikasi
                          </Button>
                        ) : null}
                        {/* Sesi AE-62k — Revert verified deposit ke pending
                            kalau ternyata fraudulent/duplicate/wrong amount.
                            Audit log + reverse journal entry. Owner-only. */}
                        {r.status === "verified" && canVerify ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setUnverifying(r);
                              setUnverifyReason("");
                            }}
                            title="Revert ke pending (kalau salah verify)"
                          >
                            <Undo2 className="size-3.5" aria-hidden /> Revert
                          </Button>
                        ) : null}
                        {r.photoUrl ? (
                          <a
                            href={r.photoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md px-2 py-1 text-xs text-mahakan-green-700 hover:bg-neutral-100"
                          >
                            Bukti
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <CashDepositModal
        open={createOpen || editing !== null}
        editing={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditing(null);
          invalidateAll();
        }}
      />
      <VerifyDepositModal
        open={verifying !== null}
        deposit={verifying}
        onClose={() => setVerifying(null)}
        onChanged={() => {
          setVerifying(null);
          invalidateAll();
        }}
      />

      {/* Sesi AE-62k — Unverify (revert) modal. Required reason. */}
      <Modal
        open={unverifying !== null}
        onClose={() => {
          if (unverifySubmitting) return;
          setUnverifying(null);
          setUnverifyReason("");
        }}
        title="Revert setoran verified ke pending?"
        description={
          unverifying
            ? `Setoran ${formatRupiah(unverifying.amount)} → ${unverifying.bankDestination} (${formatIndonesianDate(unverifying.depositDate)})`
            : ""
        }
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setUnverifying(null);
                setUnverifyReason("");
              }}
              disabled={unverifySubmitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!unverifying) return;
                if (unverifyReason.trim().length < 3) {
                  toast.error("Alasan minimal 3 karakter");
                  return;
                }
                setUnverifySubmitting(true);
                const res = await unverifyCashDeposit({
                  id: unverifying.id,
                  reason: unverifyReason.trim(),
                });
                setUnverifySubmitting(false);
                if (!res.ok) {
                  toast.error(res.error.message);
                  return;
                }
                toast.success(
                  `Setoran ${formatRupiah(unverifying.amount)} di-revert ke pending`,
                );
                setUnverifying(null);
                setUnverifyReason("");
                invalidateAll();
              }}
              loading={unverifySubmitting}
            >
              Ya, Revert
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-warning-300 bg-warning-100 p-3 text-xs text-warning-700">
            <p className="font-semibold">Perhatian:</p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>Status setoran balik ke pending verification</li>
              <li>Reverse journal entry akan di-post otomatis (Dr Kas / Cr Bank)</li>
              <li>Alasan revert akan di-record di audit log + notes setoran</li>
              <li>Tidak bisa di-undo — kalau salah revert, harus verify ulang</li>
            </ul>
          </div>
          <Input
            label="Alasan revert"
            placeholder="mis. setoran duplikat, salah jumlah, fraud detected"
            value={unverifyReason}
            onChange={(e) => setUnverifyReason(e.target.value)}
            required
          />
        </div>
      </Modal>
    </div>
  );
}
