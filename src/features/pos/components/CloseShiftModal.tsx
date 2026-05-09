"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Receipt,
  RefreshCw,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Modal,
  NumericInput,
  Spinner,
  toast,
} from "@/components/ui";
import { isOk, closeShift, type Shift } from "@/features/shifts";
import { listTransactions } from "@/features/transactions";
import { getDailyCashSummary } from "@/features/cash";
import { listLowStockIngredients } from "@/features/purchase-requests/actions";
import type { LowStockIngredient } from "@/features/purchase-requests/types";
import { getOwnOutlet } from "@/features/outlets";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BelanjaSubmissionModal } from "./BelanjaSubmissionModal";

const VARIANCE_THRESHOLD = 10_000;
const QUICK_AMOUNTS = [50_000, 100_000, 200_000, 500_000];

interface SummaryPreview {
  paid: { count: number; cash: number; qris: number; cardBca: number };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
  /** Galih ask #11: petty-cash recap during the shift (today's day for
   * approximation, since expenses/incomes don't carry shift_id). */
  petty: {
    expensesTotal: number;
    expensesCount: number;
    incomesTotal: number;
    incomesCount: number;
  };
}

interface CloseShiftModalProps {
  open: boolean;
  shift: Shift;
  userId: string;
  onClose: () => void;
  onClosed: () => void;
}

/**
 * Close-shift form — sesi AD-8b redesign.
 *
 * OLD: size="lg" centered with all sections stacked vertically. NumericInput
 * popups stack on top of each other when filled. Kasir scroll banyak.
 *
 * NEW: size="fullscreen" 2-col mirror of PaymentModal pattern.
 *   LEFT 5fr (~558px on tablet 1340): always-visible summary +
 *     variance indicator. Kasir bisa pantau Kas Harusnya + Variance
 *     selalu visible saat ngetik kas aktual.
 *   RIGHT 7fr (~782px): input form
 *     - "Kas Aktual" hero panel with big display + custom numpad 3x4
 *       + quick amounts (mirror PaymentModal CashInputPanel)
 *     - Settlement Channel 2x2 grid (compact NumericInputs)
 *     - Setoran Owner collapsible
 *     - Notes + Handover textarea at bottom
 *
 * Open bills blocker: takes over LEFT column with full warning + bill
 * list, RIGHT column hidden. Mirror old behavior.
 */
export function CloseShiftModal({
  open,
  shift,
  onClose,
  onClosed,
}: CloseShiftModalProps) {
  const [summary, setSummary] = useState<SummaryPreview | null>(null);
  const [openBills, setOpenBills] = useState<
    Array<{
      id: string;
      transactionNumber: string;
      pagerNumber: number | null;
      total: number;
    }>
  >([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [edc, setEdc] = useState("");
  const [gofood, setGofood] = useState("");
  const [grabfood, setGrabfood] = useState("");
  const [shopeefood, setShopeefood] = useState("");
  const [handoverMessage, setHandoverMessage] = useState("");
  // Phase 2.4 — setoran ke owner saat tutup shift
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositBank, setDepositBank] = useState("");
  const [depositNotes, setDepositNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 6.5 (sesi AC-3) — belanja submission step setelah closeShift sukses.
  const [belanjaOpen, setBelanjaOpen] = useState(false);
  const [lowStock, setLowStock] = useState<LowStockIngredient[]>([]);
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setActualCash("");
    setNotes("");
    setEdc("");
    setGofood("");
    setGrabfood("");
    setShopeefood("");
    setHandoverMessage("");
    setDepositOpen(false);
    setDepositAmount("");
    setDepositBank("");
    setDepositNotes("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */

    async function load() {
      const [trxRes, cashRes] = await Promise.all([
        listTransactions({ shiftId: shift.id, limit: 1000 }),
        getDailyCashSummary(),
      ]);
      if (cancelled) return;
      if (!isOk(trxRes)) {
        setLoading(false);
        return;
      }
      const items = trxRes.data.items;
      const open = items
        .filter((t) => t.status === "open")
        .map((t) => ({
          id: t.id,
          transactionNumber: t.transactionNumber,
          pagerNumber: t.pagerNumber,
          total: t.total,
        }));
      setOpenBills(open);
      const paid = items.filter((t) => t.status === "paid");
      const voided = items.filter((t) => t.status === "voided");
      const refunded = items.filter((t) => t.status === "refunded");

      const paidCash = paid
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.total, 0);
      const refundedCash = refunded
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.total, 0);

      const cashSummary = isOk(cashRes) ? cashRes.data : null;

      setSummary({
        paid: {
          count: paid.length,
          cash: paidCash,
          qris: paid
            .filter((t) => t.paymentMethod === "qris")
            .reduce((s, t) => s + t.total, 0),
          cardBca: paid
            .filter((t) => t.paymentMethod === "card_bca")
            .reduce((s, t) => s + t.total, 0),
        },
        voided: {
          count: voided.length,
          totalAmount: voided.reduce((s, t) => s + t.total, 0),
        },
        refunded: {
          count: refunded.length,
          totalAmount: refunded.reduce((s, t) => s + t.total, 0),
        },
        expectedCash: shift.openingCash + paidCash - refundedCash,
        petty: {
          expensesTotal: cashSummary?.expenses.total ?? 0,
          expensesCount:
            cashSummary?.expenses.byCategory.reduce(
              (s, c) => s + c.count,
              0,
            ) ?? 0,
          incomesTotal: cashSummary?.income.manual.total ?? 0,
          incomesCount: cashSummary?.income.manual.count ?? 0,
        },
      });
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, shift, refreshKey]);

  const parsedCash = useMemo(() => {
    try {
      return parseRupiah(actualCash || "0");
    } catch {
      return 0;
    }
  }, [actualCash]);

  const variance = summary ? parsedCash - summary.expectedCash : 0;
  const varianceFlag =
    Math.abs(variance) > VARIANCE_THRESHOLD ? "warn" : "ok";

  const parsedDepositPreview = useMemo(() => {
    try {
      return depositAmount.trim().length > 0
        ? parseRupiah(depositAmount)
        : 0;
    } catch {
      return 0;
    }
  }, [depositAmount]);

  async function onSubmit() {
    if (submitting || !summary) return;
    if (parsedCash < 0) {
      setError("Kas aktual tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError(null);

    const tryParse = (s: string): number | null => {
      const trimmed = s.trim();
      if (trimmed.length === 0) return null;
      try {
        const n = parseRupiah(trimmed);
        return n >= 0 ? n : null;
      } catch {
        return null;
      }
    };

    const parsedDeposit = tryParse(depositAmount);
    const res = await closeShift({
      shiftId: shift.id,
      actualCash: parsedCash,
      notes: notes.trim() || null,
      handoverMessage: handoverMessage.trim() || null,
      edcSettlement: tryParse(edc),
      gofoodSettlement: tryParse(gofood),
      grabfoodSettlement: tryParse(grabfood),
      shopeefoodSettlement: tryParse(shopeefood),
      depositAmount: parsedDeposit,
      depositBankDestination: depositBank.trim() || null,
      depositNotes: depositNotes.trim() || null,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    if (variance < 0) {
      toast.warning(`Selisih minus ${formatRupiah(Math.abs(variance))}`);
    } else if (variance > 0) {
      toast.info(`Selisih plus ${formatRupiah(variance)}`);
    } else {
      toast.success("Shift ditutup, kas pas!");
    }
    if (res.data.summary.depositId) {
      toast.info(
        `Setoran ${formatRupiah(parsedDeposit ?? 0)} pending verifikasi owner`,
      );
    }

    const [lowStockRes, outletRes] = await Promise.all([
      listLowStockIngredients(),
      getOwnOutlet(),
    ]);
    const lowStockItems =
      lowStockRes.success && lowStockRes.data.length > 0
        ? lowStockRes.data
        : [];
    if (lowStockItems.length > 0) {
      setLowStock(lowStockItems);
      setOwnerPhone(outletRes.success ? outletRes.data.phone : null);
      setBelanjaOpen(true);
      setSubmitting(false);
      return;
    }

    onClosed();
  }

  function handleBelanjaClose() {
    setBelanjaOpen(false);
    onClosed();
  }

  const blockedByOpenBills = openBills.length > 0;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Tutup Shift"
        description={
          blockedByOpenBills
            ? "Ada bill belum dibayar — selesaikan dulu sebelum tutup shift."
            : "Hitung kas fisik di laci, bandingkan dengan Kas Harusnya."
        }
        size="fullscreen"
        bodyPadding="none"
        disableEscClose={submitting}
        footer={
          blockedByOpenBills ? (
            <div className="flex w-full items-center justify-between gap-3">
              <Button variant="ghost" onClick={onClose} disabled={loading}>
                Tutup
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={loading}
              >
                <RefreshCw className="size-4" /> Cek Ulang
              </Button>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between gap-3">
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                Batal
              </Button>
              <Button
                onClick={onSubmit}
                loading={submitting}
                disabled={loading || actualCash.trim().length === 0}
                size="xl"
                className="!h-12 min-w-[200px] touch:min-w-[260px] !text-base"
              >
                {submitting ? "Memproses…" : "Tutup Shift"}
              </Button>
            </div>
          )
        }
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : blockedByOpenBills ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
            <div className="rounded-xl border border-warning-300 bg-warning-100 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 size-5 text-warning-500"
                  aria-hidden
                />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-warning-500">
                    {openBills.length} bill belum dibayar
                  </p>
                  <p className="text-xs text-neutral-700">
                    Tutup shift di-block sampai bill ini diselesaikan (bayar)
                    atau dibatalkan. Cek tab <strong>Bill Aktif</strong> di
                    POS untuk lanjut bayar.
                  </p>
                </div>
              </div>
            </div>
            <ul className="space-y-2">
              {openBills.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm"
                >
                  <span className="flex items-center gap-2 font-medium text-neutral-900">
                    <Receipt className="size-4 text-neutral-600" aria-hidden />
                    {b.transactionNumber}
                    {b.pagerNumber !== null ? (
                      <Badge variant="neutral">Pager {b.pagerNumber}</Badge>
                    ) : null}
                  </span>
                  <span className="font-mono font-semibold text-neutral-900">
                    {formatRupiah(b.total)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs italic text-neutral-600">
              Sudah selesai semua? Tap <strong>Cek Ulang</strong> di footer
              untuk refresh status.
            </p>
          </div>
        ) : !summary ? (
          <p className="p-5 text-sm text-danger-500">Gagal load summary</p>
        ) : (
          <div className="grid h-full divide-y divide-neutral-200 lg:grid-cols-[5fr_7fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
            {/* ============================================================ */}
            {/* LEFT — Summary + variance                                    */}
            {/* ============================================================ */}
            <aside className="flex flex-col gap-3 overflow-y-auto bg-neutral-50 p-4 touch:p-3">
              <section className="rounded-xl border border-neutral-200 bg-white p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
                  Ringkasan Shift
                </h3>
                <div className="space-y-1.5 text-sm">
                  <SummaryRow
                    label="Kas Awal"
                    value={formatRupiah(shift.openingCash)}
                  />
                  <SummaryRow
                    label={`Penjualan Tunai (${summary.paid.count} trx)`}
                    value={`+ ${formatRupiah(summary.paid.cash)}`}
                  />
                  <SummaryRow
                    label="QRIS"
                    value={formatRupiah(summary.paid.qris)}
                    muted
                  />
                  <SummaryRow
                    label="Kartu BCA"
                    value={formatRupiah(summary.paid.cardBca)}
                    muted
                  />
                  {summary.voided.count > 0 ? (
                    <SummaryRow
                      label={`Void (${summary.voided.count} trx)`}
                      value={formatRupiah(summary.voided.totalAmount)}
                      muted
                    />
                  ) : null}
                  {summary.refunded.count > 0 ? (
                    <SummaryRow
                      label={`Refund Tunai (${summary.refunded.count} trx)`}
                      value={`- ${formatRupiah(summary.refunded.totalAmount)}`}
                    />
                  ) : null}
                  <div className="my-2 border-t border-dashed border-neutral-200" />
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold text-neutral-900">
                      Kas Harusnya
                    </span>
                    <span className="font-mono text-xl font-bold text-mahakan-green-900">
                      {formatRupiah(summary.expectedCash)}
                    </span>
                  </div>
                </div>
              </section>

              {/* Variance live indicator */}
              <section
                className={cn(
                  "flex items-center gap-2 rounded-xl border-2 p-3 text-sm",
                  parsedCash <= 0
                    ? "border-neutral-200 bg-neutral-100 text-neutral-600"
                    : variance === 0
                      ? "border-success-500 bg-success-100 text-success-500"
                      : varianceFlag === "warn"
                        ? "border-danger-500 bg-danger-100 text-danger-500"
                        : "border-warning-500 bg-warning-100 text-warning-500",
                )}
              >
                {parsedCash <= 0 ? (
                  <span className="flex w-full items-center justify-between">
                    <span>Selisih</span>
                    <span className="font-mono italic">
                      Isi kas aktual dulu
                    </span>
                  </span>
                ) : (
                  <>
                    {variance === 0 ? (
                      <CheckCircle2 className="size-5" />
                    ) : (
                      <AlertTriangle className="size-5" />
                    )}
                    <span className="flex flex-1 items-baseline justify-between">
                      <span className="font-semibold">
                        {variance === 0
                          ? "Pas, kas seimbang"
                          : variance > 0
                            ? "Selisih plus"
                            : "Selisih minus"}
                      </span>
                      <span className="font-mono text-base font-bold">
                        {variance >= 0 ? "+" : ""}
                        {formatRupiah(variance)}
                      </span>
                    </span>
                  </>
                )}
              </section>

              {varianceFlag === "warn" && parsedCash > 0 ? (
                <p className="text-[11px] text-danger-500">
                  ⚠ Selisih lebih dari{" "}
                  {formatRupiah(VARIANCE_THRESHOLD)}. Recheck jumlah cash
                  drawer atau catat alasan di bawah.
                </p>
              ) : null}

              {summary.petty.expensesCount > 0 ||
              summary.petty.incomesCount > 0 ? (
                <section className="rounded-xl border border-neutral-200 bg-white p-3">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-600">
                    Petty Cash Hari Ini
                  </h3>
                  {summary.petty.incomesCount > 0 ? (
                    <SummaryRow
                      label={`Pemasukan (${summary.petty.incomesCount}×)`}
                      value={`+ ${formatRupiah(summary.petty.incomesTotal)}`}
                    />
                  ) : null}
                  {summary.petty.expensesCount > 0 ? (
                    <SummaryRow
                      label={`Pengeluaran (${summary.petty.expensesCount}×)`}
                      value={`- ${formatRupiah(summary.petty.expensesTotal)}`}
                    />
                  ) : null}
                  <p className="mt-1 text-[11px] text-neutral-600">
                    Otomatis dari Petty Cash tab.
                  </p>
                </section>
              ) : null}
            </aside>

            {/* ============================================================ */}
            {/* RIGHT — Input form                                           */}
            {/* ============================================================ */}
            <div className="flex flex-col gap-3 overflow-y-auto p-4 touch:gap-3 touch:p-3">
              {/* Kas Aktual hero panel with custom numpad */}
              <section className="rounded-xl border-2 border-mahakan-green-700/30 bg-white p-4">
                <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-mahakan-green-900">
                  <span>Kas Aktual</span>
                  <span className="text-[10px] text-neutral-600 normal-case tracking-normal">
                    (hitung manual di laci)
                  </span>
                </h3>

                {/* Big amount display */}
                <div
                  className={cn(
                    "mb-3 flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
                    submitting && "opacity-60",
                    parsedCash === 0
                      ? "border-neutral-300 bg-neutral-50"
                      : variance === 0
                        ? "border-success-500 bg-success-100"
                        : varianceFlag === "warn"
                          ? "border-danger-500 bg-danger-100"
                          : "border-warning-500 bg-warning-100",
                  )}
                >
                  {parsedCash > 0 ? (
                    <span className="font-mono text-3xl font-bold tabular-nums text-neutral-900 touch:text-2xl">
                      {formatRupiah(parsedCash)}
                    </span>
                  ) : (
                    <span className="font-mono text-base text-neutral-400 touch:text-sm">
                      Tap angka untuk input
                    </span>
                  )}
                </div>

                {/* Quick amounts + Pas */}
                <div className="mb-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setActualCash(String(amt))}
                      disabled={submitting}
                      className={cn(
                        "rounded-lg border border-neutral-300 bg-white py-1.5 text-sm font-medium transition-colors",
                        "hover:bg-neutral-100 active:scale-95",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                    >
                      {formatRupiah(amt).replace("Rp ", "")}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setActualCash(String(summary.expectedCash))
                    }
                    disabled={submitting}
                    className={cn(
                      "rounded-lg border-2 border-mahakan-green-700 bg-mahakan-green-50 py-1.5 text-sm font-bold text-mahakan-green-900 transition-colors",
                      "hover:bg-mahakan-green-100 active:scale-95",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    Pas
                  </button>
                </div>

                {/* Numpad 3x4 */}
                <div className="grid grid-cols-3 gap-1.5">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <NumKey
                      key={d}
                      label={d}
                      onPress={() => setActualCash((s) => s + d)}
                      disabled={submitting}
                    />
                  ))}
                  <NumKey
                    label="C"
                    onPress={() => setActualCash("")}
                    disabled={submitting}
                    variant="muted"
                  />
                  <NumKey
                    label="0"
                    onPress={() => setActualCash((s) => s + "0")}
                    disabled={submitting}
                  />
                  <NumKey
                    label="⌫"
                    onPress={() =>
                      setActualCash((s) => s.slice(0, -1))
                    }
                    disabled={submitting}
                    variant="muted"
                  />
                </div>
              </section>

              {/* Settlement Channel */}
              <section className="rounded-xl border border-neutral-200 bg-white p-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600">
                  Settlement Channel
                </h3>
                <p className="mb-2 text-[11px] text-neutral-600">
                  Total expected per channel hari ini. Kosongkan kalau gak
                  pakai.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <NumericInput
                    label="EDC (BCA)"
                    value={edc}
                    onChange={setEdc}
                    prefix="Rp"
                    hint={
                      summary.paid.cardBca > 0
                        ? `POS catat: ${formatRupiah(summary.paid.cardBca)}`
                        : undefined
                    }
                    disabled={submitting}
                  />
                  <NumericInput
                    label="GoFood"
                    value={gofood}
                    onChange={setGofood}
                    prefix="Rp"
                    disabled={submitting}
                  />
                  <NumericInput
                    label="GrabFood"
                    value={grabfood}
                    onChange={setGrabfood}
                    prefix="Rp"
                    disabled={submitting}
                  />
                  <NumericInput
                    label="ShopeeFood"
                    value={shopeefood}
                    onChange={setShopeefood}
                    prefix="Rp"
                    disabled={submitting}
                  />
                </div>
              </section>

              {/* Setoran ke Owner — collapsible */}
              <section className="rounded-xl border border-neutral-200 bg-white">
                <button
                  type="button"
                  onClick={() => setDepositOpen((v) => !v)}
                  className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-neutral-50"
                >
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                      Setor ke Owner
                    </h3>
                    <span className="text-[11px] text-neutral-600">
                      {parsedDepositPreview > 0
                        ? formatRupiah(parsedDepositPreview)
                        : "(opsional)"}
                    </span>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 text-neutral-600 transition-transform",
                      depositOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {depositOpen ? (
                  <div className="space-y-2 border-t border-neutral-200 p-3">
                    <p className="text-[11px] text-neutral-600">
                      Auto-buat entri{" "}
                      <strong>Setoran Tunai pending</strong> untuk
                      diverifikasi owner di tab Keuangan.
                    </p>
                    <NumericInput
                      label="Jumlah Setor"
                      value={depositAmount}
                      onChange={setDepositAmount}
                      prefix="Rp"
                      disabled={submitting}
                    />
                    {parsedDepositPreview > 0 ? (
                      <>
                        <Input
                          label="Tujuan Setoran"
                          type="text"
                          value={depositBank}
                          onChange={(e) => setDepositBank(e.target.value)}
                          placeholder="Owner Tunai / BCA Owner / dll"
                          disabled={submitting}
                        />
                        <Input
                          label="Catatan (opsional)"
                          type="text"
                          value={depositNotes}
                          onChange={(e) => setDepositNotes(e.target.value)}
                          placeholder="Sisa di drawer Rp 200rb, dll"
                          disabled={submitting}
                        />
                        {parsedCash > 0 && parsedDepositPreview > parsedCash ? (
                          <p className="text-xs font-medium text-warning-500">
                            ⚠ Setoran lebih besar dari kas aktual.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {/* Notes + Handover */}
              <section className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                  Catatan
                </h3>
                <Input
                  label="Catatan tutup shift (opsional)"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Misal: kembalian kurang pas"
                  disabled={submitting}
                />
                <div>
                  <label className="block text-sm font-medium text-neutral-900">
                    Pesan untuk Shift Berikutnya (opsional)
                  </label>
                  <textarea
                    value={handoverMessage}
                    onChange={(e) =>
                      setHandoverMessage(e.target.value.slice(0, 500))
                    }
                    maxLength={500}
                    rows={2}
                    placeholder="Misal: kopi house blend habis, supplier pesan besok pagi"
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                    disabled={submitting}
                  />
                  <p className="mt-1 text-[11px] text-neutral-600">
                    Tampil saat kasir buka shift berikutnya di outlet ini.
                  </p>
                </div>
              </section>

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </Modal>
      <BelanjaSubmissionModal
        open={belanjaOpen}
        lowStock={lowStock}
        shiftId={shift.id}
        ownerPhone={ownerPhone}
        onClose={handleBelanjaClose}
      />
    </>
  );
}

function SummaryRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm",
        muted ? "text-neutral-600" : "text-neutral-900",
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function NumKey({
  label,
  onPress,
  disabled,
  variant,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "muted";
}) {
  // Sesi AE-2 — onPointerDown bukan onClick. iOS Safari + tablet tap
  // onClick fire setelah pointerup + ~200ms delay. onPointerDown = instant.
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        onPress();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress();
        }
      }}
      disabled={disabled}
      style={{ touchAction: "manipulation" }}
      className={cn(
        "flex h-12 items-center justify-center rounded-lg border font-mono text-xl font-semibold transition-colors touch:h-11 touch:text-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "active:scale-95 active:shadow-inner",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "muted"
          ? "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
          : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
      )}
    >
      {label}
    </button>
  );
}
