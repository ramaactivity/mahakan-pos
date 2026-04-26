"use client";

import { useEffect, useState } from "react";
import { Bluetooth, Printer } from "lucide-react";
import { Badge, Button, toast } from "@/components/ui";
import {
  getPrinterClient,
  isWebBluetoothSupported,
  type PrinterStatus,
} from "@/lib/printer/bluetooth";
import { buildReceipt } from "@/lib/printer/receipt-builder";

/**
 * Pairing + status + test-print panel for admin Settings → Thermal Printer.
 *
 * Web Bluetooth requires a user gesture for `requestDevice`, so the Pair
 * button is the entry point. Once paired, browser remembers the device
 * for this origin; subsequent test prints reuse the connection.
 */
export function PrinterControls() {
  const [status, setStatus] = useState<PrinterStatus>(() =>
    getPrinterClient().getStatus(),
  );
  const [busy, setBusy] = useState(false);
  const supported = isWebBluetoothSupported();

  useEffect(() => {
    return getPrinterClient().subscribe(setStatus);
  }, []);

  if (!supported) {
    return (
      <div className="rounded-md border border-warning-500/30 bg-warning-100 p-3 text-sm text-warning-500">
        Web Bluetooth tidak didukung di browser ini. Pakai Chrome/Edge di
        Android tablet.
      </div>
    );
  }

  async function onPair() {
    setBusy(true);
    try {
      await getPrinterClient().pair();
      toast.success("Printer di-pair");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pair gagal");
    } finally {
      setBusy(false);
    }
  }

  async function onTestPrint() {
    setBusy(true);
    try {
      const bytes = buildReceipt({
        outletName: "Mahakan Coffee & Space",
        outletAddress: "Test Print",
        outletPhone: null,
        transactionNumber: "TEST-PRINT",
        pagerNumber: 0,
        orderType: "takeaway",
        createdAt: new Date(),
        cashierName: "Test",
        items: [
          {
            name: "Test Item",
            variant: null,
            quantity: 1,
            unitPrice: 0,
            modifiersPriceDelta: 0,
            subtotal: 0,
            note: null,
            openPriceNote: null,
            modifiers: [],
          },
        ],
        subtotal: 0,
        discountAmount: 0,
        discountReason: null,
        total: 0,
        paymentMethod: "cash",
        cashReceived: 0,
        cashChange: 0,
        status: "paid",
        footerText: "Test print berhasil!",
      });
      await getPrinterClient().send(bytes);
      toast.success("Test print terkirim");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Print gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
        {status.deviceName ? (
          <span className="text-sm text-neutral-700">
            {status.deviceName}
          </span>
        ) : null}
      </div>

      {status.error ? (
        <p className="rounded-md bg-danger-100 p-2 text-xs text-danger-500">
          {status.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onPair} loading={busy} variant="outline">
          <Bluetooth className="size-4" aria-hidden /> Pair Printer
        </Button>
        <Button
          onClick={onTestPrint}
          loading={busy}
          disabled={!status.deviceName}
        >
          <Printer className="size-4" aria-hidden /> Test Print
        </Button>
      </div>

      <p className="text-xs text-neutral-500">
        Setelah pair, printer akan otomatis cetak struk saat transaksi
        sukses. Test print mengirim 1 baris dummy untuk verifikasi.
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: PrinterStatus }) {
  if (status.state === "connected") return <Badge variant="success">Tersambung</Badge>;
  if (status.state === "connecting") return <Badge variant="info">Menyambungkan…</Badge>;
  if (status.state === "pairing") return <Badge variant="info">Pairing…</Badge>;
  if (status.state === "error") return <Badge variant="danger">Error</Badge>;
  if (status.deviceName) return <Badge variant="neutral">Idle</Badge>;
  return <Badge variant="warning">Belum di-pair</Badge>;
}
