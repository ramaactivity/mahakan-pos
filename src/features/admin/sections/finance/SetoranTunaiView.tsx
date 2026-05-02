"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@/components/ui";
import { fetchCashDeposits } from "@/features/finance/actions";
import type {
  CashDeposit,
  CashDepositStatus,
} from "@/features/finance/types";
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
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DepositRow | null>(null);
  const [verifying, setVerifying] = useState<DepositRow | null>(null);

  const canCreate = hasPermission(viewerRole, "cash_deposit.create");
  const canVerify = hasPermission(viewerRole, "cash_deposit.verify");

  async function load() {
    setLoading(true);
    try {
      const res = await fetchCashDeposits({
        status: filter === "all" ? "all" : filter,
        limit: 100,
      });
      if (res.ok) setRows(res.data.rows);
      else toast.error(res.error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    load();
  }, [filter]);

  const filterChips: Array<{ key: typeof filter; label: string }> = [
    { key: "all", label: "Semua" },
    { key: "pending_verification", label: "Pending" },
    { key: "verified", label: "Verified" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="space-y-3">
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
            </button>
          ))}
        </div>
        <div className="ml-auto" />
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
          load();
        }}
      />
      <VerifyDepositModal
        open={verifying !== null}
        deposit={verifying}
        onClose={() => setVerifying(null)}
        onChanged={() => {
          setVerifying(null);
          load();
        }}
      />
    </div>
  );
}
