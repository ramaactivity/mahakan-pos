"use client";

import { useEffect, useState } from "react";
import { Banknote, CheckCircle2, CreditCard, Loader2, QrCode, Wallet } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  closeOpenBill,
  isOk,
  type PaymentMethod,
  type TransactionWithItems,
} from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import {
  printTickets,
  type ReceiptConfig,
} from "@/lib/printer/print-transaction";
import { cn } from "@/lib/utils";

interface CloseOpenBillModalProps {
  open: boolean;
  bill: TransactionWithItems | null;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  onClose: () => void;
  onClosed: (closedTrx: TransactionWithItems) => void;
  onOpenSettings: () => void;
}

const QUICK_AMOUNTS = [20_000, 50_000, 100_000, 200_000];

/**
 * Close (pay) an open bill — sesi AD-7 redesign per staff feedback.
 *
 * OLD: size="md" centered modal with native `inputMode="numeric"` input.
 * Triggered Android keyboard from bottom of screen, blocking action
 * buttons + scrollable content.
 *
 * NEW: size="fullscreen" 2-column edge-to-edge modal mirroring main
 * PaymentModal. Custom numpad (no native keyboard), 7 method tiles in
 * 1 row, full bill summary visible LEFT.
 *
 * Layout (Galaxy A7 Lite landscape 1340×800):
 *   LEFT 2fr (~535px): Bill summary — trx number, items list, total
 *   RIGHT 3fr (~805px): Method tiles + (cash: display + quick amounts +
 *                       numpad) or (non-cash: instruction)
 *   Footer: Konfirmasi Bayar full-width
 */
export function CloseOpenBillModal({
  open,
  bill,
  cashierName,
  receiptConfig,
  onClose,
  onClosed,
  onOpenSettings,
}: CloseOpenBillModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPaymentMethod("cash");
    setCashInput("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, bill?.id]);

  // Keyboard shortcuts — same UX as main PaymentModal (sesi AD-1).
  // Hook MUST run unconditionally; we gate inside.
  useEffect(() => {
    if (!open || !bill || paymentMethod !== "cash") return;
    function onKey(e: KeyboardEvent) {
      const total = bill?.total ?? 0;
      const received = parseInt(cashInput || "0", 10) || 0;
      const sufficient = received >= total;

      if (e.key === "Enter") {
        if (!submitting && sufficient) {
          e.preventDefault();
          void handleConfirm();
        }
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        setCashInput((s) => s.slice(0, -1));
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setCashInput((s) => s + e.key);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bill?.id, paymentMethod, cashInput, submitting]);

  if (!open || !bill) return null;

  const cashReceived = parseInt(cashInput || "0", 10) || 0;
  const cashChange = Math.max(0, cashReceived - bill.total);
  const cashSufficient =
    paymentMethod !== "cash" || cashReceived >= bill.total;
  const isCash = paymentMethod === "cash";
  const cardLabel = methodLabel(paymentMethod);

  async function handleConfirm() {
    if (!bill) return;
    if (submitting) return;
    setError(null);
    if (paymentMethod === "cash" && !cashSufficient) {
      setError("Nominal tunai kurang dari total");
      return;
    }
    setSubmitting(true);
    const res = await closeOpenBill({
      transactionId: bill.id,
      paymentMethod,
      cashReceived: paymentMethod === "cash" ? cashReceived : null,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(
      `Open bill ${res.data.transactionNumber} di-close (${formatRupiah(res.data.total)})`,
    );
    if (receiptConfig) {
      void printTickets(res.data, cashierName, ["customer"], receiptConfig).then(
        (outcome) => {
          if (!outcome.ok && outcome.reason === "not_paired") {
            toast.error("Printer belum di-pair", {
              description: "Pasangkan printer di Pengaturan untuk auto-print.",
              action: { label: "Buka", onClick: onOpenSettings },
            });
          }
        },
      );
    }
    setSubmitting(false);
    onClosed(res.data);
  }

  const headerSubtitle = [
    bill.pagerNumber !== null ? `Pager ${bill.pagerNumber}` : null,
    bill.customerName?.trim() || null,
    `${bill.items.length} item`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bayar Open Bill — ${bill.transactionNumber}`}
      description={headerSubtitle || undefined}
      size="fullscreen"
      bodyPadding="none"
      disableEscClose={submitting}
      footer={
        <Button
          size="xl"
          onClick={handleConfirm}
          loading={submitting}
          disabled={!cashSufficient || submitting}
          fullWidth
          className="!h-14 !text-base touch:!h-12"
        >
          {submitting
            ? "Memproses…"
            : isCash
              ? cashSufficient
                ? `Konfirmasi Bayar ${formatRupiah(bill.total)}`
                : `Kurang ${formatRupiah(bill.total - cashReceived)}`
              : `Sudah Lunas ${cardLabel}`}
        </Button>
      }
    >
      <div className="grid h-full divide-y divide-neutral-200 lg:grid-cols-[2fr_3fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
        {/* ============================================================ */}
        {/* LEFT — Bill summary                                          */}
        {/* ============================================================ */}
        <div className="flex flex-col gap-3 overflow-y-auto p-4 touch:p-3">
          <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Bill Aktif
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-neutral-900">
              {bill.transactionNumber}
            </p>
            {bill.customerName ? (
              <p className="mt-1 text-sm text-neutral-700">{bill.customerName}</p>
            ) : null}
            {bill.pagerNumber !== null ? (
              <p className="text-xs text-neutral-600">
                Pager <span className="font-mono">{bill.pagerNumber}</span>
              </p>
            ) : null}
          </section>

          <section className="flex-1">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Items ({bill.items.reduce((s, i) => s + i.quantity, 0)})
            </h3>
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
              {bill.items.map((item) => (
                <li key={item.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-900">
                        <span className="mr-2 inline-flex size-6 items-center justify-center rounded-md bg-mahakan-green-100 text-xs font-bold text-mahakan-green-900">
                          {item.quantity}
                        </span>
                        {item.itemName}
                        {item.variant ? (
                          <span className="ml-1.5 text-xs text-neutral-600">
                            · {item.variant === "hot" ? "Hot" : "Iced"}
                          </span>
                        ) : null}
                      </p>
                      {item.modifiers.length > 0 ? (
                        <p className="mt-0.5 pl-8 text-xs text-neutral-600">
                          {item.modifiers
                            .map((m) => m.selectedValue ?? m.modifierSlug)
                            .join(", ")}
                        </p>
                      ) : null}
                      {item.note ? (
                        <p className="mt-0.5 pl-8 text-xs italic text-neutral-600">
                          &ldquo;{item.note}&rdquo;
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold text-neutral-900">
                      {formatRupiah(item.subtotal)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-neutral-900">TOTAL</span>
              <span className="font-mono text-2xl font-bold text-mahakan-green-900">
                {formatRupiah(bill.total)}
              </span>
            </div>
          </section>
        </div>

        {/* ============================================================ */}
        {/* RIGHT — Method + payment input                              */}
        {/* ============================================================ */}
        <div className="flex flex-col gap-2.5 overflow-y-auto p-4 touch:gap-2 touch:overflow-hidden touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none touch:min-h-0">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Metode Pembayaran
            </h3>
            <div
              className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-4 touch:grid-cols-7 touch:gap-1.5"
              role="radiogroup"
              aria-label="Metode pembayaran"
            >
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
                Icon={Wallet}
              />
            </div>
          </section>

          {isCash ? (
            <CashInputPanel
              setCashInput={setCashInput}
              cashReceived={cashReceived}
              cashChange={cashChange}
              cashSufficient={cashSufficient}
              total={bill.total}
              submitting={submitting}
            />
          ) : (
            <NonCashInstruction
              method={paymentMethod}
              total={bill.total}
              submitting={submitting}
            />
          )}

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
    </Modal>
  );
}

// ============================================================
// RIGHT COLUMN — sub-components (mirror of PaymentModal patterns)
// ============================================================

function CashInputPanel({
  setCashInput,
  cashReceived,
  cashChange,
  cashSufficient,
  total,
  submitting,
}: {
  setCashInput: React.Dispatch<React.SetStateAction<string>>;
  cashReceived: number;
  cashChange: number;
  cashSufficient: boolean;
  total: number;
  submitting: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
          submitting && "opacity-60",
          cashReceived === 0
            ? "border-neutral-300 bg-white"
            : cashSufficient
              ? "border-success-500 bg-success-100"
              : "border-warning-500 bg-warning-100",
        )}
      >
        {cashReceived > 0 ? (
          <span className="font-mono text-3xl font-bold tabular-nums text-neutral-900 touch:text-2xl">
            {formatRupiah(cashReceived)}
          </span>
        ) : (
          <span className="font-mono text-base text-neutral-400 touch:text-sm">
            Tap angka atau quick amount
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {QUICK_AMOUNTS.map((amt) => (
          <button
            key={amt}
            type="button"
            onClick={() => setCashInput(String(amt))}
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
          onClick={() => setCashInput(String(total))}
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

      <div className="grid grid-cols-3 gap-1.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <NumpadKey
            key={d}
            label={d}
            onPress={() => setCashInput((s) => s + d)}
            disabled={submitting}
          />
        ))}
        <NumpadKey
          label="C"
          onPress={() => setCashInput("")}
          disabled={submitting}
          variant="muted"
        />
        <NumpadKey
          label="0"
          onPress={() => setCashInput((s) => s + "0")}
          disabled={submitting}
        />
        <NumpadKey
          label="⌫"
          onPress={() => setCashInput((s) => s.slice(0, -1))}
          disabled={submitting}
          variant="muted"
        />
      </div>

      <div
        className={cn(
          "flex items-center justify-between rounded-lg border-2 px-4 py-2",
          cashReceived === 0
            ? "border-neutral-200 bg-neutral-50"
            : cashSufficient
              ? "border-success-500 bg-success-100 text-success-500"
              : "border-warning-500 bg-warning-100 text-warning-500",
        )}
      >
        <span className="text-sm font-semibold">
          {cashReceived === 0
            ? "Kembalian"
            : cashSufficient
              ? "Kembalian"
              : "Kurang"}
        </span>
        <span className="font-mono text-lg font-bold tabular-nums">
          {cashReceived === 0
            ? "—"
            : cashSufficient
              ? formatRupiah(cashChange)
              : formatRupiah(total - cashReceived)}
        </span>
      </div>
    </>
  );
}

function NonCashInstruction({
  method,
  total,
  submitting,
}: {
  method: PaymentMethod;
  total: number;
  submitting: boolean;
}) {
  const isQris = method === "qris";
  const Icon = isQris ? QrCode : CreditCard;
  const title = isQris
    ? "Tunggu konfirmasi QRIS"
    : `Tunggu approval ${methodLabel(method)}`;
  const hint = isQris
    ? "Customer scan QRIS dari struk / sticker. Cek aplikasi bank merchant kalau perlu."
    : "Tap kartu di mesin EDC. Pastikan struk approved + sesuai amount sebelum konfirmasi.";

  return (
    <div className="space-y-3 rounded-xl border border-info-300 bg-info-100 p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        {submitting ? (
          <Loader2 className="size-10 animate-spin text-info-500" />
        ) : (
          <Icon className="size-10 text-info-500" aria-hidden />
        )}
        <p className="text-sm font-semibold text-info-500">{title}</p>
        <p className="font-mono text-2xl font-bold text-mahakan-green-900">
          {formatRupiah(total)}
        </p>
        <p className="max-w-md text-xs text-neutral-700">{hint}</p>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-xs text-neutral-600">
        <CheckCircle2 className="size-3.5 shrink-0 text-success-500" aria-hidden />
        Tap <strong>Sudah Lunas</strong> di footer setelah customer berhasil bayar.
      </div>
    </div>
  );
}

// ============================================================
// Atoms
// ============================================================

function MethodTile({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 py-2 text-xs font-medium transition-colors touch:py-1.5 touch:text-[11px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "active:scale-95",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900 shadow-sm"
          : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function NumpadKey({
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
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
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

function methodLabel(m: PaymentMethod): string {
  switch (m) {
    case "cash":
      return "Tunai";
    case "qris":
      return "QRIS";
    case "card_bca":
      return "Kartu BCA";
    case "card_bni":
      return "Kartu BNI";
    case "card_mandiri":
      return "Kartu Mandiri";
    case "card_bri":
      return "Kartu BRI";
    case "card_other":
      return "Kartu Lainnya";
    case "split":
      return "Split";
  }
}
