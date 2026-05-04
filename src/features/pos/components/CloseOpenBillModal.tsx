"use client";

import { useEffect, useState } from "react";
import { Banknote, CreditCard, QrCode } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
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

const QUICK_AMOUNTS = [50_000, 100_000, 200_000];

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

  if (!bill) return null;

  const cashReceived = parseInt(cashInput || "0", 10) || 0;
  const cashChange = Math.max(0, cashReceived - bill.total);
  const cashSufficient =
    paymentMethod !== "cash" || cashReceived >= bill.total;

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
    // Auto-print customer receipt — best-effort, silent on printer fail.
    // Skip if outlet config not yet loaded; struk reprint via Riwayat after.
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bayar Open Bill — ${bill.transactionNumber}`}
      description={`${bill.pagerNumber !== null ? `Pager ${bill.pagerNumber} · ` : ""}${bill.items.length} item · ${formatRupiah(bill.total)}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            size="lg"
            onClick={handleConfirm}
            loading={submitting}
            disabled={paymentMethod === "cash" && !cashSufficient}
          >
            Konfirmasi Bayar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-mahakan-green-100/50 p-3">
          <p className="text-xs uppercase tracking-wide text-mahakan-green-900/70">
            Total
          </p>
          <p className="font-mono text-2xl font-bold text-mahakan-green-900">
            {formatRupiah(bill.total)}
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-neutral-900">Metode Bayar</p>
          <div
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            role="radiogroup"
            aria-label="Metode pembayaran"
          >
            <MethodButton
              active={paymentMethod === "cash"}
              onClick={() => setPaymentMethod("cash")}
              label="Tunai"
              Icon={Banknote}
            />
            <MethodButton
              active={paymentMethod === "qris"}
              onClick={() => setPaymentMethod("qris")}
              label="QRIS"
              Icon={QrCode}
            />
            <MethodButton
              active={paymentMethod === "card_bca"}
              onClick={() => setPaymentMethod("card_bca")}
              label="BCA"
              Icon={CreditCard}
            />
            <MethodButton
              active={paymentMethod === "card_bni"}
              onClick={() => setPaymentMethod("card_bni")}
              label="BNI"
              Icon={CreditCard}
            />
            <MethodButton
              active={paymentMethod === "card_mandiri"}
              onClick={() => setPaymentMethod("card_mandiri")}
              label="Mandiri"
              Icon={CreditCard}
            />
            <MethodButton
              active={paymentMethod === "card_bri"}
              onClick={() => setPaymentMethod("card_bri")}
              label="BRI"
              Icon={CreditCard}
            />
            <MethodButton
              active={paymentMethod === "card_other"}
              onClick={() => setPaymentMethod("card_other")}
              label="Lainnya"
              Icon={CreditCard}
            />
          </div>
        </div>

        {paymentMethod === "cash" ? (
          <div className="space-y-2">
            <Input
              label="Tunai Diterima"
              type="text"
              inputMode="numeric"
              value={cashInput}
              onChange={(e) =>
                setCashInput(e.target.value.replace(/[^\d]/g, ""))
              }
              placeholder="0"
              hint={
                cashReceived > 0
                  ? `${formatRupiah(cashReceived)} (kembalian ${formatRupiah(cashChange)})`
                  : undefined
              }
            />
            <div className="flex gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <Button
                  key={amt}
                  size="sm"
                  variant="outline"
                  onClick={() => setCashInput(String(amt))}
                  className="flex-1"
                >
                  {formatRupiah(amt)}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCashInput(String(bill.total))}
                className="flex-1"
              >
                Pas
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-danger-100 p-2 text-sm text-danger-500"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function MethodButton({
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
        "flex flex-col items-center justify-center gap-1 rounded-md border p-3 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
      )}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  );
}
