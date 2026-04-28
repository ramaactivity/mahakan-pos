"use client";

import { useEffect, useMemo, useState } from "react";
import type { Transaction as TrxType } from "@/features/transactions";
import { AlertTriangle, ClipboardList, FileText, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
} from "@/components/ui";
import {
  getTransaction,
  isOk,
  listTransactions,
  type Transaction,
  type TransactionWithItems,
} from "@/features/transactions";
import type { ReceiptConfig } from "@/lib/printer/print-transaction";
import { CloseOpenBillModal } from "./CloseOpenBillModal";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime, toJakartaDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

interface OpenBillPanelProps {
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  /** Bumped when other panels (history void/refund) commit. */
  refreshKey: number;
  onOpenSettings: () => void;
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const today = toJakartaDateOnly(new Date());
      const res = await listTransactions({
        from: `${today}T00:00:00.000Z`,
        to: `${today}T23:59:59.999Z`,
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
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tick]);

  // Auto-refresh every 30s — multi-cashier sync (another kasir may close
  // a bill from a parallel device).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Lazy-fetch full TransactionWithItems for each bill — needed by
  // CloseOpenBillModal + items summary on the card.
  useEffect(() => {
    let cancelled = false;
    async function loadDetails() {
      const missing = bills.filter((b) => !details[b.id]);
      if (missing.length === 0) return;
      const fetched: Record<string, TransactionWithItems> = {};
      for (const b of missing) {
        const res = await getTransaction(b.id);
        if (cancelled) return;
        if (isOk(res)) fetched[b.id] = res.data;
      }
      if (cancelled) return;
      setDetails((prev) => ({ ...prev, ...fetched }));
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

  function handleBillClosed() {
    setClosingBill(null);
    setTick((t) => t + 1);
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
    </div>
  );
}

interface BillCardProps {
  summary: Transaction;
  detail: TransactionWithItems | undefined;
  /** Bumped from parent's auto-refresh tick — used to invalidate age calc. */
  nowTick: number;
  onPay: () => void;
}

function BillCard({ summary, detail, nowTick, onPay }: BillCardProps) {
  const { ageMinutes, isStale } = useBillAge(summary.createdAt, nowTick);

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
              {summary.pagerNumber}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-neutral-900">
                  {summary.transactionNumber}
                </span>
                {isStale ? (
                  <Badge variant="warning">
                    <AlertTriangle className="size-3" aria-hidden /> Lama (
                    {ageMinutes}m)
                  </Badge>
                ) : (
                  <Badge variant="info">Belum lunas ({ageMinutes}m)</Badge>
                )}
              </div>
              <p className="text-xs text-neutral-500">
                {formatIndonesianTime(summary.createdAt)} ·{" "}
                {summary.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
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

        <div className="flex justify-end">
          <Button
            size="md"
            onClick={onPay}
            disabled={!detail}
            loading={!detail}
          >
            Bayar Sekarang
          </Button>
        </div>

        {isStale ? (
          <p className="rounded-md bg-warning-100/40 p-2 text-xs text-warning-500">
            ⚠️ Bill ini sudah {Math.floor(ageMinutes / 60)} jam belum dibayar.
            Tanyakan customer atau follow-up agar tidak terlewat.
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
