"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyCard,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  isOk,
  listTopOutstanding,
  markPurchasePaid,
  type PaymentMethod,
  type TopOutstandingItem,
} from "@/features/purchases";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | "due_soon" | "overdue";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Semua",
  due_soon: "Due ≤ 3 hari",
  overdue: "Lewat jatuh tempo",
};

const PAY_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "transfer_bca", label: "Transfer BCA" },
  { value: "transfer_bri", label: "Transfer BRI" },
  { value: "transfer_other", label: "Transfer lain" },
];

export function TopTrackerView() {
  const { session } = useSession();
  const role = session?.user.role;
  const canMarkPaid = role
    ? hasPermission(role, "purchase.mark_paid")
    : false;

  const [items, setItems] = useState<TopOutstandingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");

  const [payTarget, setPayTarget] = useState<TopOutstandingItem | null>(
    null,
  );
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [paySubmitting, setPaySubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listTopOutstanding();
      if (cancelled) return;
      if (isOk(res)) setItems(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "due_soon")
      return items.filter(
        (i) => i.daysToDue !== null && i.daysToDue >= 0 && i.daysToDue <= 3,
      );
    return items.filter(
      (i) => i.daysToDue !== null && i.daysToDue < 0,
    );
  }, [items, filter]);

  const totals = useMemo(() => {
    let totalAll = 0;
    let totalOverdue = 0;
    let totalDueSoon = 0;
    for (const i of items) {
      totalAll += i.totalAmount;
      if (i.daysToDue !== null && i.daysToDue < 0)
        totalOverdue += i.totalAmount;
      if (i.daysToDue !== null && i.daysToDue >= 0 && i.daysToDue <= 3)
        totalDueSoon += i.totalAmount;
    }
    return { totalAll, totalOverdue, totalDueSoon };
  }, [items]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function onConfirmPaid() {
    if (!payTarget || paySubmitting) return;
    setPaySubmitting(true);
    const res = await markPurchasePaid({
      id: payTarget.id,
      paymentMethod: payMethod,
    });
    setPaySubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Lunas dicatat${res.data.expenseId ? " + entry kas dibuat" : ""}`,
    );
    setPayTarget(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
            <Clock className="size-5" aria-hidden /> Hutang Dagang ({items.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Pembelian TOP belum lunas. Tandai lunas akan otomatis catat
            entry kas (kalau ada kategori expense).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          label="Total Outstanding"
          value={formatRupiah(totals.totalAll)}
          tone="info"
        />
        <SummaryCard
          label="Due ≤ 3 hari"
          value={formatRupiah(totals.totalDueSoon)}
          tone={totals.totalDueSoon > 0 ? "warning" : "neutral"}
        />
        <SummaryCard
          label="Overdue"
          value={formatRupiah(totals.totalOverdue)}
          tone={totals.totalOverdue > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Filter status due"
          >
            {(["all", "due_soon", "overdue"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  filter === f
                    ? "bg-mahakan-green-700 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                )}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyCard
              icon={CheckCircle2}
              title="Tidak ada hutang dagang dalam filter ini"
              description="Semua bersih ✓ — atau ubah filter status di atas untuk lihat invoice paid/cancelled."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tgl</th>
                    <th className="px-4 py-2 text-left font-medium">
                      Supplier
                    </th>
                    <th className="px-4 py-2 text-left font-medium">
                      Invoice
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-left font-medium">Due</th>
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((p) => {
                    const dueText = formatDueLabel(p.daysToDue);
                    const dueTone = formatDueTone(p.daysToDue);
                    return (
                      <tr key={p.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono text-xs">
                          {p.purchaseDate}
                        </td>
                        <td className="px-4 py-3">
                          {p.supplierName ?? (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          {p.invoiceNo ?? (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatRupiah(p.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <Badge variant={dueTone}>{dueText}</Badge>
                          {p.dueDate ? (
                            <p className="mt-0.5 text-[11px] text-neutral-500">
                              {p.dueDate}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canMarkPaid ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPayTarget(p);
                                setPayMethod("cash");
                              }}
                            >
                              <CheckCircle2
                                className="size-4"
                                aria-hidden
                              />{" "}
                              Tandai Lunas
                            </Button>
                          ) : (
                            <span className="text-xs italic text-neutral-400">
                              Manager+ only
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        title="Tandai Lunas"
        description={
          payTarget
            ? `Total: ${formatRupiah(payTarget.totalAmount)}${
                payTarget.supplierName
                  ? ` · ${payTarget.supplierName}`
                  : ""
              }`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPayTarget(null)}
              disabled={paySubmitting}
            >
              Batal
            </Button>
            <Button onClick={onConfirmPaid} loading={paySubmitting}>
              Konfirmasi
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select
            label="Cara Bayar"
            options={PAY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            value={payMethod}
            onValueChange={(v) => setPayMethod(v as PaymentMethod)}
          />
          <p className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Setelah tandai lunas, entry kas dengan jumlah ini otomatis
            tercatat di Kas → Pengeluaran (jika ada kategori expense).
          </p>
        </div>
      </Modal>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "info" | "warning" | "danger" | "neutral";
}) {
  const Icon =
    tone === "danger"
      ? AlertTriangle
      : tone === "warning"
        ? Clock
        : tone === "info"
          ? Clock
          : Clock;
  return (
    <div
      className={cn(
        "rounded-md p-3",
        tone === "info" && "bg-info-100/40 text-info-500",
        tone === "warning" && "bg-warning-100/40 text-warning-500",
        tone === "danger" && "bg-danger-100/60 text-danger-500",
        tone === "neutral" && "bg-neutral-100 text-neutral-700",
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
        <Icon className="size-4" aria-hidden /> {label}
      </div>
      <p className="mt-1 font-mono text-base font-bold text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function formatDueLabel(days: number | null): string {
  if (days === null) return "Tanpa due";
  if (days < 0) return `Lewat ${Math.abs(days)} hari`;
  if (days === 0) return "Hari ini";
  if (days === 1) return "Besok";
  return `${days} hari lagi`;
}

function formatDueTone(
  days: number | null,
): "danger" | "warning" | "info" | "neutral" {
  if (days === null) return "neutral";
  if (days < 0) return "danger";
  if (days <= 3) return "warning";
  return "info";
}
