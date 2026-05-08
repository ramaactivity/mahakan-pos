"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Transaction as TrxType } from "@/features/transactions";
import {
  AlertTriangle,
  ClipboardList,
  FileText,
  Pencil,
  Printer,
  RefreshCw,
  Split,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
} from "@/components/ui";
import { PrintStationButtons } from "./PrintStationButtons";
import { SplitPaymentModal } from "./SplitPaymentModal";
import {
  getTransactionsByIds,
  isOk,
  listTransactions,
  type Transaction,
  type TransactionWithItems,
} from "@/features/transactions";
import type { ReceiptConfig } from "@/lib/printer/print-transaction";
import { CloseOpenBillModal } from "./CloseOpenBillModal";
import { formatRupiah } from "@/lib/format";
import { formatDuration } from "@/lib/duration";
import { formatIndonesianTime } from "@/lib/date";
import { cn } from "@/lib/utils";

interface OpenBillPanelProps {
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  /** Bumped when other panels (history void/refund) commit. */
  refreshKey: number;
  onOpenSettings: () => void;
  /** Triggered when kasir taps Edit on a bill — parent should clone the
   * detail into a Draft and route to the cart panel for editing. */
  onEditBill: (trx: TransactionWithItems) => void;
  /** Reports the current open-bills count up to the parent so the left-nav
   * tab can render a badge without duplicating the fetch. */
  onCountChange?: (count: number) => void;
  /** Triggered when an open bill was just paid — parent surfaces the
   * post-action print confirm modal (item #17). */
  onBillPaid?: (closedTrx: TransactionWithItems) => void;
}

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * KDS-style queue of OPEN BILLS — transactions saved without payment yet.
 * Each card surfaces pager, total, items summary, time elapsed since save.
 * Bills older than 2 hours get a stale warning so kasir doesn't forget.
 *
 * Tap "Bayar Sekarang" to open CloseOpenBillModal which finalizes
 * payment + auto-prints customer struk + transitions status to "paid".
 */
export function OpenBillPanel({
  cashierName,
  receiptConfig,
  refreshKey,
  onOpenSettings,
  onEditBill,
  onCountChange,
  onBillPaid,
}: OpenBillPanelProps) {
  const [bills, setBills] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [details, setDetails] = useState<Record<string, TransactionWithItems>>(
    {},
  );
  const [closingBill, setClosingBill] = useState<TransactionWithItems | null>(
    null,
  );
  const [splittingBill, setSplittingBill] =
    useState<TransactionWithItems | null>(null);
  // Skeleton only on the very first fetch. Background polls (30s tick) and
  // parent-bumped refreshKey re-fetch silently — keeps card list visible
  // while kasir is interacting (sesi Z #1: "POS sering refresh sendiri").
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasLoadedOnce.current) setLoading(true);
      // sesi AD-7 — fetch ALL open bills (no date filter) so cross-day
      // bills (left over from yesterday or earlier) are visible AND
      // actionable. Previously today-only filter hid old open bills,
      // blocking shift close (server-side guard counted them but UI
      // didn't show them). 100 limit handles up to ~100 stale bills.
      const res = await listTransactions({
        status: "open",
        limit: 100,
      });
      if (cancelled) return;
      if (isOk(res)) {
        const sorted = [...res.data.items].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setBills(sorted);
        onCountChange?.(sorted.length);
      }
      setLoading(false);
      hasLoadedOnce.current = true;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tick, onCountChange]);

  // Auto-refresh every 30s — multi-cashier sync (another kasir may close
  // a bill from a parallel device).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Batch-fetch TransactionWithItems for all missing bills in a single
  // server call (4 round-trips total vs the previous N×3-4 sequential).
  // Galih ask #7 — addresses "loading open bill lama" perceptibly.
  useEffect(() => {
    let cancelled = false;
    async function loadDetails() {
      const missingIds = bills.filter((b) => !details[b.id]).map((b) => b.id);
      if (missingIds.length === 0) return;
      const res = await getTransactionsByIds(missingIds);
      if (cancelled) return;
      if (isOk(res)) {
        const fetched: Record<string, TransactionWithItems> = {};
        for (const t of res.data) fetched[t.id] = t;
        setDetails((prev) => ({ ...prev, ...fetched }));
      }
    }
    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [bills, details]);

  const totalOutstanding = useMemo(
    () => bills.reduce((s, b) => s + b.total, 0),
    [bills],
  );

  function handleBillClosed(closedTrx: TransactionWithItems) {
    setClosingBill(null);
    setTick((t) => t + 1);
    onBillPaid?.(closedTrx);
  }

  function handleSplitAdded(updatedTrx: TransactionWithItems) {
    // Force a refetch of the bill detail so the next render shows the new
    // split row in breakdown. If the bill closed via this split, also
    // bubble up the same way as a regular Bayar.
    setDetails((prev) => ({ ...prev, [updatedTrx.id]: updatedTrx }));
    setTick((t) => t + 1);
    if (updatedTrx.status === "paid") {
      setSplittingBill(null);
      onBillPaid?.(updatedTrx);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
              <FileText
                className="size-5 text-mahakan-green-700"
                aria-hidden
              />
              Bill Aktif Hari Ini
            </h2>
            <p className="text-sm text-neutral-500">
              {bills.length === 0
                ? "Tidak ada bill yang belum dibayar."
                : `${bills.length} bill belum dibayar · total Rp ${totalOutstanding.toLocaleString("id-ID")}`}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTick((t) => t + 1)}
          >
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Memuat bill">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : bills.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
              <ClipboardList className="size-6 text-neutral-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-neutral-700">
              Belum ada open bill.
            </p>
            <p className="max-w-xs text-xs text-neutral-500">
              Saat customer order tapi belum bayar, tap &ldquo;Simpan Bill&rdquo;
              di cart panel — bill akan muncul di sini sampai dibayar.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {bills.map((b) => (
              <BillCard
                key={b.id}
                summary={b}
                detail={details[b.id]}
                /* `tick` is bumped every 30s — we pipe it as a re-render
                 * signal so age-based labels (e.g. "5m") refresh without
                 * BillCard calling Date.now() directly during render. */
                nowTick={tick}
                onPay={() =>
                  details[b.id] ? setClosingBill(details[b.id]) : null
                }
                onSplit={() =>
                  details[b.id] ? setSplittingBill(details[b.id]) : null
                }
                onEdit={() =>
                  details[b.id] ? onEditBill(details[b.id]) : null
                }
                cashierName={cashierName}
                receiptConfig={receiptConfig}
                onOpenSettings={onOpenSettings}
              />
            ))}
          </ul>
        )}
      </div>

      <CloseOpenBillModal
        open={closingBill !== null}
        bill={closingBill}
        cashierName={cashierName}
        receiptConfig={receiptConfig}
        onClose={() => setClosingBill(null)}
        onClosed={handleBillClosed}
        onOpenSettings={onOpenSettings}
      />

      <SplitPaymentModal
        open={splittingBill !== null}
        bill={splittingBill}
        cashierName={cashierName}
        receiptConfig={receiptConfig}
        onClose={() => setSplittingBill(null)}
        onSplitAdded={handleSplitAdded}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}

interface BillCardProps {
  summary: Transaction;
  detail: TransactionWithItems | undefined;
  /** Bumped from parent's auto-refresh tick — used to invalidate age calc. */
  nowTick: number;
  onPay: () => void;
  onSplit: () => void;
  onEdit: () => void;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  onOpenSettings: () => void;
}

function BillCard({
  summary,
  detail,
  nowTick,
  onPay,
  onSplit,
  onEdit,
  cashierName,
  receiptConfig,
  onOpenSettings,
}: BillCardProps) {
  const [printOpen, setPrintOpen] = useState(false);
  const { ageMinutes, isStale } = useBillAge(summary.createdAt, nowTick);
  const ageHuman = formatDuration(ageMinutes * 60_000);

  const itemSummary =
    detail?.items
      .slice(0, 3)
      .map((it) => `${it.quantity}× ${it.itemName}`)
      .join(", ") + (detail && detail.items.length > 3 ? ", …" : "");

  return (
    <Card className={cn(isStale && "border-warning-500/50")}>
      <CardContent className="space-y-3 p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-mahakan-green-100 text-lg font-bold text-mahakan-green-900">
              {summary.pagerNumber !== null ? summary.pagerNumber : "—"}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-neutral-900">
                  {summary.transactionNumber}
                </span>
                {isStale ? (
                  <Badge variant="warning">
                    <AlertTriangle className="size-3" aria-hidden /> Lama (
                    {ageHuman})
                  </Badge>
                ) : (
                  <Badge variant="info">Belum lunas ({ageHuman})</Badge>
                )}
              </div>
              <p className="text-xs text-neutral-500">
                {formatIndonesianTime(summary.createdAt)} ·{" "}
                {summary.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
                {summary.customerName ? (
                  <span className="ml-1 font-medium text-neutral-800">
                    · {summary.customerName}
                  </span>
                ) : null}
              </p>
              {detail ? (
                <p className="mt-1 text-xs text-neutral-700 line-clamp-1">
                  {itemSummary}
                </p>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-neutral-500">Total</p>
            <p className="font-mono text-lg font-bold text-neutral-900">
              {formatRupiah(summary.total)}
            </p>
          </div>
        </header>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="md"
            variant="outline"
            onClick={() => setPrintOpen((v) => !v)}
            disabled={!detail}
          >
            <Printer className="size-4" aria-hidden />{" "}
            {printOpen ? "Tutup" : "Cetak Ulang"}
          </Button>
          <Button
            size="md"
            variant="outline"
            onClick={onEdit}
            disabled={!detail}
          >
            <Pencil className="size-4" aria-hidden /> Edit
          </Button>
          <Button
            size="md"
            variant="outline"
            onClick={onSplit}
            disabled={!detail}
          >
            <Split className="size-4" aria-hidden /> Bayar Sebagian
          </Button>
          <Button
            size="md"
            onClick={onPay}
            disabled={!detail}
            loading={!detail}
          >
            Bayar Sekarang
          </Button>
        </div>

        {printOpen && detail ? (
          <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
            <p className="mb-2 text-xs font-medium text-neutral-700">
              Cetak ulang struk untuk bill ini:
            </p>
            <PrintStationButtons
              trx={detail}
              cashierName={cashierName}
              receiptConfig={receiptConfig}
              onOpenSettings={onOpenSettings}
              size="sm"
              layout="grid"
            />
          </div>
        ) : null}

        {isStale ? (
          <p className="rounded-md bg-warning-100/40 p-2 text-xs text-warning-500">
            ⚠️ Bill ini sudah {ageHuman} belum dibayar. Tanyakan customer
            atau follow-up agar tidak terlewat.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Compute age in ms from createdAt — wrapped so Date.now() lives in an
 * effect rather than during render (React 19 purity rule). Recomputes
 * whenever parent ticks via nowTick. */
function useBillAge(
  createdAt: TrxType["createdAt"],
  nowTick: number,
): { ageMinutes: number; isStale: boolean } {
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, [nowTick]);
  if (now === 0) return { ageMinutes: 0, isStale: false };
  const ageMs = now - new Date(createdAt).getTime();
  return {
    ageMinutes: Math.max(0, Math.floor(ageMs / 60_000)),
    isStale: ageMs > STALE_THRESHOLD_MS,
  };
}
