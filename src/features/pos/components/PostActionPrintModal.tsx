"use client";

import { Button, Modal } from "@/components/ui";
import type { TransactionWithItems } from "@/features/transactions";
import type { ReceiptConfig } from "@/lib/printer/print-transaction";
import { PrintStationButtons } from "./PrintStationButtons";

interface PostActionPrintModalProps {
  open: boolean;
  trx: TransactionWithItems | null;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  /** Title shown atop the modal — e.g. "Bill disimpan", "Pembayaran sukses",
   * "Bill di-update". Customizes context per entry point. */
  title: string;
  /** Optional description line below the title. */
  description?: string;
  onClose: () => void;
  onOpenSettings?: () => void;
}

/**
 * Confirmation modal that surfaces all 4 print-station buttons after a
 * commit action so kasir can decide what to print (Customer / Dapur / Bar
 * / Semua). Replaces silent or single-station auto-print with explicit
 * choice — covers cases where customer asks for receipt or sold-out item
 * needs follow-up. Galih addendum #17.
 */
export function PostActionPrintModal({
  open,
  trx,
  cashierName,
  receiptConfig,
  title,
  description,
  onClose,
  onOpenSettings,
}: PostActionPrintModalProps) {
  if (!trx) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={
        description ??
        `${trx.transactionNumber}${trx.pagerNumber !== null ? ` · Pager ${trx.pagerNumber}` : ""} · ${trx.items.length} item`
      }
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Selesai
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-neutral-700">
          Pilih struk yang mau dicetak. Tap &ldquo;Selesai&rdquo; kalau tidak
          perlu.
        </p>
        <PrintStationButtons
          trx={trx}
          cashierName={cashierName}
          receiptConfig={receiptConfig}
          onOpenSettings={onOpenSettings}
          size="md"
          layout="grid"
        />
      </div>
    </Modal>
  );
}
