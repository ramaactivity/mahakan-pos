"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChefHat,
  ClipboardList,
  Coffee,
  RefreshCw,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
  toast,
} from "@/components/ui";
import { PrintStationButtons } from "./PrintStationButtons";
import {
  getTransaction,
  isOk,
  listTransactions,
  markServed,
  type Transaction,
  type TransactionWithItems,
} from "@/features/transactions";
import { categoryToStation } from "@/lib/printer/station-mapping";
import type { ReceiptConfig } from "@/lib/printer/print-transaction";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime, toJakartaDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

type FilterState = "active" | "all" | "served";

interface OrderQueuePanelProps {
  cashierName: string;
  /** Outlet-driven receipt config; threaded to print buttons. */
  receiptConfig: ReceiptConfig | null;
  /** Bumped when other panels (history void/refund) commit changes. */
  refreshKey: number;
  onOpenSettings: () => void;
}

const FILTERS: Array<{ value: FilterState; label: string }> = [
  { value: "active", label: "Belum dikirim" },
  { value: "all", label: "Semua hari ini" },
  { value: "served", label: "Sudah dikirim" },
];

/**
 * KDS-style queue of paid transactions for the day. Each card shows the
 * pager, items grouped by station, and per-station print buttons. Cashier
 * can mark an order as "served" once handed off to staff/customer.
 *
 * Auto-refreshes every 30s so new payments from another tab/cashier appear
 * without manual reload. Manual Refresh button forces immediate fetch.
 */
export function OrderQueuePanel({
  cashierName,
  receiptConfig,
  refreshKey,
  onOpenSettings,
}: OrderQueuePanelProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>("active");
  const [tick, setTick] = useState(0);
  const [details, setDetails] = useState<Record<string, TransactionWithItems>>(
    {},
  );
  const [marking, setMarking] = useState<string | null>(null);

  // Fetch on filter change + manual refresh + auto-tick
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const today = toJakartaDateOnly(new Date());
      const res = await listTransactions({
        from: `${today}T00:00:00.000Z`,
        to: `${today}T23:59:59.999Z`,
        status: "paid",
        limit: 100,
      });
      if (cancelled) return;
      if (isOk(res)) {
        let items = res.data.items;
        if (filter === "active") {
          items = items.filter((t) => t.servedAt === null);
        } else if (filter === "served") {
          items = items.filter((t) => t.servedAt !== null);
        }
        // Newest first
        items.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setTransactions(items);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey, tick]);

  // Auto-refresh every 30s — keeps queue in sync without manual taps when
  // another cashier processes payments on a parallel device.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Lazy-fetch detail (with items) for transactions that come into view.
  // List endpoint returns Transaction summary; print buttons need full
  // TransactionWithItems for station coverage detection.
  useEffect(() => {
    let cancelled = false;
    async function loadDetails() {
      const missing = transactions.filter((t) => !details[t.id]);
      if (missing.length === 0) return;
      const fetched: Record<string, TransactionWithItems> = {};
      // Fetch sequentially — list usually <20 items, parallel adds little.
      for (const t of missing) {
        const res = await getTransaction(t.id);
        if (cancelled) return;
        if (isOk(res)) fetched[t.id] = res.data;
      }
      if (cancelled) return;
      setDetails((prev) => ({ ...prev, ...fetched }));
    }
    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [transactions, details]);

  async function handleMarkServed(trxId: string) {
    if (marking !== null) return;
    setMarking(trxId);
    const res = await markServed(trxId);
    setMarking(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Pesanan ditandai sudah dikirim");
    setTick((t) => t + 1);
  }

  const counts = useMemo(() => {
    let active = 0;
    let served = 0;
    for (const t of transactions) {
      if (t.servedAt === null) active++;
      else served++;
    }
    return { active, served, total: transactions.length };
  }, [transactions]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
              <ClipboardList
                className="size-5 text-mahakan-green-700"
                aria-hidden
              />
              Pesanan Hari Ini
            </h2>
            <p className="text-sm text-neutral-500">
              Cetak struk customer / tiket dapur / tiket bar per pesanan.
              Auto-refresh 30 detik.
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
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "primary" : "outline"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              {f.value === "active" && counts.active > 0
                ? ` (${counts.active})`
                : null}
              {f.value === "served" && counts.served > 0
                ? ` (${counts.served})`
                : null}
            </Button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Memuat pesanan">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
              <ClipboardList className="size-6 text-neutral-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-neutral-700">
              {filter === "active"
                ? "Tidak ada pesanan tertunda."
                : filter === "served"
                  ? "Belum ada pesanan yang ditandai dikirim."
                  : "Belum ada pesanan hari ini."}
            </p>
            <p className="max-w-xs text-xs text-neutral-500">
              Pesanan baru muncul di sini setelah pembayaran berhasil.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {transactions.map((t) => (
              <OrderCard
                key={t.id}
                summary={t}
                detail={details[t.id]}
                cashierName={cashierName}
                receiptConfig={receiptConfig}
                marking={marking === t.id}
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

interface OrderCardProps {
  summary: Transaction;
  detail: TransactionWithItems | undefined;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  marking: boolean;
  onMarkServed: () => void;
  onOpenSettings: () => void;
}

function OrderCard({
  summary,
  detail,
  cashierName,
  receiptConfig,
  marking,
  onMarkServed,
  onOpenSettings,
}: OrderCardProps) {
  const isServed = summary.servedAt !== null;
  const items = detail?.items ?? [];

  // Group items by station so kitchen vs bar lists are distinct.
  const kitchenItems = items.filter(
    (it) => categoryToStation(it.itemCategoryName) === "kitchen",
  );
  const barItems = items.filter(
    (it) => categoryToStation(it.itemCategoryName) === "bar",
  );
  const otherItems = items.filter(
    (it) => categoryToStation(it.itemCategoryName) === null,
  );

  return (
    <Card className={cn(isServed && "opacity-70")}>
      <CardContent className="space-y-3 p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-mahakan-green-100 text-lg font-bold text-mahakan-green-900">
              {summary.pagerNumber}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-neutral-900">
                  {summary.transactionNumber}
                </span>
                {isServed ? (
                  <Badge variant="neutral">Sudah dikirim</Badge>
                ) : (
                  <Badge variant="warning">Tertunda</Badge>
                )}
              </div>
              <p className="text-xs text-neutral-500">
                {formatIndonesianTime(summary.createdAt)} ·{" "}
                {summary.orderType === "dine_in" ? "Dine-in" : "Takeaway"} ·{" "}
                {formatRupiah(summary.total)}
              </p>
            </div>
          </div>
          {!isServed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onMarkServed}
              loading={marking}
            >
              <Check className="size-4" aria-hidden /> Tandai Dikirim
            </Button>
          ) : null}
        </header>

        {detail ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <ItemSection
              label="Dapur"
              Icon={ChefHat}
              empty="Tidak ada item dapur"
              items={kitchenItems.map(itemSummary)}
            />
            <ItemSection
              label="Bar"
              Icon={Coffee}
              empty="Tidak ada item minuman"
              items={barItems.map(itemSummary)}
            />
            {otherItems.length > 0 ? (
              <ItemSection
                label="Lainnya"
                Icon={ClipboardList}
                empty=""
                items={otherItems.map(itemSummary)}
                className="lg:col-span-2"
              />
            ) : null}
          </div>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}

        {detail ? (
          <PrintStationButtons
            trx={detail}
            cashierName={cashierName}
            receiptConfig={receiptConfig}
            onOpenSettings={onOpenSettings}
            size="sm"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

interface ItemSectionProps {
  label: string;
  Icon: typeof ChefHat;
  empty: string;
  items: string[];
  className?: string;
}

function ItemSection({
  label,
  Icon,
  empty,
  items,
  className,
}: ItemSectionProps) {
  if (items.length === 0 && !empty) return null;
  return (
    <div className={cn("rounded-md border border-neutral-200 p-3", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <Icon className="size-3.5" aria-hidden /> {label}{" "}
        <span className="text-neutral-400">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-400">{empty}</p>
      ) : (
        <ul className="space-y-0.5 text-sm text-neutral-900">
          {items.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function itemSummary(item: TransactionWithItems["items"][number]): string {
  const variant = item.variant
    ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
    : "";
  const mods =
    item.modifiers.length > 0
      ? ` — ${item.modifiers.map((m) => m.selectedValue ?? m.modifierSlug).join(", ")}`
      : "";
  const note = item.note ? ` · catatan: ${item.note}` : "";
  return `${item.quantity}× ${item.itemName}${variant}${mods}${note}`;
}
