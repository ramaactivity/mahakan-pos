"use client";

import { CheckCircle2 } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { PrintStationButtons } from "@/features/pos/components/PrintStationButtons";
import type { TransactionWithItems } from "@/features/transactions";
import { formatIndonesianDateTime } from "@/lib/date";
import { formatRupiah } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-method";
import type { ReceiptConfig } from "@/lib/printer/print-transaction";

interface TransactionSuccessModalProps {
  open: boolean;
  trx: TransactionWithItems;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  onFinish: () => void;
  onOpenSettings: () => void;
}

/**
 * Post-payment success — sesi AD-4 redesign per staff feedback.
 *
 * Old design: success state replaced cart panel inline (right column,
 * 280-380px wide). Receipt preview cramped in tiny font, print buttons
 * in 2x2 grid. Cart was hidden until staff tap "Selesai".
 *
 * New design: dedicated 2-column modal.
 * - LEFT (60%): Full receipt preview at readable size (text-xs not text-[10px])
 * - RIGHT (40%): Big checkmark + change amount, Cetak Tiket buttons in
 *   2x2 grid with bigger tap targets, "Selesai" CTA at bottom
 *
 * size="fullscreen" → edge-to-edge on tablet (touch:), centered max-w-6xl
 * on desktop (pointer:fine).
 *
 * Modal blocks until staff tap "Selesai" so they can verify receipt
 * before printing kitchen/bar tickets. Backdrop close disabled
 * (default) prevents accidental dismiss.
 */
export function TransactionSuccessModal({
  open,
  trx,
  cashierName,
  receiptConfig,
  onFinish,
  onOpenSettings,
}: TransactionSuccessModalProps) {
  if (!open) return null;

  const isCash = trx.paymentMethod === "cash";
  const cashChange = trx.cashChange ?? 0;

  return (
    <Modal
      open={open}
      onClose={onFinish}
      size="fullscreen"
      bodyPadding="none"
      disableEscClose={false}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-xs text-neutral-600 sm:block">
            Verifikasi struk · cetak tiket dapur/bar saat siap call order
          </p>
          <Button
            size="xl"
            onClick={onFinish}
            className="!h-12 min-w-[200px] touch:min-w-[260px] !text-base"
          >
            Selesai (Order Disiapkan)
          </Button>
        </div>
      }
    >
      <div className="grid h-full divide-y divide-neutral-200 lg:grid-cols-[3fr_2fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[3fr_2fr] touch:divide-x touch:divide-y-0">
        {/* ============================================================ */}
        {/* LEFT — Receipt preview                                       */}
        {/* ============================================================ */}
        <div className="flex flex-col overflow-y-auto bg-neutral-50 p-4 touch:p-3">
          <div className="mx-auto w-full max-w-md rounded-lg border border-neutral-200 bg-white p-4 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm">
            <div className="text-center">
              <p className="font-bold tracking-wide">
                {receiptConfig?.outletName ?? "Mahakan Coffee & Space"}
              </p>
              <p className="text-[11px]">
                {receiptConfig?.outletAddress ?? "Puncak Rd KM 22, Cisarua"}
              </p>
              <p className="text-[11px]">
                {receiptConfig?.outletPhone ?? "0838-1977-5665"}
              </p>
            </div>
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <ReceiptLine
              left={trx.transactionNumber}
              right={trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
            />
            {trx.pagerNumber !== null ? (
              <ReceiptLine left="Pager" right={String(trx.pagerNumber)} />
            ) : null}
            {trx.customerName ? (
              <ReceiptLine left="Nama" right={trx.customerName} />
            ) : null}
            <ReceiptLine left="Kasir" right={cashierName} />
            <ReceiptLine
              left="Waktu"
              right={formatIndonesianDateTime(trx.createdAt)}
            />
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <div className="space-y-1">
              {trx.items.map((item) => (
                <div key={item.id}>
                  <ReceiptLine
                    left={`${item.quantity}× ${item.itemName}${
                      item.variant
                        ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
                        : ""
                    }`}
                    right={formatRupiah(item.subtotal)}
                  />
                  {item.modifiers.length > 0 ? (
                    <p className="pl-3 text-[11px] text-neutral-600">
                      {item.modifiers
                        .map((m) => m.selectedValue ?? m.modifierSlug)
                        .join(", ")}
                    </p>
                  ) : null}
                  {item.openPriceNote ? (
                    <p className="pl-3 text-[11px] italic text-neutral-700">
                      {item.openPriceNote}
                    </p>
                  ) : null}
                  {item.note ? (
                    <p className="pl-3 text-[11px] italic text-neutral-600">
                      &ldquo;{item.note}&rdquo;
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <ReceiptLine left="Subtotal" right={formatRupiah(trx.subtotal)} />
            {trx.discountAmount > 0 ? (
              <ReceiptLine
                left={`Diskon ${
                  trx.discountType === "percent" ? `${trx.discountValue}%` : ""
                }`}
                right={`- ${formatRupiah(trx.discountAmount)}`}
              />
            ) : null}
            <ReceiptLine left="TOTAL" right={formatRupiah(trx.total)} bold />
            <div className="my-1 border-t border-dashed border-neutral-300" />
            <ReceiptLine
              left="Bayar"
              right={
                isCash
                  ? `${paymentMethodLabel(trx.paymentMethod)} ${formatRupiah(trx.cashReceived ?? 0)}`
                  : paymentMethodLabel(trx.paymentMethod)
              }
            />
            {isCash ? (
              <ReceiptLine left="Kembali" right={formatRupiah(cashChange)} />
            ) : null}
            <div className="mt-3 text-center">
              <p className="text-[11px]">Terima kasih, sampai jumpa!</p>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* RIGHT — Status hero + Print buttons                          */}
        {/* ============================================================ */}
        <div className="flex flex-col gap-4 p-4 touch:gap-3 touch:p-3">
          {/* Hero — checkmark + title + trx number + change */}
          <div className="flex flex-col items-center gap-2 rounded-xl bg-gradient-to-b from-success-100/60 to-white p-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-success-500/15 ring-4 ring-success-500/20">
              <CheckCircle2 className="size-8 text-success-500" aria-hidden />
            </div>
            <p className="text-lg font-bold text-neutral-900">
              Transaksi Berhasil
            </p>
            <p className="font-mono text-xs text-neutral-600">
              {trx.transactionNumber}
            </p>
          </div>

          {/* Cash change emphasis (only when applicable) */}
          {isCash && cashChange > 0 ? (
            <div className="flex items-center justify-between rounded-lg border-2 border-success-500 bg-success-100 px-4 py-3">
              <span className="text-sm font-semibold text-success-500">
                Kembalian
              </span>
              <span className="font-mono text-2xl font-bold tabular-nums text-success-500">
                {formatRupiah(cashChange)}
              </span>
            </div>
          ) : null}

          {/* Print Tickets section */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                Cetak Tiket
              </h3>
              <span className="text-[11px] text-neutral-600">
                Auto: customer
              </span>
            </div>
            <PrintStationButtons
              trx={trx}
              cashierName={cashierName}
              receiptConfig={receiptConfig}
              onOpenSettings={onOpenSettings}
              size="md"
            />
            <p className="text-[11px] text-neutral-600">
              Struk customer otomatis tercetak. Tap Dapur / Bar saat siap
              call order ke barista.
            </p>
          </section>
        </div>
      </div>
    </Modal>
  );
}

function ReceiptLine({
  left,
  right,
  bold,
}: {
  left: string;
  right: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-2 ${
        bold ? "font-bold" : ""
      }`}
    >
      <span className="min-w-0 flex-1 break-words">{left}</span>
      <span className="shrink-0">{right}</span>
    </div>
  );
}
