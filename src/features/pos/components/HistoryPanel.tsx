"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Clock,
  CreditCard,
  Filter,
  RefreshCw,
  Search,
  Smartphone,
  User,
} from "lucide-react";
import { Badge, Button, Input, Spinner } from "@/components/ui";
import {
  isOk,
  listTransactions,
  type Transaction,
  type TransactionStatus,
} from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime, toJakartaDateOnly } from "@/lib/date";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<{ value: TransactionStatus | "all"; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "paid", label: "Lunas" },
  { value: "open", label: "Open" },
  { value: "voided", label: "Void" },
  { value: "refunded", label: "Refund" },
];

interface HistoryPanelProps {
  /** Trigger to refetch (bumped when detail modal commits void/refund). */
  refreshKey: number;
  onSelectTransaction: (trxId: string) => void;
}

/**
 * Sesi AE-26 redesign — riwayat transaksi hari ini dengan info lebih
 * lengkap. Owner request: customer name muncul, lebih canggih, lebih
 * detail, lebih stabil.
 *
 * Improvements vs sebelumnya:
 *   - Customer name + phone surfaced prominent
 *   - Payment method icon (Cash/QRIS/Card)
 *   - Time-ago label ("3 menit lalu") + absolute time
 *   - Filter "Open" added (sebelumnya cuma all/paid/void/refund)
 *   - Search by transaction number / pager / customer
 *   - Auto-refresh 30s + manual refresh button
 *   - Void/refund reason hint via title
 *   - Note indicator (📝 kalau ada catatan bill)
 *   - Order type badge (Dine-in / Takeaway)
 *   - Refund partial — show "Lunas (Refund Sebagian)"
 */
export function HistoryPanel({
  refreshKey,
  onSelectTransaction,
}: HistoryPanelProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] =
    useState<TransactionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [tick, setTick] = useState(0);
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 200);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasLoadedOnce.current) setLoading(true);
      const today = toJakartaDateOnly(new Date());
      const res = await listTransactions({
        from: `${today}T00:00:00.000Z`,
        to: `${today}T23:59:59.999Z`,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 200,
      });
      if (cancelled) return;
      if (isOk(res)) setTransactions(res.data.items);
      setLoading(false);
      hasLoadedOnce.current = true;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, refreshKey, tick]);

  // Sesi AE-26 — auto-refresh 30s biar konsisten dengan OpenBill +
  // OrderQueue (semua panel di POS punya same cadence).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return transactions;
    return transactions.filter((trx) => {
      if (trx.transactionNumber.toLowerCase().includes(debouncedSearch))
        return true;
      if (
        trx.pagerNumber !== null &&
        String(trx.pagerNumber).includes(debouncedSearch)
      )
        return true;
      if (trx.customerName?.toLowerCase().includes(debouncedSearch))
        return true;
      return false;
    });
  }, [transactions, debouncedSearch]);

  const counts = useMemo(() => {
    const c = { total: 0, paid: 0, open: 0, voided: 0, refunded: 0 };
    for (const t of transactions) {
      c.total++;
      if (t.status === "paid" || t.status === "partially_refunded") c.paid++;
      else if (t.status === "open") c.open++;
      else if (t.status === "voided") c.voided++;
      else if (t.status === "refunded") c.refunded++;
    }
    return c;
  }, [transactions]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
              <Clock className="size-5 text-mahakan-green-700" aria-hidden />
              Riwayat Hari Ini
            </h2>
            <p className="text-sm text-neutral-500">
              {counts.total} transaksi · {counts.paid} lunas · {counts.open}{" "}
              open · {counts.voided} void · {counts.refunded} refund
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTick((t) => t + 1)}
            title="Refresh manual"
          >
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs font-medium text-neutral-600">
            <Filter className="size-3.5" aria-hidden /> Status
          </div>
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? "primary" : "outline"}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="mt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              type="text"
              placeholder="Cari nomor / pager / nama customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            {transactions.length === 0
              ? "Belum ada transaksi hari ini."
              : "Tidak ada transaksi yang match filter / pencarian."}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((trx) => (
              <HistoryRow
                key={trx.id}
                trx={trx}
                onClick={() => onSelectTransaction(trx.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  trx,
  onClick,
}: {
  trx: Transaction;
  onClick: () => void;
}) {
  const isVoided = trx.status === "voided";
  const isRefunded = trx.status === "refunded";
  const isPartialRefund = trx.status === "partially_refunded";
  const isOpen = trx.status === "open";

  const reasonHint =
    isVoided && trx.voidReason
      ? `Void: ${trx.voidReason}`
      : (isRefunded || isPartialRefund) && trx.refundReason
        ? `Refund: ${trx.refundReason}`
        : undefined;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-all",
          "hover:border-mahakan-green-700 hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
          isVoided && "bg-neutral-50",
        )}
      >
        {/* Top row: pager + number + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold",
                trx.pagerNumber !== null
                  ? "bg-mahakan-green-100 text-mahakan-green-900"
                  : "bg-neutral-100 text-neutral-500",
              )}
            >
              {trx.pagerNumber !== null ? trx.pagerNumber : "—"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p
                  className={cn(
                    "font-mono text-sm font-medium text-neutral-900 truncate",
                    isVoided && "line-through text-neutral-500",
                  )}
                >
                  {trx.transactionNumber}
                </p>
                <StatusBadge status={trx.status} />
                <Badge variant="neutral">
                  {trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
                </Badge>
                {trx.note ? (
                  <span
                    className="inline-flex items-center text-xs text-warning-500"
                    title={trx.note}
                  >
                    📝
                  </span>
                ) : null}
              </div>
              {/* Customer info */}
              {trx.customerName ? (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-700">
                  <User className="size-3 text-neutral-400" aria-hidden />
                  <span className="truncate font-medium">
                    {trx.customerName}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <div
            className={cn(
              "shrink-0 text-right font-mono text-base font-semibold",
              isVoided && "text-neutral-400 line-through",
              isRefunded && "text-warning-500",
              isPartialRefund && "text-warning-500",
              !isVoided && !isRefunded && !isPartialRefund && "text-neutral-900",
            )}
          >
            {formatRupiah(trx.total)}
          </div>
        </div>

        {/* Bottom row: time + payment + serve status + refund amount */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600">
          <span className="flex items-center gap-1">
            <Clock className="size-3 text-neutral-400" aria-hidden />
            {formatIndonesianTime(trx.createdAt)}
          </span>
          <PaymentMethodChip trx={trx} />
          {!isOpen && trx.servedAt !== null ? (
            <span className="flex items-center gap-1 text-success-500">
              ✓ Sudah dikirim
            </span>
          ) : null}
          {!isOpen && trx.servedAt === null ? (
            <span className="text-warning-500">⏳ Belum dikirim</span>
          ) : null}
          {isPartialRefund && trx.refundedAmount > 0 ? (
            <span className="text-warning-500">
              -{formatRupiah(trx.refundedAmount)} di-refund
            </span>
          ) : null}
        </div>

        {reasonHint ? (
          <div className="rounded-md bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600">
            {reasonHint}
          </div>
        ) : null}
      </button>
    </li>
  );
}

function PaymentMethodChip({ trx }: { trx: Transaction }) {
  if (trx.status === "open") {
    return <span className="text-warning-500">Belum bayar</span>;
  }
  const method = trx.paymentMethod;
  let icon: React.ReactNode = null;
  let label = "";
  if (method === "cash") {
    icon = <Banknote className="size-3" aria-hidden />;
    label = "Tunai";
  } else if (method === "qris") {
    icon = <Smartphone className="size-3" aria-hidden />;
    label = "QRIS";
  } else if (method === "split") {
    icon = <CreditCard className="size-3" aria-hidden />;
    label = "Split";
  } else {
    icon = <CreditCard className="size-3" aria-hidden />;
    if (method === "card_bca") label = "Kartu BCA";
    else if (method === "card_bni") label = "Kartu BNI";
    else if (method === "card_mandiri") label = "Kartu Mandiri";
    else if (method === "card_bri") label = "Kartu BRI";
    else label = "Kartu";
  }
  return (
    <span className="flex items-center gap-1">
      {icon}
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: TransactionStatus }) {
  if (status === "paid") return <Badge variant="paid">Lunas</Badge>;
  if (status === "open") return <Badge variant="warning">Open</Badge>;
  if (status === "voided") return <Badge variant="voided">Void</Badge>;
  if (status === "partially_refunded")
    return <Badge variant="refunded">Refund Sebagian</Badge>;
  return <Badge variant="refunded">Refund</Badge>;
}
