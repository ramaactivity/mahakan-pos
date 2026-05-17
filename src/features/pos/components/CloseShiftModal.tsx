"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  MessageSquare,
  Printer,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Modal,
  Spinner,
  toast,
} from "@/components/ui";
import { isOk, closeShift, type Shift } from "@/features/shifts";
import {
  getTransaction,
  listTransactions,
  type TransactionWithItems,
} from "@/features/transactions";
import { getDailyCashSummary } from "@/features/cash";
import { listLowStockIngredients } from "@/features/purchase-requests/actions";
import type { LowStockIngredient } from "@/features/purchase-requests/types";
import { getOwnOutlet } from "@/features/outlets";
import { formatRupiah, parseRupiah } from "@/lib/format";
import {
  printTickets,
  type ReceiptConfig,
} from "@/lib/printer/print-transaction";
import { cn } from "@/lib/utils";
import { BelanjaSubmissionModal } from "./BelanjaSubmissionModal";
import { CloseOpenBillModal } from "./CloseOpenBillModal";

const VARIANCE_THRESHOLD = 10_000;

interface SummaryPreview {
  paid: { count: number; cash: number; qris: number; cardBca: number };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
  /** Sesi AE-49 — pisah cash vs non-cash. Cuma cash yang affect Kas Harusnya. */
  petty: {
    // cash-only (affect drawer)
    expenseCash: number;
    expenseCashCount: number;
    incomeCash: number;
    incomeCashCount: number;
    // non-cash (display only)
    expenseNonCash: number;
    expenseNonCashCount: number;
    incomeNonCash: number;
    incomeNonCashCount: number;
  };
}

type ActiveField = "kas" | "edc" | "gofood" | "grabfood" | "shopeefood";

interface FieldConfig {
  key: ActiveField;
  label: string;
  short: string;
  icon: typeof CreditCard;
}

const FIELDS: FieldConfig[] = [
  { key: "kas", label: "Kas Aktual", short: "Kas", icon: Wallet },
  { key: "edc", label: "EDC (BCA)", short: "EDC", icon: CreditCard },
  { key: "gofood", label: "GoFood", short: "GoFood", icon: Banknote },
  { key: "grabfood", label: "GrabFood", short: "Grab", icon: Banknote },
  { key: "shopeefood", label: "ShopeeFood", short: "Shopee", icon: Banknote },
];

const HANDOVER_TEMPLATES: Array<{ label: string; text: string }> = [
  { label: "Stok bahan habis", text: "Stok bahan habis: " },
  { label: "Alat error", text: "Alat / mesin perlu dicek: " },
  { label: "Customer hutang", text: "Customer hutang: " },
  { label: "Tidak ada catatan", text: "Tidak ada catatan khusus." },
];

interface CloseShiftModalProps {
  open: boolean;
  shift: Shift;
  userId: string;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  onClose: () => void;
  onClosed: () => void;
  onOpenSettings: () => void;
}

/**
 * Sesi AE-4 redesign — fix scroll trap (min-h-0 + overscrollBehavior),
 * unified active-field numpad supaya satu numpad serve Kas Aktual + 4
 * settlement channel (no more dual-numpad context switch yang error-prone
 * malam hari), inline Print Struk + Bayar tombol per open bill (kasir ga
 * perlu keluar modal Tutup Shift untuk handle bill belum lunas), handover
 * quick-pick chips supaya pesan shift berikut tidak butuh ngetik panjang.
 *
 * Layout 2-col fullscreen (mirror CloseOpenBillModal + PaymentModal AD-7
 * pattern):
 *   LEFT 5fr (~558px tablet 1340 landscape): Summary + Variance live +
 *     Setor ke Owner + Catatan + Pesan handover.
 *   RIGHT 7fr (~782px): Field tab bar (5 tabs) + hero display of active +
 *     quick-amounts row + shared 3×4 numpad. Single numpad for all 5
 *     amounts.
 *   Open bills view: full-width list dengan inline tombol Cetak Struk +
 *     Bayar. Block submit until all paid / voided.
 */
export function CloseShiftModal({
  open,
  shift,
  cashierName,
  receiptConfig,
  onClose,
  onClosed,
  onOpenSettings,
}: CloseShiftModalProps) {
  const [summary, setSummary] = useState<SummaryPreview | null>(null);
  const [openBills, setOpenBills] = useState<
    Array<{
      id: string;
      transactionNumber: string;
      pagerNumber: number | null;
      total: number;
      customerName: string | null;
    }>
  >([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  // 5 amount fields — raw digit strings (no separator).
  const [actualCash, setActualCash] = useState("");
  const [edc, setEdc] = useState("");
  const [gofood, setGofood] = useState("");
  const [grabfood, setGrabfood] = useState("");
  const [shopeefood, setShopeefood] = useState("");
  const [activeField, setActiveField] = useState<ActiveField>("kas");

  const [notes, setNotes] = useState("");
  const [handoverMessage, setHandoverMessage] = useState("");

  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositBank, setDepositBank] = useState("");
  const [depositNotes, setDepositNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sesi AE-4 — inline open-bill actions
  const [printingBillId, setPrintingBillId] = useState<string | null>(null);
  const [paymentBill, setPaymentBill] = useState<TransactionWithItems | null>(
    null,
  );
  const [loadingPaymentForId, setLoadingPaymentForId] = useState<string | null>(
    null,
  );

  const [belanjaOpen, setBelanjaOpen] = useState(false);
  const [lowStock, setLowStock] = useState<LowStockIngredient[]>([]);
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null);

  // Sesi AE-4 — gunakan shift.id (bukan shift object) supaya parent re-render
  // ga trigger refetch loop yang bikin "breathing" loading spinner.
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
    setActiveField("kas");
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
          customerName: t.customerName ?? null,
        }));
      setOpenBills(open);
      // Sesi AE-62g — include partially_refunded di paid bucket supaya UI
      // preview match server formula (server pakai status in paid/partially_refunded).
      // Sebelumnya: kalau ada partial refund, UI tampil "Pas" tapi server
      // calculate variance ≠ 0 → kasir bingung, journal hook fire palsu.
      const paid = items.filter(
        (t) => t.status === "paid" || t.status === "partially_refunded",
      );
      const voided = items.filter((t) => t.status === "voided");
      const refunded = items.filter((t) => t.status === "refunded");

      const paidCash = paid
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.total, 0);
      // Sesi AE-62g — refundedCash includes BOTH full refunds (entire total)
      // dan partial refunds (refundedAmount column). Sebelumnya cuma full
      // refund yang dihitung → UI under-state refund → expectedCash over-state.
      const partiallyRefundedCash = items
        .filter(
          (t) =>
            t.paymentMethod === "cash" && t.status === "partially_refunded",
        )
        .reduce((s, t) => s + t.refundedAmount, 0);
      const refundedCash =
        refunded
          .filter((t) => t.paymentMethod === "cash")
          .reduce((s, t) => s + t.total, 0) + partiallyRefundedCash;

      const cashSummary = isOk(cashRes) ? cashRes.data : null;

      /* Sesi AE-49 — petty cash cash-only affect Kas Harusnya. Filter
       * paymentMethod=cash di queries.ts sudah expose cashField di summary.
       * Formula: expectedCash = opening + paidCash - refundedCash
       *                       - pettyExpenseCash + pettyIncomeCash */
      const pettyExpenseCash = cashSummary?.expenses.cash ?? 0;
      const pettyIncomeCash = cashSummary?.income.manual.cash ?? 0;

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
        expectedCash:
          shift.openingCash +
          paidCash -
          refundedCash -
          pettyExpenseCash +
          pettyIncomeCash,
        petty: {
          expenseCash: pettyExpenseCash,
          expenseCashCount: cashSummary?.expenses.cashCount ?? 0,
          incomeCash: pettyIncomeCash,
          incomeCashCount: cashSummary?.income.manual.cashCount ?? 0,
          expenseNonCash: cashSummary?.expenses.nonCash ?? 0,
          expenseNonCashCount: cashSummary?.expenses.nonCashCount ?? 0,
          incomeNonCash: cashSummary?.income.manual.nonCash ?? 0,
          incomeNonCashCount: cashSummary?.income.manual.nonCashCount ?? 0,
        },
      });
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
    // shift.id stable across parent re-renders — prevent re-fetch loop.
  }, [open, shift.id, shift.openingCash, refreshKey]);

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

  // Active field state plumbing
  const fieldValues: Record<ActiveField, string> = {
    kas: actualCash,
    edc,
    gofood,
    grabfood,
    shopeefood,
  };
  const fieldSetters: Record<ActiveField, (v: string) => void> = {
    kas: setActualCash,
    edc: setEdc,
    gofood: setGofood,
    grabfood: setGrabfood,
    shopeefood: setShopeefood,
  };
  const activeValueRaw = fieldValues[activeField];
  const activeValueParsed = (() => {
    try {
      return parseRupiah(activeValueRaw || "0");
    } catch {
      return 0;
    }
  })();

  function setActiveValue(next: string) {
    fieldSetters[activeField](next);
  }
  function appendDigit(d: string) {
    if (submitting) return;
    if (activeValueRaw.length >= 12) return;
    setActiveValue(activeValueRaw + d);
  }
  function backspace() {
    if (submitting) return;
    setActiveValue(activeValueRaw.slice(0, -1));
  }
  function clearActive() {
    if (submitting) return;
    setActiveValue("");
  }

  // Quick amounts depend on active field. Kas → 50k/100k/200k/500k + Pas
  // (= expectedCash). Settlement fields → 50k/100k/200k/500k + "POS"
  // (match POS-recorded value).
  const quickAmounts = [50_000, 100_000, 200_000, 500_000];
  const matchValue = (() => {
    if (!summary) return null;
    if (activeField === "kas") return summary.expectedCash;
    if (activeField === "edc") return summary.paid.cardBca;
    return null; // GoFood/GrabFood/ShopeeFood — no POS-recorded match
  })();
  const matchLabel = activeField === "kas" ? "Pas" : "POS";

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
    } else if (res.data.summary.depositError) {
      // Sesi AE-62h — auto-deposit gagal (e.g. period overlap), surface ke
      // kasir supaya tahu setoran BELUM tercatat dan harus input manual via
      // Setoran Tunai di backoffice. Sebelumnya silent fail.
      toast.warning(
        `Setoran BELUM tercatat: ${res.data.summary.depositError.message}. Owner perlu input manual di Setoran Tunai.`,
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

  async function handlePrintBill(billId: string) {
    if (printingBillId !== null) return;
    if (!receiptConfig) {
      toast.error("Outlet config belum dimuat — tunggu sebentar.");
      return;
    }
    setPrintingBillId(billId);
    try {
      const trxRes = await getTransaction(billId);
      if (!isOk(trxRes) || !trxRes.data) {
        toast.error("Gagal load detail bill");
        return;
      }
      const outcome = await printTickets(
        trxRes.data,
        cashierName,
        ["customer"],
        receiptConfig,
      );
      if (outcome.ok) {
        toast.success(`Struk ${trxRes.data.transactionNumber} dicetak`);
      } else if (outcome.reason === "not_paired") {
        toast.error("Printer belum di-pair", {
          description: "Pasangkan printer di Pengaturan untuk auto-print.",
          action: { label: "Buka", onClick: onOpenSettings },
        });
      } else {
        toast.error(outcome.message);
      }
    } finally {
      setPrintingBillId(null);
    }
  }

  async function handleStartPayment(billId: string) {
    if (loadingPaymentForId !== null) return;
    setLoadingPaymentForId(billId);
    try {
      const trxRes = await getTransaction(billId);
      if (!isOk(trxRes) || !trxRes.data) {
        toast.error("Gagal load detail bill");
        return;
      }
      setPaymentBill(trxRes.data);
    } finally {
      setLoadingPaymentForId(null);
    }
  }

  function handlePaymentClosed() {
    setPaymentBill(null);
    setRefreshKey((k) => k + 1);
  }

  const blockedByOpenBills = openBills.length > 0;
  const submitDisabled =
    loading || actualCash.trim().length === 0 || blockedByOpenBills;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Tutup Shift"
        description={
          blockedByOpenBills
            ? `${openBills.length} bill belum dibayar — selesaikan dulu sebelum tutup.`
            : "Hitung kas fisik di laci, bandingkan dengan Kas Harusnya. Settlement channel diisi seperlunya."
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
                disabled={submitDisabled}
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
          <BlockedByOpenBillsView
            bills={openBills}
            printingBillId={printingBillId}
            loadingPaymentForId={loadingPaymentForId}
            onPrint={handlePrintBill}
            onStartPayment={handleStartPayment}
          />
        ) : !summary ? (
          <p className="p-5 text-sm text-danger-500">Gagal load summary</p>
        ) : (
          <div className="grid h-full min-h-0 grid-rows-1 divide-y divide-neutral-200 lg:grid-cols-[5fr_7fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
            {/* ============================================================ */}
            {/* LEFT — Summary + Setor + Catatan + Handover                 */}
            {/* ============================================================ */}
            <aside
              className="flex min-h-0 flex-col gap-3 overflow-y-auto bg-neutral-50 p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
              style={{ overscrollBehavior: "contain" }}
            >
              <SummarySection
                shift={shift}
                summary={summary}
              />
              <VarianceIndicator
                parsedCash={parsedCash}
                variance={variance}
                varianceFlag={varianceFlag}
              />
              {(summary.petty.expenseCashCount > 0 ||
                summary.petty.incomeCashCount > 0 ||
                summary.petty.expenseNonCashCount > 0 ||
                summary.petty.incomeNonCashCount > 0) && (
                <PettyCashSection petty={summary.petty} />
              )}
              <DepositSection
                open={depositOpen}
                amount={depositAmount}
                bank={depositBank}
                notes={depositNotes}
                preview={parsedDepositPreview}
                kasAktual={parsedCash}
                submitting={submitting}
                onToggle={() => setDepositOpen((v) => !v)}
                onChangeAmount={setDepositAmount}
                onChangeBank={setDepositBank}
                onChangeNotes={setDepositNotes}
              />
              <NotesAndHandoverSection
                notes={notes}
                handoverMessage={handoverMessage}
                onChangeNotes={setNotes}
                onChangeHandover={setHandoverMessage}
                submitting={submitting}
              />
            </aside>

            {/* ============================================================ */}
            {/* RIGHT — Field Tab Bar + Hero Display + Numpad               */}
            {/* ============================================================ */}
            <div
              className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 touch:gap-3 touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
              style={{ overscrollBehavior: "contain" }}
            >
              {/* Field selector tab bar */}
              <FieldTabBar
                fields={FIELDS}
                values={fieldValues}
                activeField={activeField}
                onSelect={setActiveField}
                disabled={submitting}
              />

              {/* Hero display + quick amounts + numpad for active field */}
              <ActiveFieldPanel
                activeField={activeField}
                activeLabel={
                  FIELDS.find((f) => f.key === activeField)?.label ??
                  "Kas Aktual"
                }
                rawValue={activeValueRaw}
                parsedValue={activeValueParsed}
                quickAmounts={quickAmounts}
                matchValue={matchValue}
                matchLabel={matchLabel}
                summary={summary}
                variance={variance}
                varianceFlag={varianceFlag}
                submitting={submitting}
                onSetValue={setActiveValue}
                onAppendDigit={appendDigit}
                onBackspace={backspace}
                onClear={clearActive}
              />

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

      {/* Stacked: payment for selected open bill */}
      <CloseOpenBillModal
        open={paymentBill !== null}
        bill={paymentBill}
        cashierName={cashierName}
        receiptConfig={receiptConfig}
        onClose={() => setPaymentBill(null)}
        onClosed={handlePaymentClosed}
        onOpenSettings={onOpenSettings}
      />

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

// ============================================================
// Subcomponents — kept inside same file karena tightly coupled
// ============================================================

function SummarySection({
  shift,
  summary,
}: {
  shift: Shift;
  summary: SummaryPreview;
}) {
  /* Sesi AE-49 — display full formula breakdown supaya owner & kasir
   * paham angka Kas Harusnya dari mana. Petty cash sekarang TERMASUK di
   * formula (sebelumnya display-only di section terpisah → confusing). */
  const refundedCashApprox = summary.refunded.totalAmount; // approx; exact split di server
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 touch:p-3">
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
            value={`- ${formatRupiah(refundedCashApprox)}`}
          />
        ) : null}
        {/* Sesi AE-49 — petty cash cash-only di breakdown ringkasan. */}
        {summary.petty.expenseCashCount > 0 ? (
          <SummaryRow
            label={`Petty Pengeluaran Cash (${summary.petty.expenseCashCount}×)`}
            value={`- ${formatRupiah(summary.petty.expenseCash)}`}
          />
        ) : null}
        {summary.petty.incomeCashCount > 0 ? (
          <SummaryRow
            label={`Petty Pemasukan Cash (${summary.petty.incomeCashCount}×)`}
            value={`+ ${formatRupiah(summary.petty.incomeCash)}`}
          />
        ) : null}
        <div className="my-2 border-t border-dashed border-neutral-200" />
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-neutral-900">
            Kas Harusnya
          </span>
          <span className="font-mono text-xl font-bold text-mahakan-green-900 touch:text-lg">
            {formatRupiah(summary.expectedCash)}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">
          Formula: Kas Awal + Penjualan Tunai − Refund Tunai − Petty
          Pengeluaran Cash + Petty Pemasukan Cash
        </p>
      </div>
    </section>
  );
}

function VarianceIndicator({
  parsedCash,
  variance,
  varianceFlag,
}: {
  parsedCash: number;
  variance: number;
  varianceFlag: "warn" | "ok";
}) {
  return (
    <>
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
            <span className="font-mono italic">Isi kas aktual dulu</span>
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
          ⚠ Selisih lebih dari {formatRupiah(VARIANCE_THRESHOLD)}. Recheck
          jumlah cash drawer atau catat alasan di bawah.
        </p>
      ) : null}
    </>
  );
}

function PettyCashSection({
  petty,
}: {
  petty: SummaryPreview["petty"];
}) {
  /* Sesi AE-49 — pisah display cash vs non-cash. Cash AFFECT Kas Harusnya
   * (sudah dihitung di formula expectedCash di SummarySection). Non-cash
   * (transfer/other) info-only — tidak affect drawer fisik. */
  const hasCash =
    petty.expenseCashCount > 0 || petty.incomeCashCount > 0;
  const hasNonCash =
    petty.expenseNonCashCount > 0 || petty.incomeNonCashCount > 0;

  if (!hasCash && !hasNonCash) return null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-600">
        Petty Cash Hari Ini
      </h3>

      {hasCash ? (
        <div className="rounded-md border border-mahakan-green-700/20 bg-mahakan-green-50/40 p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mahakan-green-900">
            Cash (affect Kas Harusnya)
          </p>
          {petty.incomeCashCount > 0 ? (
            <SummaryRow
              label={`Pemasukan tunai (${petty.incomeCashCount}×)`}
              value={`+ ${formatRupiah(petty.incomeCash)}`}
            />
          ) : null}
          {petty.expenseCashCount > 0 ? (
            <SummaryRow
              label={`Pengeluaran tunai (${petty.expenseCashCount}×)`}
              value={`- ${formatRupiah(petty.expenseCash)}`}
            />
          ) : null}
          <p className="mt-1 text-[11px] font-medium text-mahakan-green-900">
            ✓ Sudah dikurangi/ditambah ke Kas Harusnya di atas
          </p>
        </div>
      ) : null}

      {hasNonCash ? (
        <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            Non-cash (info — tidak affect kas laci)
          </p>
          {petty.incomeNonCashCount > 0 ? (
            <SummaryRow
              label={`Pemasukan transfer/other (${petty.incomeNonCashCount}×)`}
              value={`+ ${formatRupiah(petty.incomeNonCash)}`}
            />
          ) : null}
          {petty.expenseNonCashCount > 0 ? (
            <SummaryRow
              label={`Pengeluaran transfer/other (${petty.expenseNonCashCount}×)`}
              value={`- ${formatRupiah(petty.expenseNonCash)}`}
            />
          ) : null}
          <p className="mt-1 text-[11px] text-neutral-500">
            Untuk audit. Affect bank/aggregator, bukan laci kasir.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function DepositSection({
  open,
  amount,
  bank,
  notes,
  preview,
  kasAktual,
  submitting,
  onToggle,
  onChangeAmount,
  onChangeBank,
  onChangeNotes,
}: {
  open: boolean;
  amount: string;
  bank: string;
  notes: string;
  preview: number;
  kasAktual: number;
  submitting: boolean;
  onToggle: () => void;
  onChangeAmount: (v: string) => void;
  onChangeBank: (v: string) => void;
  onChangeNotes: (v: string) => void;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-neutral-50"
      >
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
            Setor ke Owner
          </h3>
          <span className="text-[11px] text-neutral-600">
            {preview > 0 ? formatRupiah(preview) : "(opsional)"}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-neutral-600 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-neutral-200 p-3">
          <p className="text-[11px] text-neutral-600">
            Auto-buat entri <strong>Setoran Tunai pending</strong> untuk
            diverifikasi owner di tab Keuangan.
          </p>
          <RupiahCardInput
            label="Jumlah Setor"
            value={amount}
            onChange={onChangeAmount}
            disabled={submitting}
          />
          {preview > 0 ? (
            <>
              <Input
                label="Tujuan Setoran"
                type="text"
                value={bank}
                onChange={(e) => onChangeBank(e.target.value)}
                placeholder="Owner Tunai / BCA Owner / dll"
                disabled={submitting}
              />
              <Input
                label="Catatan (opsional)"
                type="text"
                value={notes}
                onChange={(e) => onChangeNotes(e.target.value)}
                placeholder="Sisa di drawer Rp 200rb, dll"
                disabled={submitting}
              />
              {kasAktual > 0 && preview > kasAktual ? (
                <p className="text-xs font-medium text-warning-500">
                  ⚠ Setoran lebih besar dari kas aktual.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function NotesAndHandoverSection({
  notes,
  handoverMessage,
  onChangeNotes,
  onChangeHandover,
  submitting,
}: {
  notes: string;
  handoverMessage: string;
  onChangeNotes: (v: string) => void;
  onChangeHandover: (v: string) => void;
  submitting: boolean;
}) {
  function applyTemplate(t: string) {
    if (handoverMessage.trim().length === 0) {
      onChangeHandover(t);
      return;
    }
    // Append on new line, preserve existing.
    onChangeHandover(`${handoverMessage.trim()}\n${t}`.slice(0, 500));
  }

  const remaining = 500 - handoverMessage.length;

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
        Catatan
      </h3>
      <Input
        label="Catatan tutup shift (opsional)"
        type="text"
        value={notes}
        onChange={(e) => onChangeNotes(e.target.value)}
        placeholder="Misal: kembalian kurang pas"
        disabled={submitting}
      />
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
            <MessageSquare
              className="size-3.5 text-mahakan-green-700"
              aria-hidden
            />
            Pesan untuk Shift Berikutnya
          </label>
          <span
            className={cn(
              "text-[10px]",
              remaining < 50 ? "text-warning-500" : "text-neutral-500",
            )}
          >
            {remaining} char tersisa
          </span>
        </div>
        <p className="mb-1.5 text-[11px] text-neutral-600">
          Tap chip di bawah untuk kasih template, atau ketik bebas.
        </p>
        <div className="mb-2 flex flex-wrap gap-1">
          {HANDOVER_TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t.text)}
              disabled={submitting}
              className={cn(
                "rounded-full border border-mahakan-green-700/40 bg-mahakan-green-50 px-2.5 py-1 text-[11px] font-medium text-mahakan-green-900 transition-colors",
                "hover:bg-mahakan-green-100 active:scale-95",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              + {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={handoverMessage}
          onChange={(e) =>
            onChangeHandover(e.target.value.slice(0, 500))
          }
          maxLength={500}
          rows={3}
          placeholder="Misal: kopi house blend habis, supplier pesan besok pagi"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 touch:text-[13px]"
          disabled={submitting}
        />
        <p className="mt-1 text-[11px] text-neutral-600">
          Tampil saat kasir buka shift berikutnya di outlet ini.
        </p>
      </div>
    </section>
  );
}

function FieldTabBar({
  fields,
  values,
  activeField,
  onSelect,
  disabled,
}: {
  fields: FieldConfig[];
  values: Record<ActiveField, string>;
  activeField: ActiveField;
  onSelect: (k: ActiveField) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5 rounded-xl bg-neutral-100 p-1.5 touch:gap-1 touch:p-1">
      {fields.map((f) => {
        const raw = values[f.key];
        const parsed = (() => {
          try {
            return parseRupiah(raw || "0");
          } catch {
            return 0;
          }
        })();
        const isActive = activeField === f.key;
        const Icon = f.icon;
        return (
          <button
            key={f.key}
            type="button"
            onPointerDown={(e) => {
              if (disabled) return;
              e.preventDefault();
              onSelect(f.key);
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(f.key);
              }
            }}
            disabled={disabled}
            style={{ touchAction: "manipulation" }}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-2 text-center transition-all touch:py-1.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isActive
                ? "bg-mahakan-green-700 text-white shadow-sm"
                : parsed > 0
                  ? "bg-white text-neutral-900 hover:bg-mahakan-green-50"
                  : "bg-white text-neutral-600 hover:bg-mahakan-green-50",
            )}
          >
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide touch:text-[10px]">
              <Icon className="size-3" aria-hidden />
              {f.short}
            </span>
            <span
              className={cn(
                "font-mono text-xs font-bold tabular-nums touch:text-[11px]",
                isActive
                  ? "text-white"
                  : parsed > 0
                    ? "text-mahakan-green-900"
                    : "text-neutral-400",
              )}
            >
              {parsed > 0 ? formatRupiah(parsed).replace("Rp ", "") : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ActiveFieldPanel({
  activeField,
  activeLabel,
  rawValue,
  parsedValue,
  quickAmounts,
  matchValue,
  matchLabel,
  summary,
  variance,
  varianceFlag,
  submitting,
  onSetValue,
  onAppendDigit,
  onBackspace,
  onClear,
}: {
  activeField: ActiveField;
  activeLabel: string;
  rawValue: string;
  parsedValue: number;
  quickAmounts: number[];
  matchValue: number | null;
  matchLabel: string;
  summary: SummaryPreview;
  variance: number;
  varianceFlag: "warn" | "ok";
  submitting: boolean;
  onSetValue: (v: string) => void;
  onAppendDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  const isKas = activeField === "kas";
  const isEdc = activeField === "edc";
  const posRecorded = isEdc ? summary.paid.cardBca : null;

  const heroBorder = (() => {
    if (parsedValue === 0) return "border-neutral-200 bg-neutral-50";
    if (isKas) {
      if (variance === 0) return "border-success-500 bg-success-100";
      if (varianceFlag === "warn") return "border-danger-500 bg-danger-100";
      return "border-warning-500 bg-warning-100";
    }
    return "border-mahakan-green-700 bg-mahakan-green-50";
  })();

  return (
    <section className="rounded-xl border-2 border-mahakan-green-700/30 bg-white p-4 touch:p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-mahakan-green-900">
          {activeLabel}
        </h3>
        {posRecorded !== null && posRecorded > 0 ? (
          <span className="text-[11px] text-neutral-600">
            POS catat: {formatRupiah(posRecorded)}
          </span>
        ) : isKas ? (
          <span className="text-[10px] text-neutral-500 normal-case tracking-normal">
            (hitung manual di laci)
          </span>
        ) : null}
      </div>

      {/* Hero amount display */}
      <div
        className={cn(
          "mb-3 flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
          submitting && "opacity-60",
          heroBorder,
        )}
      >
        {parsedValue > 0 ? (
          <span className="font-mono text-3xl font-bold tabular-nums text-neutral-900 touch:text-2xl">
            {formatRupiah(parsedValue)}
          </span>
        ) : (
          <span className="font-mono text-base text-neutral-400 touch:text-sm">
            Tap angka untuk input
          </span>
        )}
      </div>

      {/* Quick amounts row */}
      <div className="mb-2 grid grid-cols-5 gap-1.5 touch:gap-1">
        {quickAmounts.map((amt) => (
          <button
            key={amt}
            type="button"
            onPointerDown={(e) => {
              if (submitting) return;
              e.preventDefault();
              onSetValue(String(amt));
            }}
            onKeyDown={(e) => {
              if (submitting) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSetValue(String(amt));
              }
            }}
            disabled={submitting}
            style={{ touchAction: "manipulation" }}
            className={cn(
              "rounded-lg border border-neutral-300 bg-white py-1.5 text-xs font-medium transition-colors touch:py-1",
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
          onPointerDown={(e) => {
            if (submitting || matchValue === null) return;
            e.preventDefault();
            onSetValue(String(matchValue));
          }}
          onKeyDown={(e) => {
            if (submitting || matchValue === null) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSetValue(String(matchValue));
            }
          }}
          disabled={submitting || matchValue === null}
          style={{ touchAction: "manipulation" }}
          className={cn(
            "rounded-lg border-2 py-1.5 text-xs font-bold transition-colors touch:py-1",
            "hover:bg-mahakan-green-100 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
            "disabled:cursor-not-allowed disabled:opacity-50",
            matchValue !== null
              ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
              : "border-neutral-200 bg-neutral-50 text-neutral-400",
          )}
          title={
            matchValue !== null
              ? `${matchLabel}: ${formatRupiah(matchValue)}`
              : "Tidak ada nilai POS untuk channel ini"
          }
        >
          {matchLabel}
        </button>
      </div>

      {/* Numpad 3x4 */}
      <div className="grid grid-cols-3 gap-1.5 touch:gap-1">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <NumKey
            key={d}
            label={d}
            onPress={() => onAppendDigit(d)}
            disabled={submitting}
          />
        ))}
        <NumKey
          label="C"
          onPress={onClear}
          disabled={submitting}
          variant="muted"
        />
        <NumKey label="0" onPress={() => onAppendDigit("0")} disabled={submitting} />
        <NumKey
          label="⌫"
          onPress={onBackspace}
          disabled={submitting}
          variant="muted"
        />
      </div>

      <p className="mt-2 text-[11px] text-neutral-600">
        Pilih kolom di tab atas untuk pindah input.{" "}
        {rawValue.length > 0 ? `${rawValue.length} digit.` : ""}
      </p>
    </section>
  );
}

function BlockedByOpenBillsView({
  bills,
  printingBillId,
  loadingPaymentForId,
  onPrint,
  onStartPayment,
}: {
  bills: Array<{
    id: string;
    transactionNumber: string;
    pagerNumber: number | null;
    total: number;
    customerName: string | null;
  }>;
  printingBillId: string | null;
  loadingPaymentForId: string | null;
  onPrint: (id: string) => void;
  onStartPayment: (id: string) => void;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 touch:p-4 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="rounded-xl border border-warning-300 bg-warning-100 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 size-5 text-warning-500"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-sm font-bold text-warning-500">
              {bills.length} bill belum dibayar
            </p>
            <p className="text-xs text-neutral-700">
              Selesaikan bill dulu sebelum tutup shift. Tap{" "}
              <strong>Bayar</strong> untuk lanjut payment di sini, atau{" "}
              <strong>Cetak Struk</strong> untuk kasih reminder ke customer.
            </p>
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {bills.map((b) => {
          const isPrinting = printingBillId === b.id;
          const isLoadingPayment = loadingPaymentForId === b.id;
          return (
            <li
              key={b.id}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between touch:p-2"
            >
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                  <Receipt className="size-4 text-neutral-600" aria-hidden />
                  {b.transactionNumber}
                  {b.pagerNumber !== null ? (
                    <Badge variant="neutral">Pager {b.pagerNumber}</Badge>
                  ) : null}
                </span>
                <span className="text-[11px] text-neutral-600">
                  {b.customerName?.trim()
                    ? `${b.customerName.trim()} · `
                    : ""}
                  <span className="font-mono font-semibold text-neutral-900">
                    {formatRupiah(b.total)}
                  </span>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPrint(b.id)}
                  disabled={isPrinting}
                  className="!h-9 touch:!h-10"
                >
                  {isPrinting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Printer className="size-4" aria-hidden />
                  )}
                  Cetak Struk
                </Button>
                <Button
                  size="sm"
                  onClick={() => onStartPayment(b.id)}
                  disabled={isLoadingPayment}
                  className="!h-9 touch:!h-10"
                >
                  {isLoadingPayment ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Bayar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs italic text-neutral-600">
        Sudah selesai semua? Tap <strong>Cek Ulang</strong> di footer untuk
        refresh status.
      </p>
    </div>
  );
}

// ============================================================
// Atoms
// ============================================================

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

/**
 * Compact rupiah-input card untuk Setor section. Display-only — no native
 * keyboard. Tap card → user pakai numpad utama dari right column?
 * Actually no, deposit is on LEFT and tidak share numpad. Pakai
 * controlled input pakai inputMode=numeric untuk simplicity (jarang dipakai).
 */
function RupiahCardInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const parsed = (() => {
    try {
      return value.trim().length > 0 ? parseRupiah(value) : 0;
    } catch {
      return 0;
    }
  })();
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-neutral-900">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
          Rp
        </span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="0"
          disabled={disabled}
          className={cn(
            "h-11 w-full rounded-md border border-neutral-300 bg-white pl-9 pr-3 text-right font-mono text-base tabular-nums text-neutral-900 transition-colors touch:h-10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40 focus-visible:border-mahakan-green-700",
            "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500",
          )}
        />
      </div>
      {parsed > 0 ? (
        <p className="text-[11px] text-neutral-600">
          Preview: {formatRupiah(parsed)}
        </p>
      ) : null}
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
