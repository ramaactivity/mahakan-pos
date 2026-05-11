"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  Coins,
  CreditCard,
  Delete,
  ListTree,
  QrCode,
} from "lucide-react";
import { Badge, Button, Modal, Spinner, toast } from "@/components/ui";
import {
  addSplitPayment,
  getSplitBreakdown,
  isOk,
  type SplitKind,
  type SplitPaymentBreakdown,
  type TransactionItem,
  type TransactionWithItems,
} from "@/features/transactions";
import type { ReceiptConfig } from "@/lib/printer/print-transaction";
import { printTickets } from "@/lib/printer/print-transaction";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type PaymentMethod =
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other";

const QUICK_AMOUNTS = [20_000, 50_000, 100_000, 200_000];

interface SplitPaymentModalProps {
  open: boolean;
  bill: TransactionWithItems | null;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  onClose: () => void;
  onSplitAdded: (updatedTrx: TransactionWithItems) => void;
  onOpenSettings: () => void;
}

/**
 * Sesi AE-36 redesign — Per-customer partial payment (split bill).
 *
 * NEW: fullscreen 2-col layout dgn dedicated numpad (mirror CloseOpenBillModal).
 *
 * Layout (1340×800 landscape):
 *   LEFT 5fr: Bill summary + breakdown prior splits + per-menu picker
 *   RIGHT 7fr: Split kind picker + nominal input/per-menu summary +
 *              method tiles + cash numpad
 *   Footer: Konfirmasi Split full-width
 *
 * Modes:
 *   - Nominal: input rupiah, default = sisa bill (closes bill kalau penuh)
 *   - Per-Menu: pilih item + qty, server validate qty ≤ remaining unpaid
 *
 * Pembayaran:
 *   - Cash: built-in numpad + quick amounts + change calc
 *   - QRIS / Card: instruction only, no cash math
 *
 * Calculation: pakai breakdown.remainingAmount sebagai sisa real bill.
 * Tombol "Selesaikan Bill" kalau split kira-kira == remaining → auto-close.
 */
export function SplitPaymentModal({
  open,
  bill,
  cashierName,
  receiptConfig,
  onClose,
  onSplitAdded,
  onOpenSettings,
}: SplitPaymentModalProps) {
  const [breakdown, setBreakdown] = useState<SplitPaymentBreakdown | null>(
    null,
  );
  const [breakdownLoading, setBreakdownLoading] = useState(true);
  const [splitKind, setSplitKind] = useState<SplitKind>("nominal");
  const [amountInput, setAmountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  /** transactionItemId → qty selected for THIS split. */
  const [perMenuQty, setPerMenuQty] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bill) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setBreakdownLoading(true);
    setSplitKind("nominal");
    setAmountInput("");
    setPaymentMethod("cash");
    setCashInput("");
    setPerMenuQty({});
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await getSplitBreakdown(bill.id);
      if (cancelled) return;
      if (isOk(res)) setBreakdown(res.data);
      setBreakdownLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, bill]);

  // Per-menu computed amount = sum(unpaid items × unit price + modifiers).
  const perMenuComputedAmount = useMemo(() => {
    if (!bill) return 0;
    let total = 0;
    for (const it of bill.items) {
      const qty = perMenuQty[it.id] ?? 0;
      if (qty <= 0) continue;
      total += (it.unitPrice + it.modifiersPriceDelta) * qty;
    }
    return total;
  }, [bill, perMenuQty]);

  const parsedAmount = parseInt(amountInput || "0", 10) || 0;
  const effectiveAmount =
    splitKind === "per_menu" ? perMenuComputedAmount : parsedAmount;

  const parsedCash = parseInt(cashInput || "0", 10) || 0;
  const cashSufficient =
    paymentMethod !== "cash" || parsedCash >= effectiveAmount;
  const cashChange =
    paymentMethod === "cash"
      ? Math.max(0, parsedCash - effectiveAmount)
      : 0;

  const remaining = breakdown?.remainingAmount ?? bill?.total ?? 0;
  const willClose = effectiveAmount >= remaining && effectiveAmount > 0;

  function setItemQty(itemId: string, q: number, max: number) {
    const clamped = Math.max(0, Math.min(q, max));
    setPerMenuQty((prev) => {
      const next = { ...prev };
      if (clamped === 0) delete next[itemId];
      else next[itemId] = clamped;
      return next;
    });
  }

  async function handleSubmit() {
    if (!bill) return;
    if (submitting) return;
    setError(null);
    if (effectiveAmount <= 0) {
      setError(
        splitKind === "nominal"
          ? "Nominal harus lebih dari nol"
          : "Pilih minimal 1 item dengan qty",
      );
      return;
    }
    if (effectiveAmount > remaining) {
      setError(`Melebihi sisa bill (sisa ${formatRupiah(remaining)})`);
      return;
    }
    if (paymentMethod === "cash" && !cashSufficient) {
      setError("Tunai diterima kurang dari nominal split");
      return;
    }

    setSubmitting(true);
    const itemsPayload =
      splitKind === "per_menu"
        ? Object.entries(perMenuQty)
            .filter(([, q]) => q > 0)
            .map(([id, q]) => ({ transactionItemId: id, quantity: q }))
        : undefined;

    const res = await addSplitPayment({
      transactionId: bill.id,
      amount: effectiveAmount,
      paymentMethod,
      cashReceived: paymentMethod === "cash" ? parsedCash : null,
      cashChange: paymentMethod === "cash" ? cashChange : null,
      splitKind,
      items: itemsPayload,
    });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    if (willClose && receiptConfig) {
      void printTickets(res.data, cashierName, ["customer"], receiptConfig).then(
        (outcome) => {
          if (!outcome.ok && outcome.reason === "not_paired") {
            toast.error("Printer belum di-pair", {
              description:
                "Pasangkan printer di Pengaturan untuk auto-print struk final.",
              action: { label: "Buka", onClick: onOpenSettings },
            });
          }
        },
      );
    }

    toast.success(
      willClose
        ? `Bill ${res.data.transactionNumber} lunas via split`
        : `Split ${formatRupiah(effectiveAmount)} dicatat. Sisa ${formatRupiah(remaining - effectiveAmount)}`,
    );

    setSubmitting(false);
    onSplitAdded(res.data);
  }

  if (!bill) return null;

  const headerSubtitle = [
    bill.pagerNumber !== null ? `Pager ${bill.pagerNumber}` : null,
    bill.customerName?.trim() || null,
    breakdown
      ? `Sisa ${formatRupiah(breakdown.remainingAmount)} / ${formatRupiah(bill.total)}`
      : `Total ${formatRupiah(bill.total)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bayar Sebagian — ${bill.transactionNumber}`}
      description={headerSubtitle || undefined}
      size="fullscreen"
      bodyPadding="none"
      disableEscClose={submitting}
      footer={
        <Button
          size="xl"
          onClick={handleSubmit}
          loading={submitting}
          disabled={
            breakdownLoading ||
            effectiveAmount <= 0 ||
            effectiveAmount > remaining ||
            !cashSufficient ||
            submitting
          }
          fullWidth
          className="!h-14 !text-base touch:!h-12"
        >
          {submitting
            ? "Memproses…"
            : willClose
              ? `Selesaikan Bill — ${formatRupiah(effectiveAmount)}`
              : effectiveAmount === 0
                ? "Tentukan nominal split"
                : !cashSufficient
                  ? `Tunai kurang ${formatRupiah(effectiveAmount - parsedCash)}`
                  : `Catat Split ${formatRupiah(effectiveAmount)}`}
        </Button>
      }
    >
      {breakdownLoading ? (
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-8 text-mahakan-green-700" />
        </div>
      ) : !breakdown ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-danger-500">Gagal load breakdown</p>
        </div>
      ) : (
        <div className="grid h-full divide-y divide-neutral-200 lg:grid-cols-[5fr_7fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
          {/* ===================== LEFT — Bill summary + breakdown ===================== */}
          <div className="flex flex-col gap-3 overflow-y-auto p-4 touch:p-3">
            <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Bill Aktif
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-neutral-900">
                {bill.transactionNumber}
              </p>
              {bill.customerName ? (
                <p className="mt-1 text-sm text-neutral-700">
                  👤 {bill.customerName}
                </p>
              ) : null}
              {bill.pagerNumber !== null ? (
                <p className="text-xs text-neutral-600">
                  Pager <span className="font-mono">{bill.pagerNumber}</span>
                </p>
              ) : null}
            </section>

            {/* Prior splits breakdown */}
            {breakdown.splits.length > 0 ? (
              <section className="rounded-lg border border-success-500/30 bg-success-100/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-success-500">
                  Sudah Dibayar ({breakdown.splits.length}×)
                </p>
                <ul className="mt-1 space-y-1">
                  {breakdown.splits.map((s, i) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between text-xs text-neutral-700"
                    >
                      <span>
                        #{i + 1}{" "}
                        <Badge variant="neutral">
                          {s.splitKind === "per_menu" ? "Per Item" : "Nominal"}
                        </Badge>{" "}
                        {paymentMethodLabel(s.paymentMethod)}
                      </span>
                      <span className="font-mono font-semibold text-success-500">
                        {formatRupiah(s.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Total summary */}
            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-neutral-700">Total Bill</span>
                <span className="font-mono text-neutral-900">
                  {formatRupiah(bill.total)}
                </span>
              </div>
              {breakdown.totalPaid > 0 ? (
                <div className="flex items-baseline justify-between text-sm text-success-500">
                  <span>Sudah dibayar</span>
                  <span className="font-mono">
                    -{formatRupiah(breakdown.totalPaid)}
                  </span>
                </div>
              ) : null}
              <div className="mt-2 flex items-baseline justify-between border-t border-neutral-200 pt-2">
                <span className="text-sm font-bold text-neutral-900">
                  SISA BILL
                </span>
                <span className="font-mono text-2xl font-bold text-mahakan-green-900">
                  {formatRupiah(remaining)}
                </span>
              </div>
              {effectiveAmount > 0 ? (
                <div className="mt-2 flex items-baseline justify-between rounded-md bg-info-100/40 px-2 py-1 text-xs">
                  <span className="text-info-500">Setelah split ini</span>
                  <span className="font-mono font-semibold text-info-500">
                    {formatRupiah(Math.max(0, remaining - effectiveAmount))}
                  </span>
                </div>
              ) : null}
            </section>

            {/* Item list — interactive in per_menu mode */}
            <section className="flex-1">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Items Bill ({bill.items.reduce((s, i) => s + i.quantity, 0)})
              </h3>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                {bill.items.map((item) => (
                  <PerMenuRow
                    key={item.id}
                    item={item}
                    paidQty={
                      breakdown.paidQuantityByTrxItemId[item.id] ?? 0
                    }
                    selected={perMenuQty[item.id] ?? 0}
                    disabled={submitting || splitKind === "nominal"}
                    splitKind={splitKind}
                    onChange={(q) =>
                      setItemQty(
                        item.id,
                        q,
                        item.quantity -
                          (breakdown.paidQuantityByTrxItemId[item.id] ?? 0),
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          </div>

          {/* ===================== RIGHT — Form ===================== */}
          <div className="flex flex-col gap-3 overflow-y-auto p-4 touch:gap-2 touch:overflow-hidden touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none touch:min-h-0">
            {/* Split kind picker */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Tipe Split
              </h3>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                <KindTile
                  active={splitKind === "nominal"}
                  onClick={() => setSplitKind("nominal")}
                  Icon={Coins}
                  label="Nominal"
                  hint="Customer bayar Rp X (ga peduli item)"
                />
                <KindTile
                  active={splitKind === "per_menu"}
                  onClick={() => setSplitKind("per_menu")}
                  Icon={ListTree}
                  label="Per Menu"
                  hint="Customer bayar item + qty tertentu"
                />
              </div>
            </section>

            {/* Amount input area — depends on kind */}
            {splitKind === "nominal" ? (
              <section>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    Nominal Dibayar
                  </h3>
                  {remaining > 0 ? (
                    <button
                      type="button"
                      onClick={() => setAmountInput(String(remaining))}
                      className="text-[11px] font-medium text-mahakan-green-700 hover:underline"
                    >
                      Tutup sisa ({formatRupiah(remaining)})
                    </button>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "mt-1.5 flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
                    submitting && "opacity-60",
                    parsedAmount === 0
                      ? "border-neutral-300 bg-white"
                      : parsedAmount > remaining
                        ? "border-danger-500 bg-danger-100"
                        : willClose
                          ? "border-success-500 bg-success-100"
                          : "border-info-500 bg-info-100",
                  )}
                >
                  {parsedAmount > 0 ? (
                    <span className="font-mono text-3xl font-bold tabular-nums text-neutral-900 touch:text-2xl">
                      {formatRupiah(parsedAmount)}
                    </span>
                  ) : (
                    <span className="font-mono text-base text-neutral-400 touch:text-sm">
                      Tap angka di numpad
                    </span>
                  )}
                </div>
              </section>
            ) : (
              <section className="rounded-lg border border-neutral-200 bg-white p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Per-Menu Selected
                </h3>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-sm text-neutral-700">
                    {Object.values(perMenuQty).reduce(
                      (s, q) => s + (q ?? 0),
                      0,
                    )}{" "}
                    pcs dipilih
                  </span>
                  <span className="font-mono text-2xl font-bold text-mahakan-green-900">
                    {formatRupiah(perMenuComputedAmount)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-neutral-500">
                  Pilih qty per item di kolom kiri. Tampilkan customer hanya
                  bayar item-item ini.
                </p>
              </section>
            )}

            {/* Payment method */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Metode Pembayaran
              </h3>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-7 touch:grid-cols-7">
                <MethodTile
                  active={paymentMethod === "cash"}
                  onClick={() => setPaymentMethod("cash")}
                  label="Tunai"
                  Icon={Banknote}
                />
                <MethodTile
                  active={paymentMethod === "qris"}
                  onClick={() => setPaymentMethod("qris")}
                  label="QRIS"
                  Icon={QrCode}
                />
                <MethodTile
                  active={paymentMethod === "card_bca"}
                  onClick={() => setPaymentMethod("card_bca")}
                  label="BCA"
                  Icon={CreditCard}
                />
                <MethodTile
                  active={paymentMethod === "card_bni"}
                  onClick={() => setPaymentMethod("card_bni")}
                  label="BNI"
                  Icon={CreditCard}
                />
                <MethodTile
                  active={paymentMethod === "card_mandiri"}
                  onClick={() => setPaymentMethod("card_mandiri")}
                  label="Mandiri"
                  Icon={CreditCard}
                />
                <MethodTile
                  active={paymentMethod === "card_bri"}
                  onClick={() => setPaymentMethod("card_bri")}
                  label="BRI"
                  Icon={CreditCard}
                />
                <MethodTile
                  active={paymentMethod === "card_other"}
                  onClick={() => setPaymentMethod("card_other")}
                  label="Lainnya"
                  Icon={CreditCard}
                />
              </div>
            </section>

            {/* Cash numpad OR non-cash instruction */}
            {paymentMethod === "cash" ? (
              <CashInputPanel
                setCashInput={setCashInput}
                parsedCash={parsedCash}
                cashChange={cashChange}
                cashSufficient={cashSufficient}
                effectiveAmount={effectiveAmount}
                splitKind={splitKind}
                setAmountInput={setAmountInput}
                amountInput={amountInput}
                submitting={submitting}
              />
            ) : effectiveAmount > 0 ? (
              <section className="flex flex-col items-center gap-2 rounded-xl border border-info-300 bg-info-100/40 p-4 text-center">
                <CheckCircle2
                  className="size-8 text-info-500"
                  aria-hidden
                />
                <p className="text-sm font-medium text-info-500">
                  Pastikan customer sudah bayar{" "}
                  <strong>{formatRupiah(effectiveAmount)}</strong> via{" "}
                  {paymentMethodLabel(paymentMethod)}
                </p>
                <p className="text-xs text-info-500/80">
                  Tap &ldquo;{willClose ? "Selesaikan Bill" : "Catat Split"}
                  &rdquo; setelah konfirmasi.
                </p>
              </section>
            ) : (
              <section className="rounded-md border border-warning-300 bg-warning-100/40 p-3 text-xs text-warning-500">
                Tentukan nominal split dulu di {splitKind === "nominal"
                  ? "numpad"
                  : "kolom kiri (pilih item)"}.
              </section>
            )}

            {willClose && effectiveAmount > 0 ? (
              <div className="rounded-md border border-success-500/30 bg-success-100/40 px-3 py-2 text-xs font-medium text-success-500">
                ✓ Split ini akan menutup bill — auto-print struk customer.
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
              >
                {error}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

function KindTile({
  active,
  onClick,
  Icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof Coins;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border-2 px-3 py-2 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50"
          : "border-neutral-200 bg-white hover:bg-neutral-50",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm font-semibold",
          active ? "text-mahakan-green-900" : "text-neutral-900",
        )}
      >
        <Icon className="size-4" /> {label}
      </span>
      <span className="text-[11px] text-neutral-500">{hint}</span>
    </button>
  );
}

function MethodTile({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: typeof Banknote;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 text-xs font-medium transition-all touch:py-1.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
          : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
      )}
    >
      <Icon className="size-5 touch:size-4" />
      {label}
    </button>
  );
}

function CashInputPanel({
  setCashInput,
  parsedCash,
  cashChange,
  cashSufficient,
  effectiveAmount,
  splitKind,
  amountInput,
  setAmountInput,
  submitting,
}: {
  setCashInput: React.Dispatch<React.SetStateAction<string>>;
  parsedCash: number;
  cashChange: number;
  cashSufficient: boolean;
  effectiveAmount: number;
  splitKind: SplitKind;
  amountInput: string;
  setAmountInput: React.Dispatch<React.SetStateAction<string>>;
  submitting: boolean;
}) {
  /** Hook into numpad — kalau splitKind=nominal, numpad isi amountInput
   *  dulu (kalau belum ada). Kalau sudah ada, isi cashInput. Ini supaya
   *  satu numpad bisa dipakai untuk dua field. */
  const target: "amount" | "cash" =
    splitKind === "nominal" && amountInput === "" ? "amount" : "cash";

  function appendDigit(d: string) {
    if (target === "amount") setAmountInput((s) => s + d);
    else setCashInput((s) => s + d);
  }

  function backspace() {
    if (target === "amount") setAmountInput((s) => s.slice(0, -1));
    else setCashInput((s) => s.slice(0, -1));
  }

  function setQuick(amt: number) {
    setCashInput(String(amt));
  }

  return (
    <section className="flex flex-col gap-2">
      {/* Cash display */}
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          Tunai diterima
          {target === "amount" ? " (numpad isi nominal split dulu)" : ""}
        </span>
        {parsedCash > 0 && effectiveAmount > 0 ? (
          cashSufficient ? (
            <span className="font-mono font-semibold text-success-500">
              Kembali {formatRupiah(cashChange)}
            </span>
          ) : (
            <span className="font-mono font-semibold text-danger-500">
              Kurang {formatRupiah(effectiveAmount - parsedCash)}
            </span>
          )
        ) : null}
      </div>
      <div
        className={cn(
          "flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
          submitting && "opacity-60",
          parsedCash === 0
            ? "border-neutral-300 bg-white"
            : cashSufficient && effectiveAmount > 0
              ? "border-success-500 bg-success-100"
              : "border-warning-500 bg-warning-100",
        )}
      >
        {parsedCash > 0 ? (
          <span className="font-mono text-2xl font-bold tabular-nums text-neutral-900 touch:text-xl">
            {formatRupiah(parsedCash)}
          </span>
        ) : (
          <span className="font-mono text-base text-neutral-400 touch:text-sm">
            Tap numpad atau quick amount
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {QUICK_AMOUNTS.map((amt) => (
          <button
            key={amt}
            type="button"
            onClick={() => setQuick(amt)}
            disabled={submitting}
            className="rounded-lg border border-neutral-300 bg-white py-1.5 text-sm font-medium hover:bg-neutral-100 active:scale-95 disabled:opacity-50"
          >
            {formatRupiah(amt).replace("Rp ", "")}
          </button>
        ))}
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-1.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <NumpadKey key={d} label={d} onClick={() => appendDigit(d)} disabled={submitting} />
        ))}
        <NumpadKey
          label="000"
          onClick={() => appendDigit("000")}
          disabled={submitting}
        />
        <NumpadKey label="0" onClick={() => appendDigit("0")} disabled={submitting} />
        <NumpadKey
          icon={<Delete className="size-4" />}
          label="del"
          onClick={backspace}
          disabled={submitting}
        />
      </div>
    </section>
  );
}

function NumpadKey({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-12 items-center justify-center rounded-lg border-2 border-neutral-200 bg-white text-lg font-bold font-mono",
        "transition-all hover:bg-neutral-50 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "touch:h-11",
      )}
      aria-label={label}
    >
      {icon ?? label}
    </button>
  );
}

function PerMenuRow({
  item,
  paidQty,
  selected,
  disabled,
  splitKind,
  onChange,
}: {
  item: TransactionItem;
  paidQty: number;
  selected: number;
  disabled: boolean;
  splitKind: SplitKind;
  onChange: (q: number) => void;
}) {
  const remaining = item.quantity - paidQty;
  const fullyPaid = remaining === 0;
  return (
    <li
      className={cn(
        "flex items-start gap-2 px-3 py-2",
        fullyPaid && "opacity-50",
        splitKind === "nominal" && "bg-neutral-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900">
          <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded bg-mahakan-green-100 text-[11px] font-bold text-mahakan-green-900">
            {item.quantity}
          </span>
          {item.itemName}
          {item.variant ? (
            <span className="ml-1.5 text-xs text-neutral-500">
              ({item.variant === "hot" ? "Hot" : "Iced"})
            </span>
          ) : null}
        </p>
        <p className="text-[11px] text-neutral-500">
          {formatRupiah(item.unitPrice + item.modifiersPriceDelta)}/pcs
          {paidQty > 0 ? (
            <span className="ml-1 text-success-500">
              · {paidQty} sudah dibayar
            </span>
          ) : null}
          {fullyPaid ? (
            <span className="ml-1 text-success-500">· LUNAS</span>
          ) : null}
        </p>
      </div>
      {splitKind === "per_menu" && !fullyPaid ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(selected - 1)}
            disabled={disabled || selected <= 0}
            className="size-7 rounded-md border border-neutral-300 bg-white text-sm font-bold text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-8 text-center font-mono text-sm font-semibold">
            {selected}
          </span>
          <button
            type="button"
            onClick={() => onChange(selected + 1)}
            disabled={disabled || selected >= remaining}
            className="size-7 rounded-md border border-neutral-300 bg-white text-sm font-bold text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            +
          </button>
        </div>
      ) : (
        <span className="font-mono text-sm font-semibold text-neutral-900">
          {formatRupiah(item.subtotal)}
        </span>
      )}
    </li>
  );
}

function paymentMethodLabel(m: string): string {
  if (m === "cash") return "Tunai";
  if (m === "qris") return "QRIS";
  if (m.startsWith("card_")) return "Kartu " + m.replace("card_", "").toUpperCase();
  return m;
}
