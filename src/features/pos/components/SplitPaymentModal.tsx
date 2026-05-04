"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Coins, ListTree, Wallet } from "lucide-react";
import {
  Badge,
  Button,
  Modal,
  NumericInput,
  Spinner,
  toast,
} from "@/components/ui";
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
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type PaymentMethod =
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other";

interface SplitPaymentModalProps {
  open: boolean;
  bill: TransactionWithItems | null;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  onClose: () => void;
  /** Called whenever a split was committed; parent should refresh bills.
   * Receives the freshly-fetched transaction so it can detect close. */
  onSplitAdded: (updatedTrx: TransactionWithItems) => void;
  onOpenSettings: () => void;
}

/**
 * Per-customer partial payment for a multi-payer bill (Galih ask #13).
 *
 * Two modes:
 * - **Nominal**: kasir input rupiah amount; not tied to specific items.
 *   Useful for equal splits or "I'll cover X amount".
 * - **Per-Menu**: kasir picks which transaction_items + qty this customer
 *   pays. Server validates qty ≤ remaining unpaid per item.
 *
 * Each split is its own row in `split_payments`. When cumulative paid
 * reaches transactions.total, the bill auto-flips to status="paid"
 * with payment_method="split". Customer struk auto-prints for the
 * portion paid.
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
  const [amount, setAmount] = useState("");
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
    setAmount("");
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

  let parsedAmount = 0;
  try {
    parsedAmount = amount.length > 0 ? parseRupiah(amount) : 0;
  } catch {
    parsedAmount = 0;
  }
  const effectiveAmount =
    splitKind === "per_menu" ? perMenuComputedAmount : parsedAmount;

  let parsedCash = 0;
  try {
    parsedCash = cashInput.length > 0 ? parseRupiah(cashInput) : 0;
  } catch {
    parsedCash = 0;
  }
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
      setError(
        `Melebihi sisa bill (sisa ${formatRupiah(remaining)})`,
      );
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

    // Auto-print customer struk for the closing split (final payer).
    // Mid-splits skip auto-print — kasir can reprint via 4-button if needed.
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bayar Sebagian — ${bill.transactionNumber}`}
      description={
        breakdown
          ? `Sisa bill: ${formatRupiah(breakdown.remainingAmount)} (dari total ${formatRupiah(bill.total)})`
          : `Total bill: ${formatRupiah(bill.total)}`
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            size="lg"
            onClick={handleSubmit}
            loading={submitting}
            disabled={
              breakdownLoading ||
              effectiveAmount <= 0 ||
              effectiveAmount > remaining ||
              !cashSufficient
            }
          >
            {willClose ? "Selesaikan Bill" : `Catat Split`}
          </Button>
        </>
      }
    >
      {breakdownLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="size-6 text-mahakan-green-700" />
        </div>
      ) : !breakdown ? (
        <p className="text-sm text-danger-500">Gagal load breakdown</p>
      ) : (
        <div className="space-y-4">
          {breakdown.splits.length > 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs">
              <p className="mb-1 font-semibold text-neutral-900">
                Sudah dibayar ({breakdown.splits.length} split,{" "}
                {formatRupiah(breakdown.totalPaid)})
              </p>
              <ul className="space-y-0.5 text-neutral-600">
                {breakdown.splits.map((s, i) => (
                  <li key={s.id}>
                    #{i + 1}: {formatRupiah(s.amount)} via{" "}
                    {s.paymentMethod === "cash"
                      ? "tunai"
                      : s.paymentMethod === "qris"
                        ? "QRIS"
                        : "kartu BCA"}
                    {s.splitKind === "per_menu"
                      ? ` (${s.items.length} item)`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div
            role="radiogroup"
            aria-label="Tipe split"
            className="grid grid-cols-2 gap-2"
          >
            {(
              [
                { value: "nominal" as const, Icon: Coins, label: "Nominal" },
                {
                  value: "per_menu" as const,
                  Icon: ListTree,
                  label: "Per Menu",
                },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={splitKind === opt.value}
                onClick={() => setSplitKind(opt.value)}
                disabled={submitting}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border py-2 text-sm font-medium transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  splitKind === opt.value
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                )}
              >
                <opt.Icon className="size-4" aria-hidden />
                {opt.label}
              </button>
            ))}
          </div>

          {splitKind === "nominal" ? (
            <NumericInput
              label="Nominal yang dibayar"
              value={amount}
              onChange={setAmount}
              prefix="Rp"
              hint={
                parsedAmount > 0
                  ? `Preview: ${formatRupiah(parsedAmount)} (sisa setelah ini: ${formatRupiah(Math.max(0, remaining - parsedAmount))})`
                  : `Sisa bill: ${formatRupiah(remaining)}`
              }
              disabled={submitting}
            />
          ) : (
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3">
              <p className="text-xs font-medium text-neutral-700">
                Pilih item + qty yang dibayar customer ini:
              </p>
              <ul className="space-y-2 max-h-[280px] overflow-y-auto">
                {bill.items.map((it) => (
                  <PerMenuRow
                    key={it.id}
                    item={it}
                    paidQty={
                      breakdown.paidQuantityByTrxItemId[it.id] ?? 0
                    }
                    selected={perMenuQty[it.id] ?? 0}
                    disabled={submitting}
                    onChange={(q) =>
                      setItemQty(
                        it.id,
                        q,
                        it.quantity -
                          (breakdown.paidQuantityByTrxItemId[it.id] ?? 0),
                      )
                    }
                  />
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-sm">
                <span className="font-medium text-neutral-700">Subtotal</span>
                <span className="font-mono font-bold text-neutral-900">
                  {formatRupiah(perMenuComputedAmount)}
                </span>
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-900">
              Metode Pembayaran
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {(
                [
                  { value: "cash" as const, label: "Tunai", Icon: Banknote },
                  { value: "qris" as const, label: "QRIS", Icon: Wallet },
                  { value: "card_bca" as const, label: "BCA", Icon: Wallet },
                  { value: "card_bni" as const, label: "BNI", Icon: Wallet },
                  { value: "card_mandiri" as const, label: "Mandiri", Icon: Wallet },
                  { value: "card_bri" as const, label: "BRI", Icon: Wallet },
                  { value: "card_other" as const, label: "Lainnya", Icon: Wallet },
                ]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPaymentMethod(opt.value)}
                  disabled={submitting}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border py-2 text-sm font-medium transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                    paymentMethod === opt.value
                      ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                      : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                  )}
                >
                  <opt.Icon className="size-4" aria-hidden />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === "cash" && effectiveAmount > 0 ? (
            <div className="space-y-1">
              <NumericInput
                label="Tunai diterima"
                value={cashInput}
                onChange={setCashInput}
                prefix="Rp"
                disabled={submitting}
              />
              {parsedCash > 0 ? (
                <p className="text-xs text-neutral-700">
                  Diterima {formatRupiah(parsedCash)} → kembali{" "}
                  <span className="font-mono font-semibold">
                    {formatRupiah(cashChange)}
                  </span>
                  {!cashSufficient ? (
                    <Badge variant="danger" className="ml-2">
                      Kurang
                    </Badge>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}

          {willClose ? (
            <p className="rounded-md bg-success-100/40 p-2 text-xs text-success-500">
              Split ini akan menutup bill — auto-print struk customer.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function PerMenuRow({
  item,
  paidQty,
  selected,
  disabled,
  onChange,
}: {
  item: TransactionItem;
  paidQty: number;
  selected: number;
  disabled: boolean;
  onChange: (q: number) => void;
}) {
  const remaining = item.quantity - paidQty;
  const fullyPaid = remaining === 0;
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5",
        fullyPaid && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">
          {item.itemName}
          {item.variant
            ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
            : ""}
        </p>
        <p className="text-xs text-neutral-500">
          {item.quantity}x · {formatRupiah(item.unitPrice + item.modifiersPriceDelta)}/pcs
          {paidQty > 0 ? ` · sudah dibayar ${paidQty}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(selected - 1)}
          disabled={disabled || selected <= 0}
          className="size-7 rounded-md border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
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
          className="size-7 rounded-md border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </li>
  );
}
