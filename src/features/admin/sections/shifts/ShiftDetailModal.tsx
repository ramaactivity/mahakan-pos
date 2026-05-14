"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Wallet } from "lucide-react";
import { Badge, Modal, Skeleton } from "@/components/ui";
import { isOk, listTransactions, type Transaction } from "@/features/transactions";
import type { Shift } from "@/features/shifts";
import type { PublicUser } from "@/features/users";
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
  const [showVoidRefund, setShowVoidRefund] = useState(false);

  useEffect(() => {
    if (!shift) return;
    let cancelled = false;
    // Sync from prop change (modal re-opened with new shift)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    async function load() {
      const res = await listTransactions({
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

  const paid = transactions.filter(
    (t) => t.status === "paid" || t.status === "partially_refunded",
  );
  const voided = transactions.filter((t) => t.status === "voided");
  const refunded = transactions.filter(
    (t) =>
      t.status === "refunded" ||
      (t.status === "partially_refunded" && t.refundedAmount > 0),
  );

  const netTotal = (t: Transaction) => t.total - t.refundedAmount;
  const paidCash = paid
    .filter((t) => t.paymentMethod === "cash")
    .reduce((s, t) => s + netTotal(t), 0);
  const paidQris = paid
    .filter((t) => t.paymentMethod === "qris")
    .reduce((s, t) => s + netTotal(t), 0);
  const paidCard = paid
    .filter(
      (t) =>
        t.paymentMethod !== "cash" &&
        t.paymentMethod !== "qris" &&
        t.paymentMethod !== "split",
    )
    .reduce((s, t) => s + netTotal(t), 0);
  const refundedCashSum = refunded
    .filter((t) => t.paymentMethod === "cash")
    .reduce((s, t) => s + t.refundedAmount, 0);

  // Sesi AE-56 — variance breakdown formula (mirror computeExpectedCash AE-49):
  //   expectedCash = openingCash + paidCash - refundedCash
  //                  - pettyExpenseCash + pettyIncomeCash
  // Petty cash details not fetched here (defer to drill-down or POS modal).
  const openingCash = shift.openingCash;
  const expectedCashEstimate =
    openingCash + paidCash - refundedCashSum;
  const actualCash = shift.actualCash ?? 0;
  const variance = shift.variance ?? actualCash - expectedCashEstimate;
  // Component yang dihitung dari transactions, dipakai untuk kasih hint.
  // Variance "tidak teridentifikasi" = variance - components yang explicit.
  const unexplainedVariance = (shift.variance ?? 0) - 0; // placeholder for future petty breakdown

  const edcSettlement = (shift as { edcSettlement?: number | null }).edcSettlement ?? null;
  const gofoodSettlement = (shift as { gofoodSettlement?: number | null }).gofoodSettlement ?? null;
  const grabfoodSettlement = (shift as { grabfoodSettlement?: number | null }).grabfoodSettlement ?? null;
  const shopeefoodSettlement = (shift as { shopeefoodSettlement?: number | null }).shopeefoodSettlement ?? null;
  const qrisSettlement = (shift as { qrisSettlement?: number | null }).qrisSettlement ?? null;
  const handoverMessage = (shift as { handoverMessage?: string | null }).handoverMessage ?? null;
  const hasAnyAggregator =
    (edcSettlement ?? 0) > 0 ||
    (gofoodSettlement ?? 0) > 0 ||
    (grabfoodSettlement ?? 0) > 0 ||
    (shopeefoodSettlement ?? 0) > 0;

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
        {/* Status + variance badge */}
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

        {/* Handover message (kalau ada) */}
        {handoverMessage ? (
          <div className="rounded-md border border-info-100 bg-info-100/40 p-3 text-sm text-info-500">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
              Pesan untuk shift berikutnya
            </p>
            <p className="mt-1 text-neutral-900">{handoverMessage}</p>
          </div>
        ) : null}

        {/* Sesi AE-56 — Variance breakdown formula */}
        {shift.status === "closed" ? (
          <section className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Ringkasan Kas (Formula Variance)
            </h3>
            <div className="mt-2 space-y-1 font-mono text-sm">
              <FormulaRow label="Kas Awal" value={openingCash} sign="+" />
              <FormulaRow label="Penjualan Tunai" value={paidCash} sign="+" />
              {refundedCashSum > 0 ? (
                <FormulaRow
                  label="Refund Tunai"
                  value={refundedCashSum}
                  sign="-"
                />
              ) : null}
              <div className="my-1 border-t border-neutral-200" />
              <FormulaRow
                label="Kas Harusnya (perkiraan)"
                value={expectedCashEstimate}
                bold
              />
              <FormulaRow label="Kas Aktual" value={actualCash} bold />
              <div className="my-1 border-t border-neutral-200" />
              <div
                className={cn(
                  "flex items-center justify-between font-semibold",
                  Math.abs(variance) > 10_000
                    ? "text-danger-500"
                    : variance === 0
                      ? "text-mahakan-green-700"
                      : "text-warning-500",
                )}
              >
                <span>Variance</span>
                <span>
                  {variance >= 0 ? "+" : ""}
                  {formatRupiah(variance)}
                </span>
              </div>
              {Math.abs(unexplainedVariance) > 1000 ? (
                <p className="mt-1 text-[10px] text-neutral-500">
                  Untuk audit lengkap (petty cash + refund detail), buka
                  Audit Log atau Petty Cash di POS.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Summary grid */}
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard
            label="Kas Awal"
            value={formatRupiah(shift.openingCash)}
          />
          <SummaryCard
            label="Penjualan Tunai (net)"
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
            label="QRIS (net)"
            value={formatRupiah(paidQris)}
            sub={`${paid.filter((t) => t.paymentMethod === "qris").length} trx`}
          />
          <SummaryCard
            label="Kartu Semua Bank"
            value={formatRupiah(paidCard)}
            sub={`${paid.filter((t) => t.paymentMethod !== "cash" && t.paymentMethod !== "qris" && t.paymentMethod !== "split").length} trx`}
          />
          <SummaryCard
            label="Total Transaksi"
            value={String(paid.length)}
            sub={`${voided.length} void · ${refunded.length} refund`}
            tone={voided.length + refunded.length > 0 ? "warn" : undefined}
          />
        </div>

        {/* Sesi AE-56 — Settlement Aggregator (kasir-reported saat close-shift) */}
        {shift.status === "closed" ? (
          <section className="rounded-md border border-neutral-200 bg-white p-3">
            <header className="mb-2 flex items-center gap-2">
              <Wallet className="size-4 text-neutral-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Settlement Channel (Kasir Lapor)
              </h3>
            </header>
            {!hasAnyAggregator && qrisSettlement === null ? (
              <p className="text-xs text-neutral-500">
                Kasir tidak melaporkan settlement aggregator di shift ini.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <SettlementCard
                  label="QRIS"
                  value={qrisSettlement}
                  hint="Auto-fill dari transaksi"
                />
                <SettlementCard label="EDC (BCA)" value={edcSettlement} />
                <SettlementCard label="GoFood" value={gofoodSettlement} />
                <SettlementCard label="GrabFood" value={grabfoodSettlement} />
                <SettlementCard label="ShopeeFood" value={shopeefoodSettlement} />
              </div>
            )}
          </section>
        ) : null}

        {/* Refund/Void detail (collapsible kalau ada) */}
        {voided.length + refunded.length > 0 ? (
          <section className="rounded-md border border-neutral-200 bg-white">
            <button
              type="button"
              onClick={() => setShowVoidRefund((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 hover:bg-neutral-50"
            >
              <span>
                Refund & Void Detail ({voided.length + refunded.length})
              </span>
              {showVoidRefund ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
            {showVoidRefund ? (
              <div className="border-t border-neutral-200 px-3 py-2">
                {voided.length > 0 ? (
                  <div className="mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-danger-500">
                      Void ({voided.length})
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {voided.map((t) => (
                        <li
                          key={t.id}
                          className="flex justify-between text-neutral-700"
                        >
                          <span className="font-mono">{t.transactionNumber}</span>
                          <span className="font-mono text-danger-500">
                            -{formatRupiah(t.total)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {refunded.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-warning-500">
                      Refund ({refunded.length})
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {refunded.map((t) => (
                        <li
                          key={t.id}
                          className="flex justify-between text-neutral-700"
                        >
                          <span className="font-mono">{t.transactionNumber}</span>
                          <span className="font-mono text-warning-500">
                            -{formatRupiah(t.refundedAmount)} (
                            {t.paymentMethod === "cash"
                              ? "Tunai"
                              : t.paymentMethod === "qris"
                                ? "QRIS"
                                : "Kartu"}
                            )
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

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
                        {trx.pagerNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {trx.paymentMethod === "cash"
                          ? "Tunai"
                          : trx.paymentMethod === "qris"
                            ? "QRIS"
                            : trx.paymentMethod === "split"
                              ? "Split"
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
                        ) : trx.status === "partially_refunded" ? (
                          <Badge variant="refunded">Refund Sebagian</Badge>
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

function FormulaRow({
  label,
  value,
  sign,
  bold,
}: {
  label: string;
  value: number;
  sign?: "+" | "-";
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        bold ? "font-semibold text-neutral-900" : "text-neutral-700",
      )}
    >
      <span className="text-xs">{label}</span>
      <span>
        {sign === "-" ? "-" : sign === "+" ? "+" : ""}
        {formatRupiah(value)}
      </span>
    </div>
  );
}

function SettlementCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  const isNull = value === null;
  return (
    <div
      className={cn(
        "rounded-md border p-2",
        isNull
          ? "border-neutral-200 bg-neutral-50"
          : value === 0
            ? "border-neutral-200 bg-white"
            : "border-mahakan-green-100 bg-mahakan-green-50",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-sm font-bold",
          isNull ? "text-neutral-400" : "text-neutral-900",
        )}
      >
        {isNull ? "—" : formatRupiah(value)}
      </p>
      {hint ? (
        <p className="text-[10px] text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-base font-bold",
          tone === "warn" ? "text-warning-500" : "text-neutral-900",
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}
