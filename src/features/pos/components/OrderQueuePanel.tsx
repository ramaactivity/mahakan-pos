"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVisibilityAwareInterval } from "@/lib/use-visibility-aware-interval";
import {
  AlertTriangle,
  Banknote,
  Check,
  ChefHat,
  CheckCheck,
  ClipboardList,
  Clock,
  Coffee,
  CreditCard,
  Flame,
  Hourglass,
  Play,
  RefreshCw,
  Search,
  Smartphone,
  StickyNote,
  User,
  Utensils,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Skeleton,
  toast,
} from "@/components/ui";
import { PrintStationButtons } from "./PrintStationButtons";
import {
  getTransactionsByIds,
  isOk,
  listTransactionSummaries,
  markAllItemsDone,
  markServed,
  updateItemPrepStatus,
  type TransactionItem,
  type TransactionSummary,
  type TransactionWithItems,
} from "@/features/transactions";
import { categoryToStation } from "@/lib/printer/station-mapping";
import type { ReceiptConfig } from "@/lib/printer/print-transaction";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime, todayWibRangeUtc } from "@/lib/date";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "pending" | "in_progress" | "done" | "served";
type StationFilter = "all" | "kitchen" | "bar";

interface OrderQueuePanelProps {
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  refreshKey: number;
  onOpenSettings: () => void;
}

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string; icon: typeof Hourglass }> = [
  { value: "all", label: "Semua", icon: ClipboardList },
  { value: "pending", label: "Menunggu", icon: Hourglass },
  { value: "in_progress", label: "Dibuat", icon: Flame },
  { value: "done", label: "Selesai (belum diantar)", icon: CheckCheck },
  { value: "served", label: "Sudah Diantar", icon: Check },
];

const STATION_FILTERS: Array<{ value: StationFilter; label: string; icon: typeof Utensils }> = [
  { value: "all", label: "Semua Station", icon: Utensils },
  { value: "kitchen", label: "Dapur", icon: ChefHat },
  { value: "bar", label: "Bar", icon: Coffee },
];

const URGENT_THRESHOLD_MIN = 10;
const WARNING_THRESHOLD_MIN = 5;

/**
 * Sesi AE-35 — KDS (Kitchen Display System) redesign.
 *
 * Owner request: tab Pesanan harus lebih canggih, dashboard, info detail,
 * tracking per-item supaya tidak ada menu yang terlewat. Modifier + catatan
 * prominent. Urgency indicator (waktu menunggu).
 *
 * Features:
 *   - Dashboard cards: Total / Menunggu / Dibuat / Selesai / Sudah Diantar
 *   - Per-item status tracking (pending → in_progress → done) via
 *     transaction_items.prep_status (migration 0038)
 *   - Urgency indicator: 5min orange warning, 10min red urgent
 *   - Filter by status + station (Dapur / Bar)
 *   - Search by nomor / pager / customer
 *   - Item cards dengan modifier + note inline, status pill tappable
 *   - "Tandai Semua Selesai" bulk action per order
 *   - "Tandai Diantar" hanya aktif kalau semua item done
 */
export function OrderQueuePanel({
  cashierName,
  receiptConfig,
  refreshKey,
  onOpenSettings,
}: OrderQueuePanelProps) {
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [stationFilter, setStationFilter] = useState<StationFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 200);
  const [tick, setTick] = useState(0);
  const [details, setDetails] = useState<Record<string, TransactionWithItems>>(
    {},
  );
  const [pendingItemUpdate, setPendingItemUpdate] = useState<string | null>(null);
  const [pendingTrxUpdate, setPendingTrxUpdate] = useState<string | null>(null);
  // Auto re-render every 15s biar elapsed time + urgency badge update
  // tanpa harus refetch DB. nowMs di-derive di parent + diteruskan ke
  // child cards via props supaya `Date.now()` tidak dipanggil saat render
  // child (react-hooks/purity).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const hasLoadedOnce = useRef(false);

  // Fetch payment list
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasLoadedOnce.current) setLoading(true);
      const { from, to } = todayWibRangeUtc();
      // Sesi AE-62l — include partially_refunded supaya bill yang
      // sebagian di-refund tetap muncul di KDS (kitchen perlu prepare
      // item yang tidak di-refund). Per-item badge tampil di item-level
      // kalau refundedQuantity > 0.
      /* Audit AE-187 — versi ringan (±10 kolom): list ini di-poll 45s
       * sepanjang hari; full row ~40 kolom adalah egress terbesar se-app. */
      const res = await listTransactionSummaries({
        from,
        to,
        status: ["paid", "partially_refunded"],
        limit: 100,
      });
      if (cancelled) return;
      if (isOk(res)) {
        const items = [...res.data.items].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setTransactions(items);
      }
      setLoading(false);
      hasLoadedOnce.current = true;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tick]);

  // Sesi AE-163 — auto-refresh data visibility-aware (pause saat tab hidden,
  // refetch instan saat balik visible). Hemat Fluid CPU Vercel: panel yang
  // ditinggal di background tidak lagi nembak server tiap 30s. 30s → 45s.
  useVisibilityAwareInterval(() => setTick((t) => t + 1), 45_000);
  // Clock tick 15s untuk label urgency — client-only, tidak hit server.
  useEffect(() => {
    const clockInterval = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(clockInterval);
  }, []);

  // Lazy-fetch detail (with items). Sesi AE-163 — batch via getTransactionsByIds
  // (1 round-trip) menggantikan N× getTransaction. Hemat invocation + CPU
  // Vercel tiap polling saat ada pesanan baru (mirror pola OpenBillPanel).
  useEffect(() => {
    let cancelled = false;
    async function loadDetails() {
      const missingIds = transactions
        .filter((t) => !details[t.id])
        .map((t) => t.id);
      if (missingIds.length === 0) return;
      const res = await getTransactionsByIds(missingIds);
      if (cancelled || !isOk(res)) return;
      const next: Record<string, TransactionWithItems> = {};
      for (const t of res.data) next[t.id] = t;
      setDetails((prev) => ({ ...prev, ...next }));
    }
    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [transactions, details]);

  async function handleUpdateItemStatus(
    itemId: string,
    next: "pending" | "in_progress" | "done",
  ) {
    if (pendingItemUpdate) return;
    setPendingItemUpdate(itemId);
    // Optimistic update
    setDetails((prev) => {
      const out = { ...prev };
      for (const trxId of Object.keys(out)) {
        const trx = out[trxId];
        if (!trx) continue;
        const itemIdx = trx.items.findIndex((it) => it.id === itemId);
        if (itemIdx !== -1) {
          const item = trx.items[itemIdx]!;
          const newItems = [...trx.items];
          newItems[itemIdx] = {
            ...item,
            prepStatus: next,
            prepStartedAt:
              next === "in_progress" ? new Date() : item.prepStartedAt,
            prepDoneAt: next === "done" ? new Date() : null,
          };
          out[trxId] = { ...trx, items: newItems };
          break;
        }
      }
      return out;
    });
    const res = await updateItemPrepStatus({ itemId, status: next });
    setPendingItemUpdate(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setTick((t) => t + 1); // resync
    }
  }

  async function handleMarkAllDone(trxId: string) {
    if (pendingTrxUpdate) return;
    setPendingTrxUpdate(trxId);
    const res = await markAllItemsDone(trxId);
    setPendingTrxUpdate(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`${res.data.updatedCount} item ditandai selesai`);
    setTick((t) => t + 1);
  }

  async function handleMarkServed(trxId: string) {
    if (pendingTrxUpdate) return;
    setPendingTrxUpdate(trxId);
    const res = await markServed(trxId);
    setPendingTrxUpdate(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Pesanan ditandai sudah diantar");
    setTick((t) => t + 1);
  }

  // Compute per-transaction aggregate status from items.
  function trxStatus(detail: TransactionWithItems | undefined, trx: TransactionSummary): {
    label: string;
    aggregate: "pending" | "in_progress" | "done" | "served";
    pendingCount: number;
    inProgressCount: number;
    doneCount: number;
    totalItems: number;
  } {
    if (trx.servedAt !== null) {
      return {
        label: "Sudah Diantar",
        aggregate: "served",
        pendingCount: 0,
        inProgressCount: 0,
        doneCount: 0,
        totalItems: 0,
      };
    }
    if (!detail) {
      return {
        label: "Loading…",
        aggregate: "pending",
        pendingCount: 0,
        inProgressCount: 0,
        doneCount: 0,
        totalItems: 0,
      };
    }
    let pendingCount = 0;
    let inProgressCount = 0;
    let doneCount = 0;
    for (const it of detail.items) {
      if (it.prepStatus === "done") doneCount++;
      else if (it.prepStatus === "in_progress") inProgressCount++;
      else pendingCount++;
    }
    const totalItems = detail.items.length;
    let aggregate: "pending" | "in_progress" | "done" = "pending";
    let label = "Menunggu";
    if (doneCount === totalItems) {
      aggregate = "done";
      label = "Siap Diantar";
    } else if (inProgressCount > 0 || doneCount > 0) {
      aggregate = "in_progress";
      label = `Diproses (${doneCount}/${totalItems})`;
    }
    return {
      label,
      aggregate,
      pendingCount,
      inProgressCount,
      doneCount,
      totalItems,
    };
  }

  // Filter + search
  const filteredTransactions = useMemo(() => {
    return transactions.filter((trx) => {
      const detail = details[trx.id];
      const ag = trxStatus(detail, trx);
      if (statusFilter !== "all" && ag.aggregate !== statusFilter) return false;
      if (stationFilter !== "all" && detail) {
        const hasStation = detail.items.some(
          (it) => categoryToStation(it.itemCategoryName) === stationFilter,
        );
        if (!hasStation) return false;
      }
      if (debouncedSearch) {
        const matchNum = trx.transactionNumber
          .toLowerCase()
          .includes(debouncedSearch);
        const matchPager =
          trx.pagerNumber !== null &&
          String(trx.pagerNumber).includes(debouncedSearch);
        const matchCustomer = trx.customerName
          ?.toLowerCase()
          .includes(debouncedSearch);
        if (!matchNum && !matchPager && !matchCustomer) return false;
      }
      return true;
    });
  }, [transactions, details, statusFilter, stationFilter, debouncedSearch]);

  // Dashboard aggregates across ALL transactions today (not filtered)
  const dashboard = useMemo(() => {
    const stats = {
      total: transactions.length,
      pending: 0,
      inProgress: 0,
      done: 0,
      served: 0,
      urgentCount: 0,
      pendingItems: 0,
      inProgressItems: 0,
    };
    const now = nowMs;
    for (const trx of transactions) {
      const detail = details[trx.id];
      const ag = trxStatus(detail, trx);
      if (ag.aggregate === "served") stats.served++;
      else if (ag.aggregate === "done") stats.done++;
      else if (ag.aggregate === "in_progress") stats.inProgress++;
      else stats.pending++;
      stats.pendingItems += ag.pendingCount;
      stats.inProgressItems += ag.inProgressCount;
      if (trx.servedAt === null) {
        const ageMin = (now - new Date(trx.createdAt).getTime()) / 60_000;
        if (ageMin > URGENT_THRESHOLD_MIN) stats.urgentCount++;
      }
    }
    return stats;
  }, [transactions, details, nowMs]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
              <ClipboardList
                className="size-5 text-mahakan-green-700"
                aria-hidden
              />
              Pesanan — Dapur &amp; Bar
            </h2>
            <p className="text-xs text-neutral-500">
              KDS hari ini. Tap item untuk ubah status. Auto-refresh 30s.
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

        {/* Dashboard cards */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard
            label="Total"
            value={dashboard.total}
            tone="neutral"
            icon={<ClipboardList className="size-4" />}
          />
          <StatCard
            label="Menunggu"
            value={dashboard.pending}
            tone="warning"
            icon={<Hourglass className="size-4" />}
            sublabel={
              dashboard.pendingItems > 0
                ? `${dashboard.pendingItems} item`
                : undefined
            }
          />
          <StatCard
            label="Dibuat"
            value={dashboard.inProgress}
            tone="info"
            icon={<Flame className="size-4" />}
            sublabel={
              dashboard.inProgressItems > 0
                ? `${dashboard.inProgressItems} item`
                : undefined
            }
          />
          <StatCard
            label="Siap Antar"
            value={dashboard.done}
            tone="success"
            icon={<CheckCheck className="size-4" />}
          />
          <StatCard
            label="Sudah Diantar"
            value={dashboard.served}
            tone="muted"
            icon={<Check className="size-4" />}
          />
        </div>

        {dashboard.urgentCount > 0 ? (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-danger-300 bg-danger-100/40 px-3 py-1.5 text-xs text-danger-500">
            <AlertTriangle className="size-4" />
            <span className="font-medium">
              {dashboard.urgentCount} pesanan menunggu lebih dari{" "}
              {URGENT_THRESHOLD_MIN} menit
            </span>
          </div>
        ) : null}

        {/* Filters */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const Icon = f.icon;
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
                <Icon className="size-3.5" /> {f.label}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {STATION_FILTERS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setStationFilter(f.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  stationFilter === f.value
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                )}
              >
                <Icon className="size-3.5" /> {f.label}
              </button>
            );
          })}
          <div className="ml-auto min-w-[180px] relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
            <Input
              type="text"
              placeholder="Cari pager / customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-neutral-50 p-3">
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Memuat pesanan">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full" />
            ))}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
              <ClipboardList className="size-6 text-neutral-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-neutral-700">
              {transactions.length === 0
                ? "Belum ada pesanan hari ini."
                : "Tidak ada yang match filter / pencarian."}
            </p>
            <p className="max-w-xs text-xs text-neutral-500">
              Pesanan baru muncul di sini setelah pembayaran berhasil.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredTransactions.map((t) => (
              <OrderCard
                key={t.id}
                summary={t}
                detail={details[t.id]}
                cashierName={cashierName}
                receiptConfig={receiptConfig}
                stationFilter={stationFilter}
                nowMs={nowMs}
                pendingItemUpdate={pendingItemUpdate}
                pendingTrxUpdate={pendingTrxUpdate}
                onUpdateItemStatus={handleUpdateItemStatus}
                onMarkAllDone={() => handleMarkAllDone(t.id)}
                onMarkServed={() => handleMarkServed(t.id)}
                onOpenSettings={onOpenSettings}
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
  value: number;
  tone: "neutral" | "warning" | "info" | "success" | "muted";
  icon: React.ReactNode;
  sublabel?: string;
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-neutral-200 bg-white text-neutral-900",
    warning: "border-warning-500/30 bg-warning-100/40 text-warning-500",
    info: "border-info-300 bg-info-100/40 text-info-500",
    success: "border-success-500/30 bg-success-100/40 text-success-500",
    muted: "border-neutral-200 bg-neutral-100 text-neutral-600",
  };
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        toneClasses[tone],
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-bold">{value}</span>
        {sublabel ? (
          <span className="text-[10px] opacity-70">{sublabel}</span>
        ) : null}
      </div>
    </div>
  );
}

interface OrderCardProps {
  summary: TransactionSummary;
  detail: TransactionWithItems | undefined;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  stationFilter: StationFilter;
  /** Snapshot now() dari parent, tick tiap 15s — supaya elapsed time
   *  ter-update tanpa Date.now() di render child. */
  nowMs: number;
  pendingItemUpdate: string | null;
  pendingTrxUpdate: string | null;
  onUpdateItemStatus: (
    itemId: string,
    status: "pending" | "in_progress" | "done",
  ) => void;
  onMarkAllDone: () => void;
  onMarkServed: () => void;
  onOpenSettings: () => void;
}

function OrderCard({
  summary,
  detail,
  cashierName,
  receiptConfig,
  stationFilter,
  nowMs,
  pendingItemUpdate,
  pendingTrxUpdate,
  onUpdateItemStatus,
  onMarkAllDone,
  onMarkServed,
  onOpenSettings,
}: OrderCardProps) {
  const isServed = summary.servedAt !== null;
  const allItems = useMemo(() => detail?.items ?? [], [detail]);

  // Filter items by station if needed
  const visibleItems = useMemo(() => {
    if (stationFilter === "all") return allItems;
    return allItems.filter(
      (it) => categoryToStation(it.itemCategoryName) === stationFilter,
    );
  }, [allItems, stationFilter]);

  // Group items by station for visual section.
  const kitchenItems = visibleItems.filter(
    (it) => categoryToStation(it.itemCategoryName) === "kitchen",
  );
  const barItems = visibleItems.filter(
    (it) => categoryToStation(it.itemCategoryName) === "bar",
  );
  const otherItems = visibleItems.filter(
    (it) => categoryToStation(it.itemCategoryName) === null,
  );

  const doneCount = allItems.filter((it) => it.prepStatus === "done").length;
  const totalCount = allItems.length;
  const inProgressCount = allItems.filter(
    (it) => it.prepStatus === "in_progress",
  ).length;
  const allDone = totalCount > 0 && doneCount === totalCount;

  // Urgency calculation — pakai nowMs dari parent biar pure render.
  const ageMin = (nowMs - new Date(summary.createdAt).getTime()) / 60_000;
  const urgency: "normal" | "warning" | "urgent" = isServed
    ? "normal"
    : ageMin > URGENT_THRESHOLD_MIN
      ? "urgent"
      : ageMin > WARNING_THRESHOLD_MIN
        ? "warning"
        : "normal";
  const ageLabel =
    ageMin < 1
      ? "<1 menit"
      : ageMin < 60
        ? `${Math.floor(ageMin)} menit`
        : `${Math.floor(ageMin / 60)}j ${Math.floor(ageMin % 60)}m`;

  return (
    <Card
      className={cn(
        "transition-all",
        isServed && "opacity-60",
        !isServed && urgency === "urgent" && "border-danger-500/50 bg-danger-100/30",
        !isServed && urgency === "warning" && "border-warning-500/50",
        !isServed &&
          urgency === "normal" &&
          allDone &&
          "border-success-500/50 bg-success-100/30",
      )}
    >
      <CardContent className="space-y-3 p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-lg text-xl font-bold",
                isServed
                  ? "bg-neutral-100 text-neutral-500"
                  : urgency === "urgent"
                    ? "bg-danger-500 text-white animate-pulse"
                    : urgency === "warning"
                      ? "bg-warning-500 text-white"
                      : allDone
                        ? "bg-success-500 text-white"
                        : "bg-mahakan-green-100 text-mahakan-green-900",
              )}
            >
              {summary.pagerNumber !== null ? summary.pagerNumber : "—"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-sm font-semibold text-neutral-900">
                  {summary.transactionNumber}
                </span>
                {isServed ? (
                  <Badge variant="neutral">
                    <Check className="size-3" /> Diantar
                  </Badge>
                ) : allDone ? (
                  <Badge variant="success">
                    <CheckCheck className="size-3" /> Siap Antar
                  </Badge>
                ) : inProgressCount > 0 || doneCount > 0 ? (
                  <Badge variant="info">
                    <Flame className="size-3" /> Diproses {doneCount}/
                    {totalCount}
                  </Badge>
                ) : (
                  <Badge variant="warning">
                    <Hourglass className="size-3" /> Menunggu
                  </Badge>
                )}
                <Badge variant="neutral">
                  {summary.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
                </Badge>
              </div>
              {summary.customerName ? (
                <div className="mt-1 flex items-center gap-1 text-xs font-medium text-neutral-700">
                  <User className="size-3 text-neutral-400" />
                  {summary.customerName}
                </div>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-600">
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    urgency === "urgent" && "font-semibold text-danger-500",
                    urgency === "warning" && "font-medium text-warning-500",
                  )}
                >
                  <Clock className="size-3" />
                  {formatIndonesianTime(summary.createdAt)} · {ageLabel}
                </span>
                <PaymentMethodInline trx={summary} />
                <span className="font-mono font-semibold text-neutral-700">
                  {formatRupiah(summary.total)}
                </span>
              </div>
              {summary.note ? (
                <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-warning-500/30 bg-warning-100/40 px-2 py-1 text-xs text-warning-500">
                  <StickyNote className="mt-0.5 size-3 shrink-0" />
                  <span>
                    <strong>Catatan Pesanan:</strong> {summary.note}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {detail ? (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              <ItemSection
                label="Dapur"
                Icon={ChefHat}
                items={kitchenItems}
                pendingItemUpdate={pendingItemUpdate}
                onUpdateItemStatus={onUpdateItemStatus}
                disabled={isServed}
              />
              <ItemSection
                label="Bar"
                Icon={Coffee}
                items={barItems}
                pendingItemUpdate={pendingItemUpdate}
                onUpdateItemStatus={onUpdateItemStatus}
                disabled={isServed}
              />
              {otherItems.length > 0 ? (
                <ItemSection
                  label="Lainnya"
                  Icon={ClipboardList}
                  items={otherItems}
                  pendingItemUpdate={pendingItemUpdate}
                  onUpdateItemStatus={onUpdateItemStatus}
                  disabled={isServed}
                  className="lg:col-span-2"
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3">
              <PrintStationButtons
                trx={detail}
                cashierName={cashierName}
                receiptConfig={receiptConfig}
                onOpenSettings={onOpenSettings}
                size="sm"
              />
              <div className="flex flex-wrap gap-2">
                {!isServed && !allDone && totalCount > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onMarkAllDone}
                    loading={pendingTrxUpdate === summary.id}
                  >
                    <CheckCheck className="size-4" /> Tandai Semua Selesai
                  </Button>
                ) : null}
                {!isServed ? (
                  <Button
                    size="sm"
                    onClick={onMarkServed}
                    loading={pendingTrxUpdate === summary.id}
                    disabled={!allDone}
                    title={
                      allDone
                        ? "Tandai pesanan sudah diantar"
                        : "Selesaikan semua item dulu sebelum Tandai Diantar"
                    }
                  >
                    <Check className="size-4" />{" "}
                    {allDone ? "Tandai Diantar" : `Tunggu ${totalCount - doneCount} item`}
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

function ItemSection({
  label,
  Icon,
  items,
  pendingItemUpdate,
  onUpdateItemStatus,
  disabled,
  className,
}: {
  label: string;
  Icon: typeof ChefHat;
  items: TransactionItem[];
  pendingItemUpdate: string | null;
  onUpdateItemStatus: (
    itemId: string,
    status: "pending" | "in_progress" | "done",
  ) => void;
  disabled: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("rounded-md border border-neutral-200 bg-white", className)}>
      <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-600">
        <Icon className="size-3.5" /> {label}{" "}
        <span className="text-neutral-400">({items.length})</span>
      </div>
      <ul className="divide-y divide-neutral-100">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            pendingItemUpdate={pendingItemUpdate}
            onUpdateItemStatus={onUpdateItemStatus}
            disabled={disabled}
          />
        ))}
      </ul>
    </div>
  );
}

function ItemRow({
  item,
  pendingItemUpdate,
  onUpdateItemStatus,
  disabled,
}: {
  item: TransactionItem;
  pendingItemUpdate: string | null;
  onUpdateItemStatus: (
    itemId: string,
    status: "pending" | "in_progress" | "done",
  ) => void;
  disabled: boolean;
}) {
  const isPending = pendingItemUpdate === item.id;
  const status = item.prepStatus ?? "pending";
  const variant = item.variant
    ? item.variant === "hot"
      ? "Hot"
      : "Iced"
    : null;

  // Modifiers come from TransactionWithItems shape — item itself has
  // modifiers nested di parent. Tapi TransactionItem from list doesn't.
  // We rely on the parent passing items with modifiers already merged via
  // fetchTransactionById join. Let's defensively read modifiers if present.
  const modifiers = (item as TransactionItem & { modifiers?: Array<{ modifierSlug: string; selectedValue: string | null }> }).modifiers ?? [];

  // Sesi AE-62l — kalau item sebagian/seluruhnya di-refund, kitchen perlu
  // tahu supaya tidak prepare quantity yang sudah refunded.
  const refundedQty = item.refundedQuantity ?? 0;
  const effectiveQty = item.quantity - refundedQty;
  const fullyRefunded = refundedQty >= item.quantity;
  const partiallyRefunded = refundedQty > 0 && refundedQty < item.quantity;

  return (
    <li
      className={cn(
        "px-3 py-2",
        status === "done" && "bg-success-100/20",
        fullyRefunded && "bg-danger-100/30 opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span
              className={cn(
                "font-mono text-sm font-bold",
                fullyRefunded
                  ? "text-danger-500 line-through"
                  : "text-mahakan-green-900",
              )}
            >
              {effectiveQty}×
              {partiallyRefunded ? (
                <span className="ml-0.5 text-[10px] text-danger-500">
                  (dari {item.quantity}, {refundedQty} refund)
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "text-sm font-semibold",
                status === "done" || fullyRefunded
                  ? "line-through opacity-70"
                  : "text-neutral-900",
                fullyRefunded ? "text-danger-500" : "",
                status === "done" && !fullyRefunded ? "text-success-500" : "",
              )}
            >
              {item.itemName}
            </span>
            {variant ? (
              <Badge variant={variant === "Hot" ? "warning" : "info"}>
                {variant}
              </Badge>
            ) : null}
            {fullyRefunded ? (
              <Badge variant="danger">REFUNDED</Badge>
            ) : null}
          </div>
          {modifiers.length > 0 ? (
            <div className="mt-0.5 text-xs text-neutral-700">
              <span className="text-neutral-500">Modifier: </span>
              {modifiers
                .map((m) => m.selectedValue ?? m.modifierSlug)
                .join(", ")}
            </div>
          ) : null}
          {item.note ? (
            <div className="mt-1 flex items-start gap-1 rounded-md border border-warning-500/30 bg-warning-100/40 px-1.5 py-0.5 text-xs text-warning-500">
              <StickyNote className="mt-0.5 size-3 shrink-0" />
              <span className="font-medium">{item.note}</span>
            </div>
          ) : null}
        </div>

        {!disabled ? (
          <StatusButtonGroup
            current={status}
            pending={isPending}
            onChange={(next) => onUpdateItemStatus(item.id, next)}
          />
        ) : null}
      </div>
    </li>
  );
}

function StatusButtonGroup({
  current,
  pending,
  onChange,
}: {
  current: "pending" | "in_progress" | "done";
  pending: boolean;
  onChange: (status: "pending" | "in_progress" | "done") => void;
}) {
  if (current === "pending") {
    return (
      <button
        type="button"
        onClick={() => onChange("in_progress")}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-info-300 bg-info-100 px-2.5 py-1 text-xs font-semibold text-info-500 transition-colors hover:bg-info-100/80 disabled:opacity-50",
        )}
      >
        <Play className="size-3" /> Mulai Buat
      </button>
    );
  }
  if (current === "in_progress") {
    return (
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange("pending")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          title="Kembalikan ke menunggu"
        >
          <Hourglass className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => onChange("done")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-success-500 bg-success-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-success-500/90 disabled:opacity-50"
        >
          <Check className="size-3" /> Selesai
        </button>
      </div>
    );
  }
  // done
  return (
    <button
      type="button"
      onClick={() => onChange("in_progress")}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-success-500/40 bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-500 disabled:opacity-50"
      title="Klik untuk batalkan (kembalikan ke Dibuat)"
    >
      <CheckCheck className="size-3" /> Selesai
    </button>
  );
}

function PaymentMethodInline({ trx }: { trx: TransactionSummary }) {
  const method = trx.paymentMethod;
  let icon: React.ReactNode = null;
  let label = "";
  if (method === "cash") {
    icon = <Banknote className="inline size-3" aria-hidden />;
    label = "Tunai";
  } else if (method === "qris") {
    icon = <Smartphone className="inline size-3" aria-hidden />;
    label = "QRIS";
  } else if (method === "split") {
    icon = <CreditCard className="inline size-3" aria-hidden />;
    label = "Split";
  } else {
    icon = <CreditCard className="inline size-3" aria-hidden />;
    if (method === "card_bca") label = "BCA";
    else if (method === "card_bni") label = "BNI";
    else if (method === "card_mandiri") label = "Mandiri";
    else if (method === "card_bri") label = "BRI";
    else label = "Kartu";
  }
  return (
    <span className="inline-flex items-center gap-1 text-neutral-600">
      {icon}
      {label}
    </span>
  );
}
