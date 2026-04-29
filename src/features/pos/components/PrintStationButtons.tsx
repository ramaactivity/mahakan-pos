"use client";

import { ChefHat, Coffee, Printer, Receipt } from "lucide-react";
import { useState } from "react";
import { Button, toast } from "@/components/ui";
import {
  getStationCoverage,
  printTickets,
  type ReceiptConfig,
  type TicketSection,
} from "@/lib/printer/print-transaction";
import type { TransactionWithItems } from "@/features/transactions";
import { cn } from "@/lib/utils";

interface PrintStationButtonsProps {
  trx: TransactionWithItems;
  cashierName: string;
  /** Outlet-driven receipt config (header/footer/wifi/etc). When null,
   * falls back to hardcoded defaults inside printTickets. */
  receiptConfig?: ReceiptConfig | null;
  /** Called when "Pasangkan printer" toast action is tapped. */
  onOpenSettings?: () => void;
  /** Visual size — sm fits in compact card rows, md for prominent actions. */
  size?: "sm" | "md";
  /** Layout — "row" = 4 buttons in a row; "grid" = 2x2 on mobile, row on lg. */
  layout?: "row" | "grid";
  /** Called after a successful print, with the section key + sections. Used
   * by HistoryDetailModal to emit `transaction.reprint` audit events. */
  onAfterPrint?: (key: SectionKey, sections: TicketSection[]) => void;
  className?: string;
}

const SECTION_LABEL = {
  customer: "Struk customer",
  kitchen: "Tiket dapur",
  bar: "Tiket bar",
  all: "Semua tiket",
} as const;

type SectionKey = keyof typeof SECTION_LABEL;

/**
 * Reusable 4-button print bar — Customer / Dapur / Bar / Semua. Disables
 * per-station buttons when the transaction has no items at that station.
 *
 * Used by PaidPanel (post-payment), OrderQueuePanel (queue), and
 * HistoryDetailModal (reprint old transactions).
 */
export function PrintStationButtons({
  trx,
  cashierName,
  receiptConfig,
  onOpenSettings,
  size = "sm",
  layout = "grid",
  onAfterPrint,
  className,
}: PrintStationButtonsProps) {
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);
  const coverage = getStationCoverage(trx);

  async function handlePrint(key: SectionKey, sections: TicketSection[]) {
    if (activeSection !== null) return;
    if (!receiptConfig) {
      toast.error("Outlet config belum dimuat. Coba refresh atau tunggu sebentar.");
      return;
    }
    setActiveSection(key);
    const outcome = await printTickets(trx, cashierName, sections, receiptConfig);
    setActiveSection(null);
    if (outcome.ok) {
      onAfterPrint?.(key, sections);
      toast.success(`${SECTION_LABEL[key]} dicetak`);
      return;
    }
    if (outcome.reason === "not_paired") {
      toast.error("Printer belum di-pair", {
        description: "Pasangkan printer di tab Pengaturan dulu.",
        action: onOpenSettings
          ? { label: "Buka", onClick: onOpenSettings }
          : undefined,
      });
      return;
    }
    toast.error(outcome.message);
  }

  return (
    <div
      className={cn(
        "gap-2",
        layout === "row"
          ? "flex flex-wrap"
          : "grid grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      <Button
        size={size}
        variant="outline"
        onClick={() => handlePrint("customer", ["customer"])}
        loading={activeSection === "customer"}
        disabled={activeSection !== null && activeSection !== "customer"}
      >
        <Receipt className="size-4" aria-hidden /> Customer
      </Button>
      <Button
        size={size}
        variant="outline"
        onClick={() => handlePrint("kitchen", ["kitchen"])}
        loading={activeSection === "kitchen"}
        disabled={
          !coverage.hasKitchen ||
          (activeSection !== null && activeSection !== "kitchen")
        }
        title={
          !coverage.hasKitchen
            ? "Tidak ada item dapur di transaksi ini"
            : undefined
        }
      >
        <ChefHat className="size-4" aria-hidden /> Dapur
      </Button>
      <Button
        size={size}
        variant="outline"
        onClick={() => handlePrint("bar", ["bar"])}
        loading={activeSection === "bar"}
        disabled={
          !coverage.hasBar ||
          (activeSection !== null && activeSection !== "bar")
        }
        title={
          !coverage.hasBar
            ? "Tidak ada item minuman di transaksi ini"
            : undefined
        }
      >
        <Coffee className="size-4" aria-hidden /> Bar
      </Button>
      <Button
        size={size}
        onClick={() =>
          handlePrint("all", ["customer", "kitchen", "bar"])
        }
        loading={activeSection === "all"}
        disabled={activeSection !== null && activeSection !== "all"}
      >
        <Printer className="size-4" aria-hidden /> Semua
      </Button>
    </div>
  );
}
