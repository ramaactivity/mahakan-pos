"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Wallet,
} from "lucide-react";
import { Badge, Button, Modal, Skeleton } from "@/components/ui";
import { isOk, listTransactions, type Transaction } from "@/features/transactions";
import {
  getShiftPettyBreakdown,
  type Shift,
  type ShiftPettyBreakdown,
} from "@/features/shifts";
import { ShiftRebalanceModal } from "@/features/shifts/components/ShiftRebalanceModal";
import { CorrectOpeningCashModal } from "@/features/pos/components/CorrectOpeningCashModal";
import {
  isOk as isCashOk,
  listExpenseCategories,
  listExpenses,
  listIncomes,
  type Expense,
  type ExpenseCategory,
  type Income,
} from "@/features/cash";
import { toJakartaDateOnly } from "@/lib/date";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import type { PublicUser } from "@/features/users";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime, formatIndonesianTime } from "@/lib/date";
import { cn } from "@/lib/utils";

interface ShiftDetailModalProps {
  shift: Shift | null;
  user: PublicUser | null;
  onClose: () => void;
  /** Optional callback to refetch shift list after rebalance request. */
  onRebalanceRequested?: () => void;
}

export function ShiftDetailModal({
  shift,
  user,
  onClose,
  onRebalanceRequested,
}: ShiftDetailModalProps) {
  const { session } = useSession();
  const role = session?.user.role ?? "staff";
  const canRequestRebalance = hasPermission(role, "shift.rebalance.request");
  /* Sesi AE-167 — koreksi kas awal (owner/manager langsung). */
  const canCorrectOpening = hasPermission(role, "shift.opening_cash.correct");
  const [rebalanceOpen, setRebalanceOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [petty, setPetty] = useState<ShiftPettyBreakdown | null>(null);
  /* Sesi AE-65 — petty cash transaction-level detail (per shift date range).
   * Owner pakai untuk trace selisih variance ke entry spesifik yang
   * mungkin missing/extra. */
  const [shiftExpenses, setShiftExpenses] = useState<Expense[]>([]);
  const [shiftIncomes, setShiftIncomes] = useState<Income[]>([]);
  const [categoriesById, setCategoriesById] = useState<Map<string, ExpenseCategory>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [showVoidRefund, setShowVoidRefund] = useState(false);
  const [showPettyCash, setShowPettyCash] = useState(true);

  useEffect(() => {
    if (!shift) return;
    let cancelled = false;
    // Sync from prop change (modal re-opened with new shift)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPetty(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShiftExpenses([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShiftIncomes([]);
    async function load() {
      const fromDate = toJakartaDateOnly(shift!.openedAt);
      const toDate = toJakartaDateOnly(shift!.closedAt ?? new Date());
      const [trxRes, pettyRes, expRes, incRes, catRes] = await Promise.all([
        listTransactions({ shiftId: shift!.id, limit: 1000 }),
        getShiftPettyBreakdown(shift!.id),
        listExpenses({
          from: fromDate,
          to: toDate,
          paymentMethod: "cash",
          limit: 200,
        }),
        listIncomes({
          from: fromDate,
          to: toDate,
          paymentMethod: "cash",
          limit: 200,
        }),
        listExpenseCategories(),
      ]);
      if (cancelled) return;
      if (isOk(trxRes)) setTransactions(trxRes.data.items);
      if (isOk(pettyRes)) setPetty(pettyRes.data);
      if (isCashOk(expRes)) setShiftExpenses(expRes.data.items);
      if (isCashOk(incRes)) setShiftIncomes(incRes.data.items);
      if (isCashOk(catRes)) {
        const map = new Map<string, ExpenseCategory>();
        for (const c of catRes.data.items) map.set(c.id, c);
        setCategoriesById(map);
      }
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

  // Sesi AE-64 — variance breakdown formula lengkap (mirror computeExpectedCash):
  //   expectedCash = openingCash + paidCash - refundedCash
  //                  - pettyExpenseCash + pettyIncomeCash
  // Pre-AE64, formula display di sini SKIP petty cash sehingga Kas Harusnya
  // tampak salah (cuma openingCash + paidCash) — staff bingung lihat
  // "Kas Harusnya = Kas Aktual tapi Variance != 0". Sekarang fetch petty
  // dari server (sumber tunggal: sama dengan closeShift).
  const openingCash = shift.openingCash;
  const pettyExpenseCash = petty?.pettyExpenseCash ?? 0;
  const pettyIncomeCash = petty?.pettyIncomeCash ?? 0;
  const expectedCashEstimate =
    openingCash + paidCash - refundedCashSum - pettyExpenseCash + pettyIncomeCash;
  const actualCash = shift.actualCash ?? 0;
  const variance = shift.variance ?? actualCash - expectedCashEstimate;

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
    <>
    <Modal
      open={shift !== null}
      onClose={onClose}
      title={`Shift ${user?.name ?? ""}`}
      description={`Mulai ${formatIndonesianDateTime(shift.openedAt)}${
        shift.closedAt ? ` · Tutup ${formatIndonesianDateTime(shift.closedAt)}` : ""
      }`}
      size="3xl"
    >
      <div className="space-y-4">
        {/* Status + variance badge + Rebalance button */}
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
          {/* Sesi AE-62o — Suggest Correction (manager/owner only, untuk shift closed) */}
          {shift.status === "closed" && canRequestRebalance ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRebalanceOpen(true)}
              className="ml-auto"
              title="Ajukan koreksi shift dengan approval Owner"
            >
              <Pencil className="size-4" aria-hidden /> Suggest Correction
            </Button>
          ) : null}
          {/* Sesi AE-167 — koreksi kas awal langsung (owner/manager). */}
          {canCorrectOpening ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCorrectOpen(true)}
              className={shift.status === "closed" && canRequestRebalance ? "" : "ml-auto"}
              title="Koreksi kas awal yang salah input saat buka shift"
            >
              <Wallet className="size-4" aria-hidden /> Koreksi Kas Awal
            </Button>
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

        {/* Sesi AE-64 — Variance breakdown formula lengkap (with petty cash) */}
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
              {pettyExpenseCash > 0 ? (
                <FormulaRow
                  label={`Pengeluaran Tunai${petty && petty.pettyExpenseCashCount > 0 ? ` (${petty.pettyExpenseCashCount}×)` : ""}`}
                  value={pettyExpenseCash}
                  sign="-"
                />
              ) : null}
              {pettyIncomeCash > 0 ? (
                <FormulaRow
                  label={`Pemasukan Tunai${petty && petty.pettyIncomeCashCount > 0 ? ` (${petty.pettyIncomeCashCount}×)` : ""}`}
                  value={pettyIncomeCash}
                  sign="+"
                />
              ) : null}
              <div className="my-1 border-t border-neutral-200" />
              <FormulaRow
                label="Kas Harusnya (perkiraan)"
                value={expectedCashEstimate}
                bold
              />
              <FormulaRow label="Kas Aktual (lapor kasir)" value={actualCash} bold />
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
                <span>Selisih (Aktual − Harusnya)</span>
                <span>
                  {variance >= 0 ? "+" : ""}
                  {formatRupiah(variance)}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-neutral-500">
                {variance > 0
                  ? "Laci kelebihan — bisa jadi pengeluaran tunai belum dicatat, atau ada uang masuk yang belum tercatat. Cek daftar Pengeluaran/Pemasukan Tunai di bawah."
                  : variance < 0
                    ? "Laci kurang — bisa jadi penjualan tunai belum diketuk, atau ada uang keluar belum dicatat. Cek daftar Pengeluaran/Pemasukan Tunai di bawah."
                    : "Kas pas — semua arus tunai sudah tercatat ✓"}
              </p>
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

        {/* Sesi AE-65 — Petty Cash transaction-level detail (Pengeluaran + Pemasukan Tunai).
         * Tujuan: owner trace selisih variance ke entry spesifik yang mungkin
         * missing/extra. Collapsible default-open kalau ada selisih > 10k,
         * default-collapsed kalau kas pas (declutter). */}
        {shift.status === "closed" && (shiftExpenses.length > 0 || shiftIncomes.length > 0) ? (
          <section className="rounded-md border border-neutral-200 bg-white">
            <button
              type="button"
              onClick={() => setShowPettyCash((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 hover:bg-neutral-50"
            >
              <span className="flex items-center gap-2">
                <Wallet className="size-4" aria-hidden />
                Pengeluaran & Pemasukan Tunai (
                {shiftExpenses.length + shiftIncomes.length})
              </span>
              {showPettyCash ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
            {showPettyCash ? (
              <div className="border-t border-neutral-200">
                <p className="px-3 py-2 text-[11px] text-neutral-600">
                  Daftar arus tunai non-POS dalam range shift{" "}
                  <span className="font-mono">
                    {toJakartaDateOnly(shift.openedAt)}
                  </span>{" "}
                  →{" "}
                  <span className="font-mono">
                    {toJakartaDateOnly(shift.closedAt ?? new Date())}
                  </span>
                  . Kalau ada entry yang missing / kelebihan, di sinilah
                  variance datang.
                </p>
                {shiftExpenses.length > 0 ? (
                  <PettyTable
                    title={`Pengeluaran Tunai (${shiftExpenses.length})`}
                    titleIcon={<ArrowUpCircle className="size-3.5 text-danger-500" aria-hidden />}
                    rows={shiftExpenses.map((e) => ({
                      id: e.id,
                      date: e.expenseDate,
                      time: formatIndonesianTime(e.createdAt),
                      categoryLabel:
                        categoriesById.get(e.categoryId)?.name ?? "—",
                      isSystemCategory:
                        categoriesById.get(e.categoryId)?.isSystem ?? false,
                      description: e.description,
                      amount: Number(e.amount),
                      sourceType: e.sourceType,
                    }))}
                    direction="out"
                  />
                ) : null}
                {shiftIncomes.length > 0 ? (
                  <PettyTable
                    title={`Pemasukan Tunai (${shiftIncomes.length})`}
                    titleIcon={<ArrowDownCircle className="size-3.5 text-mahakan-green-700" aria-hidden />}
                    rows={shiftIncomes.map((i) => ({
                      id: i.id,
                      date: i.incomeDate,
                      time: formatIndonesianTime(i.createdAt),
                      categoryLabel: null,
                      isSystemCategory: false,
                      description: i.description,
                      amount: Number(i.amount),
                      sourceType: null,
                    }))}
                    direction="in"
                  />
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
    {/* Sesi AE-62o — Rebalance request modal. Reuse for kasir + manager.
     * Sesi AE-64 — Pass petty cash + cash flow breakdown supaya rebalance
     * modal bisa auto-suggest Kas Aktual sesuai formula. */}
    <ShiftRebalanceModal
      open={rebalanceOpen}
      shift={shift}
      source="manager_backoffice"
      expectedCash={expectedCashEstimate}
      posActualQris={paidQris}
      posActualCardBca={paidCard}
      paidCash={paidCash}
      refundedCash={refundedCashSum}
      pettyExpenseCash={pettyExpenseCash}
      pettyIncomeCash={pettyIncomeCash}
      onClose={() => setRebalanceOpen(false)}
      onSubmitted={() => {
        setRebalanceOpen(false);
        onRebalanceRequested?.();
      }}
    />
    {/* Sesi AE-167 — koreksi kas awal (owner/manager langsung). */}
    <CorrectOpeningCashModal
      open={correctOpen}
      shiftId={shift.id}
      currentOpeningCash={shift.openingCash}
      shiftClosed={shift.status === "closed"}
      onClose={() => setCorrectOpen(false)}
      onCorrected={() => {
        setCorrectOpen(false);
        onRebalanceRequested?.();
        onClose();
      }}
    />
    </>
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

interface PettyRow {
  id: string;
  date: string;
  time: string;
  categoryLabel: string | null;
  isSystemCategory: boolean;
  description: string;
  amount: number;
  /** Sumber entry (manual/purchase/payroll/refund) — null untuk income. */
  sourceType: string | null;
}

function PettyTable({
  title,
  titleIcon,
  rows,
  direction,
}: {
  title: string;
  titleIcon?: React.ReactNode;
  rows: PettyRow[];
  /** out = expense (kurangi laci), in = income (tambah laci). */
  direction: "out" | "in";
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const amountColor = direction === "out" ? "text-danger-500" : "text-mahakan-green-700";
  return (
    <div className="border-t border-neutral-200">
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
        <span className="flex items-center gap-1.5">
          {titleIcon}
          {title}
        </span>
        <span className={cn("font-mono normal-case tracking-normal", amountColor)}>
          {direction === "out" ? "−" : "+"}
          {formatRupiah(total)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-neutral-100 bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Waktu</th>
              {direction === "out" ? (
                <th className="px-3 py-1.5 text-left font-medium">Kategori</th>
              ) : null}
              <th className="px-3 py-1.5 text-left font-medium">Deskripsi</th>
              {direction === "out" ? (
                <th className="px-3 py-1.5 text-left font-medium">Sumber</th>
              ) : null}
              <th className="px-3 py-1.5 text-right font-medium">Nominal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5 text-xs">
                  <span className="font-mono text-neutral-600">{r.date}</span>
                  <span className="ml-1 text-neutral-400">·</span>
                  <span className="ml-1 text-neutral-600">{r.time}</span>
                </td>
                {direction === "out" ? (
                  <td className="px-3 py-1.5 text-xs">
                    {r.categoryLabel ? (
                      <Badge
                        variant={r.isSystemCategory ? "warning" : "neutral"}
                        className="!text-[10px]"
                      >
                        {r.categoryLabel}
                      </Badge>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                ) : null}
                <td className="px-3 py-1.5 text-xs text-neutral-700">
                  {r.description || (
                    <span className="text-neutral-400">(tanpa deskripsi)</span>
                  )}
                </td>
                {direction === "out" ? (
                  <td className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
                    {r.sourceType ?? "manual"}
                  </td>
                ) : null}
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-mono text-xs font-medium",
                    amountColor,
                  )}
                >
                  {direction === "out" ? "−" : "+"}
                  {formatRupiah(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
