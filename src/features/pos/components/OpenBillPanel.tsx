"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Transaction as TrxType } from "@/features/transactions";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  FileText,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Split,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import { PrintStationButtons } from "./PrintStationButtons";
import { SplitPaymentModal } from "./SplitPaymentModal";
import {
  cancelOpenBill,
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
import { useDebouncedValue } from "@/lib/use-debounced-value";
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
  // Sesi AE-36 — nowMs untuk urgency calc, di-update tiap 30s (sama dgn tick).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [details, setDetails] = useState<Record<string, TransactionWithItems>>(
    {},
  );
  const [closingBill, setClosingBill] = useState<TransactionWithItems | null>(
    null,
  );
  const [splittingBill, setSplittingBill] =
    useState<TransactionWithItems | null>(null);
  // Sesi AE-62l — cancel open bill (customer batal / no-show).
  const [cancellingBill, setCancellingBill] =
    useState<TransactionWithItems | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 200);
  const [filter, setFilter] = useState<"all" | "stale" | "fresh">("all");
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
  // a bill from a parallel device). Plus clock tick 15s untuk urgency.
  useEffect(() => {
    const dataInterval = setInterval(() => setTick((t) => t + 1), 30_000);
    const clockInterval = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => {
      clearInterval(dataInterval);
      clearInterval(clockInterval);
    };
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

  // Sesi AE-36 — dashboard aggregates + filter
  const dashboard = useMemo(() => {
    let stale = 0;
    let oldest = 0;
    let withCustomer = 0;
    let withNote = 0;
    for (const b of bills) {
      const age = nowMs - new Date(b.createdAt).getTime();
      if (age > STALE_THRESHOLD_MS) stale++;
      if (age > oldest) oldest = age;
      if (b.customerName) withCustomer++;
      if (b.note) withNote++;
    }
    return {
      total: bills.length,
      outstanding: totalOutstanding,
      stale,
      oldestMinutes: Math.floor(oldest / 60_000),
      withCustomer,
      withNote,
    };
  }, [bills, totalOutstanding, nowMs]);

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (filter === "stale") {
        if (nowMs - new Date(b.createdAt).getTime() <= STALE_THRESHOLD_MS)
          return false;
      } else if (filter === "fresh") {
        if (nowMs - new Date(b.createdAt).getTime() > STALE_THRESHOLD_MS)
          return false;
      }
      if (debouncedSearch) {
        const matchNum = b.transactionNumber
          .toLowerCase()
          .includes(debouncedSearch);
        const matchPager =
          b.pagerNumber !== null &&
          String(b.pagerNumber).includes(debouncedSearch);
        const matchCustomer = b.customerName
          ?.toLowerCase()
          .includes(debouncedSearch);
        if (!matchNum && !matchPager && !matchCustomer) return false;
      }
      return true;
    });
  }, [bills, filter, debouncedSearch, nowMs]);

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
      <header className="border-b border-neutral-200 bg-white px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
              <FileText
                className="size-5 text-mahakan-green-700"
                aria-hidden
              />
              Bill Aktif
            </h2>
            <p className="text-xs text-neutral-500">
              Tap kartu untuk bayar / split / edit. Auto-refresh 30s.
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

        {/* Sesi AE-36 — dashboard cards */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <BillStatCard
            label="Total Bill"
            value={String(dashboard.total)}
            tone="neutral"
            icon={<ClipboardList className="size-4" />}
          />
          <BillStatCard
            label="Outstanding"
            value={formatRupiah(dashboard.outstanding)}
            tone="info"
            icon={<Wallet className="size-4" />}
          />
          <BillStatCard
            label="Bill Lama (>2j)"
            value={String(dashboard.stale)}
            tone={dashboard.stale > 0 ? "warning" : "muted"}
            icon={<AlertTriangle className="size-4" />}
          />
          <BillStatCard
            label="Bill Terlama"
            value={
              dashboard.oldestMinutes > 0
                ? formatDuration(dashboard.oldestMinutes)
                : "—"
            }
            tone={dashboard.oldestMinutes > 120 ? "warning" : "muted"}
            icon={<Clock className="size-4" />}
          />
        </div>

        {/* Filters + search */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {([
            { v: "all", l: "Semua", c: dashboard.total },
            { v: "fresh", l: "Baru (<2j)", c: dashboard.total - dashboard.stale },
            { v: "stale", l: "Lama (>2j)", c: dashboard.stale },
          ] as const).map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setFilter(f.v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.v
                  ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
              )}
            >
              {f.l} ({f.c})
            </button>
          ))}
          <div className="ml-auto min-w-[180px] relative">
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
          <div className="space-y-3" role="status" aria-label="Memuat bill">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
              <ClipboardList className="size-6 text-neutral-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-neutral-700">
              {bills.length === 0
                ? "Belum ada open bill."
                : "Tidak ada bill yang match filter."}
            </p>
            <p className="max-w-xs text-xs text-neutral-500">
              Saat customer order tapi belum bayar, tap &ldquo;Simpan Bill&rdquo;
              di cart panel — bill akan muncul di sini sampai dibayar.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredBills.map((b) => (
              <BillCard
                key={b.id}
                summary={b}
                detail={details[b.id]}
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
                onCancel={() => {
                  if (details[b.id]) {
                    setCancellingBill(details[b.id]);
                    setCancelReason("");
                  }
                }}
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

      {/* Sesi AE-62l — Cancel open bill modal. Reason required. Restore
          stock + points + promo. Status flip ke voided. */}
      <Modal
        open={cancellingBill !== null}
        onClose={() => {
          if (cancelSubmitting) return;
          setCancellingBill(null);
          setCancelReason("");
        }}
        title="Cancel open bill?"
        description={
          cancellingBill
            ? `Bill ${cancellingBill.transactionNumber} (${cancellingBill.customerName ?? "—"}) Rp ${cancellingBill.total.toLocaleString("id-ID")}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCancellingBill(null);
                setCancelReason("");
              }}
              disabled={cancelSubmitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!cancellingBill) return;
                if (cancelReason.trim().length < 3) {
                  toast.error("Alasan minimal 3 karakter");
                  return;
                }
                setCancelSubmitting(true);
                const res = await cancelOpenBill({
                  transactionId: cancellingBill.id,
                  reason: cancelReason.trim(),
                });
                setCancelSubmitting(false);
                if (!isOk(res)) {
                  toast.error(res.error.message);
                  return;
                }
                toast.success(
                  `Bill ${cancellingBill.transactionNumber} di-cancel — stok dikembalikan`,
                );
                setCancellingBill(null);
                setCancelReason("");
                // Refresh bill list
                setTick((t) => t + 1);
              }}
              loading={cancelSubmitting}
            >
              <Trash2 className="size-4" aria-hidden /> Ya, Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-warning-300 bg-warning-100 p-3 text-xs text-warning-700">
            <p className="font-semibold">Yang akan terjadi:</p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>Stok bahan akan di-kembalikan ke inventory</li>
              <li>Promo yang terpakai akan dikembalikan slot-nya</li>
              <li>Bill status → voided (tidak bisa di-resume)</li>
              <li>Alasan akan tercatat di audit log</li>
            </ul>
          </div>
          <Input
            label="Alasan cancel"
            placeholder="mis. customer batal, no-show, salah order"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            required
          />
        </div>
      </Modal>
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
  onCancel: () => void;
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
  onCancel,
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
                {summary.note ? (
                  <span
                    className="ml-1 inline-flex items-center text-warning-500"
                    title={summary.note}
                  >
                    · 📝
                  </span>
                ) : null}
              </p>
              {/* Sesi AE-26 — customer info baris dedicated, lebih
               * prominent dari sebelumnya yg cuma append ke time line. */}
              {summary.customerName ? (
                <div className="mt-1 text-xs font-medium text-neutral-800">
                  👤 {summary.customerName}
                </div>
              ) : null}
              {detail ? (
                <p className="mt-1 text-xs text-neutral-700 line-clamp-1">
                  {detail.items.length} item: {itemSummary}
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

        {/* Sesi AE-62l — primary CTA full-width + larger; secondary actions
            di row terpisah dengan grid layout supaya tidak crowd di tablet
            Galaxy A7 Lite (1340px wide, BillCard ~320px). Sebelumnya 5
            buttons wrap → "Bayar Sekarang" pushed below visible card area. */}
        <div className="space-y-2">
          <Button
            size="lg"
            onClick={onPay}
            disabled={!detail}
            loading={!detail}
            className="!h-12 w-full touch:!h-12 !text-base"
          >
            Bayar Sekarang
          </Button>
          <div className="grid grid-cols-4 gap-1.5 touch:gap-2">
            <Button
              size="md"
              variant="outline"
              onClick={onSplit}
              disabled={!detail}
              className="!px-2"
            >
              <Split className="size-4" aria-hidden />
              <span className="hidden sm:inline">Split</span>
            </Button>
            <Button
              size="md"
              variant="outline"
              onClick={onEdit}
              disabled={!detail}
              className="!px-2"
            >
              <Pencil className="size-4" aria-hidden />
              <span className="hidden sm:inline">Edit</span>
            </Button>
            <Button
              size="md"
              variant="outline"
              onClick={() => setPrintOpen((v) => !v)}
              disabled={!detail}
              className="!px-2"
            >
              <Printer className="size-4" aria-hidden />
              <span className="hidden sm:inline">
                {printOpen ? "Tutup" : "Cetak"}
              </span>
            </Button>
            <Button
              size="md"
              variant="outline"
              onClick={onCancel}
              disabled={!detail}
              className="!px-2 text-danger-500 hover:bg-danger-100"
              title="Cancel bill (customer batal)"
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          </div>
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

/** Sesi AE-36 — dashboard stat card kecil. */
function BillStatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "info" | "success" | "muted";
  icon: React.ReactNode;
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-neutral-200 bg-white text-neutral-900",
    warning: "border-warning-500/30 bg-warning-100/40 text-warning-500",
    info: "border-info-300 bg-info-100/40 text-info-500",
    success: "border-success-500/30 bg-success-100/40 text-success-500",
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
    </div>
  );
}
