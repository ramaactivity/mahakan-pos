"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CheckCheck,
  ChevronRight,
  Clock,
  CreditCard,
  Hourglass,
  ListTree,
  RefreshCw,
  RotateCcw,
  Search,
  Smartphone,
  TrendingUp,
  User,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge, Button, Input, Skeleton } from "@/components/ui";
import {
  isOk,
  listTransactions,
  type Transaction,
  type TransactionStatus,
} from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime, todayWibRangeUtc } from "@/lib/date";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<{
  value: TransactionStatus | "all";
  label: string;
  icon: typeof CheckCheck;
}> = [
  { value: "all", label: "Semua", icon: ListTree },
  { value: "paid", label: "Lunas", icon: CheckCheck },
  { value: "open", label: "Open", icon: Hourglass },
  { value: "voided", label: "Void", icon: XCircle },
  { value: "refunded", label: "Refund", icon: RotateCcw },
];

interface HistoryPanelProps {
  refreshKey: number;
  onSelectTransaction: (trxId: string) => void;
}

/**
 * Sesi AE-37 redesign — Riwayat tab dengan dashboard cards + payment method
 * aggregate + better row detail. Mengikuti pattern Pesanan + Bill Aktif yg
 * sudah di-redesign sebelumnya (AE-35 / AE-36).
 *
 * Dashboard cards (5):
 *   Total Trx | Revenue Net | Lunas | Open | Void/Refund
 *
 * Payment method aggregate (4 cards): Cash | QRIS | Kartu | Split
 *   dengan count + sum per method (lunas only)
 *
 * Filters + search preserved dari AE-26.
 *
 * Row detail enhancements:
 *   - Time formatted prominent
 *   - Customer name + note indicator
 *   - Pager number + transaction number
 *   - Status badge + payment method chip
 *   - Refund amount kalau partial
 *   - Reason hint kalau void / refund
 *   - Hover affordance + arrow icon
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
      const { from, to } = todayWibRangeUtc();
      const res = await listTransactions({
        from,
        to,
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

  /** Sesi AE-37 — comprehensive dashboard aggregates. */
  const dashboard = useMemo(() => {
    const stats = {
      total: transactions.length,
      paid: 0,
      open: 0,
      voided: 0,
      refunded: 0,
      partiallyRefunded: 0,
      grossRevenue: 0,
      voidedAmount: 0,
      refundedAmount: 0,
      netRevenue: 0,
      // payment method aggregates (paid + partially_refunded only)
      cashCount: 0,
      cashSum: 0,
      qrisCount: 0,
      qrisSum: 0,
      cardCount: 0,
      cardSum: 0,
      splitCount: 0,
      splitSum: 0,
    };
    for (const t of transactions) {
      if (t.status === "paid") {
        stats.paid++;
        stats.grossRevenue += t.total;
      } else if (t.status === "partially_refunded") {
        stats.partiallyRefunded++;
        stats.grossRevenue += t.total;
        stats.refundedAmount += t.refundedAmount;
      } else if (t.status === "open") {
        stats.open++;
      } else if (t.status === "voided") {
        stats.voided++;
        stats.voidedAmount += t.total;
      } else if (t.status === "refunded") {
        stats.refunded++;
        stats.refundedAmount += t.total;
      }

      if (t.status === "paid" || t.status === "partially_refunded") {
        const netAmount = t.total - t.refundedAmount;
        if (t.paymentMethod === "cash") {
          stats.cashCount++;
          stats.cashSum += netAmount;
        } else if (t.paymentMethod === "qris") {
          stats.qrisCount++;
          stats.qrisSum += netAmount;
        } else if (t.paymentMethod === "split") {
          stats.splitCount++;
          stats.splitSum += netAmount;
        } else {
          stats.cardCount++;
          stats.cardSum += netAmount;
        }
      }
    }
    stats.netRevenue = stats.grossRevenue - stats.refundedAmount;
    return stats;
  }, [transactions]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
              <Clock className="size-5 text-mahakan-green-700" aria-hidden />
              Riwayat Transaksi
            </h2>
            <p className="text-xs text-neutral-500">
              Hari ini · Tap baris untuk detail. Auto-refresh 30s.
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

        {/* Sesi AE-37 — dashboard cards row 1: status counts + net revenue */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard
            label="Total Trx"
            value={String(dashboard.total)}
            tone="neutral"
            icon={<ListTree className="size-4" />}
          />
          <StatCard
            label="Revenue Net"
            value={formatRupiah(dashboard.netRevenue)}
            tone="success"
            icon={<TrendingUp className="size-4" />}
            sublabel={
              dashboard.refundedAmount > 0
                ? `gross ${formatRupiah(dashboard.grossRevenue)}`
                : undefined
            }
          />
          <StatCard
            label="Lunas"
            value={String(dashboard.paid + dashboard.partiallyRefunded)}
            tone="success"
            icon={<CheckCheck className="size-4" />}
            sublabel={
              dashboard.partiallyRefunded > 0
                ? `+${dashboard.partiallyRefunded} refund sebagian`
                : undefined
            }
          />
          <StatCard
            label="Open"
            value={String(dashboard.open)}
            tone={dashboard.open > 0 ? "warning" : "muted"}
            icon={<Hourglass className="size-4" />}
          />
          <StatCard
            label="Void / Refund"
            value={String(dashboard.voided + dashboard.refunded)}
            tone={
              dashboard.voided + dashboard.refunded > 0 ? "danger" : "muted"
            }
            icon={<XCircle className="size-4" />}
            sublabel={
              dashboard.refundedAmount > 0
                ? `-${formatRupiah(dashboard.refundedAmount + dashboard.voidedAmount)}`
                : undefined
            }
          />
        </div>

        {/* Payment method breakdown row 2 */}
        {dashboard.cashCount +
          dashboard.qrisCount +
          dashboard.cardCount +
          dashboard.splitCount >
        0 ? (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PaymentCard
              icon={<Banknote className="size-4" />}
              label="Tunai"
              count={dashboard.cashCount}
              sum={dashboard.cashSum}
              tone="cash"
            />
            <PaymentCard
              icon={<Smartphone className="size-4" />}
              label="QRIS"
              count={dashboard.qrisCount}
              sum={dashboard.qrisSum}
              tone="qris"
            />
            <PaymentCard
              icon={<CreditCard className="size-4" />}
              label="Kartu"
              count={dashboard.cardCount}
              sum={dashboard.cardSum}
              tone="card"
            />
            <PaymentCard
              icon={<Wallet className="size-4" />}
              label="Split"
              count={dashboard.splitCount}
              sum={dashboard.splitSum}
              tone="split"
            />
          </div>
        ) : null}

        {/* Filters + search */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const Icon = f.icon;
            const c =
              f.value === "all"
                ? dashboard.total
                : f.value === "paid"
                  ? dashboard.paid + dashboard.partiallyRefunded
                  : f.value === "open"
                    ? dashboard.open
                    : f.value === "voided"
                      ? dashboard.voided
                      : dashboard.refunded;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  statusFilter === f.value
                    ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                )}
              >
                <Icon className="size-3.5" /> {f.label} ({c})
              </button>
            );
          })}
          <div className="ml-auto min-w-[200px] relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
            <Input
              type="text"
              placeholder="Cari nomor / pager / customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-neutral-50 p-3">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
              <Clock className="size-6 text-neutral-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-neutral-700">
              {transactions.length === 0
                ? "Belum ada transaksi hari ini."
                : "Tidak ada transaksi yang match filter / pencarian."}
            </p>
            <p className="max-w-xs text-xs text-neutral-500">
              Transaksi muncul setelah bayar atau simpan bill di tab Kasir.
            </p>
          </div>
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

function StatCard({
  label,
  value,
  tone,
  icon,
  sublabel,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger" | "muted";
  icon: React.ReactNode;
  sublabel?: string;
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-neutral-200 bg-white text-neutral-900",
    success: "border-success-500/30 bg-success-100/40 text-success-500",
    warning: "border-warning-500/30 bg-warning-100/40 text-warning-500",
    danger: "border-danger-300 bg-danger-100/30 text-danger-500",
    muted: "border-neutral-200 bg-neutral-100 text-neutral-600",
  };
  return (
    <div className={cn("rounded-lg border px-3 py-2", toneClasses[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-bold sm:text-base">
        {value}
      </div>
      {sublabel ? (
        <div className="mt-0.5 text-[10px] opacity-70">{sublabel}</div>
      ) : null}
    </div>
  );
}

function PaymentCard({
  icon,
  label,
  count,
  sum,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  sum: number;
  tone: "cash" | "qris" | "card" | "split";
}) {
  const toneClasses: Record<typeof tone, string> = {
    cash: "border-success-500/20 bg-success-100/30 text-success-500",
    qris: "border-info-300 bg-info-100/30 text-info-500",
    card: "border-mahakan-green-700/20 bg-mahakan-green-50 text-mahakan-green-900",
    split: "border-warning-500/20 bg-warning-100/30 text-warning-500",
  };
  const dimmed = count === 0;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-1.5",
        dimmed ? "border-neutral-200 bg-neutral-50 text-neutral-500" : toneClasses[tone],
      )}
    >
      <div className="flex items-center justify-between text-[11px] font-medium">
        <span className="inline-flex items-center gap-1.5">
          {icon} {label}
        </span>
        <span className="font-mono">{count}×</span>
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-xs font-semibold",
          dimmed && "opacity-50",
        )}
      >
        {formatRupiah(sum)}
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

  const netAmount = trx.total - trx.refundedAmount;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex w-full items-stretch gap-3 rounded-lg border bg-white p-3 text-left transition-all",
          "hover:border-mahakan-green-700 hover:shadow-md hover:-translate-y-0.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
          isVoided && "border-neutral-200 bg-neutral-50",
          !isVoided && "border-neutral-200",
        )}
      >
        {/* Pager column */}
        <div
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-lg font-mono text-base font-bold",
            trx.pagerNumber !== null
              ? isVoided
                ? "bg-neutral-200 text-neutral-500"
                : isRefunded || isPartialRefund
                  ? "bg-warning-100 text-warning-500"
                  : isOpen
                    ? "bg-info-100 text-info-500"
                    : "bg-mahakan-green-100 text-mahakan-green-900"
              : "bg-neutral-100 text-neutral-500",
          )}
        >
          {trx.pagerNumber !== null ? trx.pagerNumber : "—"}
        </div>

        {/* Middle column — info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p
              className={cn(
                "font-mono text-sm font-semibold text-neutral-900",
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

          {trx.customerName ? (
            <div className="flex items-center gap-1 text-xs font-medium text-neutral-700">
              <User className="size-3 text-neutral-400" aria-hidden />
              <span className="truncate">{trx.customerName}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-600">
            <span className="flex items-center gap-1">
              <Clock className="size-3 text-neutral-400" aria-hidden />
              {formatIndonesianTime(trx.createdAt)}
            </span>
            <PaymentMethodChip trx={trx} />
            {!isOpen && trx.servedAt !== null ? (
              <span className="flex items-center gap-1 text-success-500">
                ✓ Diantar
              </span>
            ) : null}
            {!isOpen && trx.servedAt === null && !isVoided ? (
              <span className="text-warning-500">⏳ Belum diantar</span>
            ) : null}
          </div>

          {reasonHint ? (
            <div className="mt-0.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600">
              {reasonHint}
            </div>
          ) : null}
        </div>

        {/* Right column — amount + chevron */}
        <div className="flex shrink-0 flex-col items-end justify-between gap-1">
          <div className="text-right">
            <div
              className={cn(
                "font-mono text-base font-bold tabular-nums",
                isVoided && "text-neutral-400 line-through",
                isRefunded && "text-danger-500",
                isPartialRefund && "text-warning-500",
                !isVoided && !isRefunded && !isPartialRefund && "text-neutral-900",
              )}
            >
              {formatRupiah(netAmount)}
            </div>
            {isPartialRefund && trx.refundedAmount > 0 ? (
              <div className="text-[10px] text-warning-500">
                refund {formatRupiah(trx.refundedAmount)}
              </div>
            ) : null}
          </div>
          <ChevronRight
            className="size-4 text-neutral-300 transition-colors group-hover:text-mahakan-green-700"
            aria-hidden
          />
        </div>
      </button>
    </li>
  );
}

function PaymentMethodChip({ trx }: { trx: Transaction }) {
  if (trx.status === "open") {
    return (
      <span className="inline-flex items-center gap-1 text-warning-500">
        <Hourglass className="size-3" /> Belum bayar
      </span>
    );
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
    icon = <Wallet className="size-3" aria-hidden />;
    label = "Split";
  } else {
    icon = <CreditCard className="size-3" aria-hidden />;
    if (method === "card_bca") label = "BCA";
    else if (method === "card_bni") label = "BNI";
    else if (method === "card_mandiri") label = "Mandiri";
    else if (method === "card_bri") label = "BRI";
    else label = "Kartu";
  }
  return (
    <span className="inline-flex items-center gap-1">
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
