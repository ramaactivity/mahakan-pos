"use client";

import { useEffect, useState } from "react";
import { Badge, Modal, Skeleton } from "@/components/ui";
import { isOk, transactionService } from "@/mocks/services";
import type { Shift, Transaction, PublicUser } from "@/mocks/types";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime, formatIndonesianTime } from "@/lib/date";
import { cn } from "@/lib/utils";

interface ShiftDetailModalProps {
  shift: Shift | null;
  user: PublicUser | null;
  onClose: () => void;
}

export function ShiftDetailModal({
  shift,
  user,
  onClose,
}: ShiftDetailModalProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shift) return;
    let cancelled = false;
    // Sync from prop change (modal re-opened with new shift)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    async function load() {
      const res = await transactionService.listTransactions({
        shiftId: shift!.id,
        limit: 1000,
      });
      if (cancelled) return;
      if (isOk(res)) setTransactions(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [shift]);

  if (!shift) return null;

  const paid = transactions.filter((t) => t.status === "paid");
  const voided = transactions.filter((t) => t.status === "voided");
  const refunded = transactions.filter((t) => t.status === "refunded");
  const paidCash = paid
    .filter((t) => t.paymentMethod === "cash")
    .reduce((s, t) => s + t.total, 0);
  const paidQris = paid
    .filter((t) => t.paymentMethod === "qris")
    .reduce((s, t) => s + t.total, 0);
  const paidCard = paid
    .filter((t) => t.paymentMethod === "card_bca")
    .reduce((s, t) => s + t.total, 0);

  return (
    <Modal
      open={shift !== null}
      onClose={onClose}
      title={`Shift ${user?.name ?? ""}`}
      description={`Mulai ${formatIndonesianDateTime(shift.openedAt)}${
        shift.closedAt ? ` · Tutup ${formatIndonesianDateTime(shift.closedAt)}` : ""
      }`}
      size="xl"
    >
      <div className="space-y-4">
        {/* Status + variance flag */}
        <div className="flex flex-wrap items-center gap-2">
          {shift.status === "open" ? (
            <Badge variant="success">Open</Badge>
          ) : (
            <Badge variant="neutral">Closed</Badge>
          )}
          {shift.variance !== null ? (
            shift.variance === 0 ? (
              <Badge variant="success">Kas Pas</Badge>
            ) : Math.abs(shift.variance) > 10_000 ? (
              <Badge variant="danger">
                Selisih {shift.variance >= 0 ? "+" : ""}
                {formatRupiah(shift.variance)} (di luar batas)
              </Badge>
            ) : (
              <Badge variant="warning">
                Selisih {shift.variance >= 0 ? "+" : ""}
                {formatRupiah(shift.variance)}
              </Badge>
            )
          ) : null}
        </div>

        {/* Summary grid */}
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard
            label="Kas Awal"
            value={formatRupiah(shift.openingCash)}
          />
          <SummaryCard
            label="Penjualan Tunai"
            value={formatRupiah(paidCash)}
            sub={`${paid.filter((t) => t.paymentMethod === "cash").length} trx`}
          />
          <SummaryCard
            label="Kas Aktual"
            value={
              shift.actualCash !== null ? formatRupiah(shift.actualCash) : "—"
            }
          />
          <SummaryCard
            label="QRIS"
            value={formatRupiah(paidQris)}
            sub={`${paid.filter((t) => t.paymentMethod === "qris").length} trx`}
          />
          <SummaryCard
            label="Kartu BCA"
            value={formatRupiah(paidCard)}
            sub={`${paid.filter((t) => t.paymentMethod === "card_bca").length} trx`}
          />
          <SummaryCard
            label="Total Transaksi"
            value={String(paid.length)}
            sub={`${voided.length} void · ${refunded.length} refund`}
          />
        </div>

        {shift.notes ? (
          <div className="rounded-md bg-neutral-100 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              Catatan
            </p>
            <p className="mt-1 text-sm text-neutral-900">{shift.notes}</p>
          </div>
        ) : null}

        {/* Transactions list */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Daftar Transaksi ({transactions.length})
          </h3>
          {loading ? (
            <div className="space-y-2" role="status" aria-label="Memuat transaksi">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-500">
              Belum ada transaksi.
            </p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto rounded-md border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Waktu</th>
                    <th className="px-3 py-2 text-left font-medium">No.</th>
                    <th className="px-3 py-2 text-center font-medium">P</th>
                    <th className="px-3 py-2 text-left font-medium">Metode</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {transactions.map((trx) => (
                    <tr
                      key={trx.id}
                      className={cn(
                        trx.status === "voided" && "opacity-50 line-through",
                      )}
                    >
                      <td className="px-3 py-2 text-xs text-neutral-700">
                        {formatIndonesianTime(trx.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {trx.transactionNumber}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {trx.pagerNumber}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {trx.paymentMethod === "cash"
                          ? "Tunai"
                          : trx.paymentMethod === "qris"
                            ? "QRIS"
                            : "Kartu"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatRupiah(trx.total)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {trx.status === "paid" ? (
                          <Badge variant="paid">Lunas</Badge>
                        ) : trx.status === "voided" ? (
                          <Badge variant="voided">Void</Badge>
                        ) : (
                          <Badge variant="refunded">Refund</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-base font-bold text-neutral-900">
        {value}
      </p>
      {sub ? <p className="text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}
