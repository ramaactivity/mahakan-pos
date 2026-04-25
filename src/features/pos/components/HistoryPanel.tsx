"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Spinner } from "@/components/ui";
import { isOk, transactionService } from "@/mocks/services";
import type { Transaction, TransactionStatus } from "@/mocks/types";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime, toJakartaDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<{ value: TransactionStatus | "all"; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "paid", label: "Lunas" },
  { value: "voided", label: "Void" },
  { value: "refunded", label: "Refund" },
];

interface HistoryPanelProps {
  /** Trigger to refetch (bumped when detail modal commits void/refund). */
  refreshKey: number;
  onSelectTransaction: (trxId: string) => void;
}

export function HistoryPanel({
  refreshKey,
  onSelectTransaction,
}: HistoryPanelProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] =
    useState<TransactionStatus | "all">("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const today = toJakartaDateOnly(new Date());
      const res = await transactionService.listTransactions({
        from: `${today}T00:00:00.000Z`,
        to: `${today}T23:59:59.999Z`,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 100,
      });
      if (cancelled) return;
      if (isOk(res)) setTransactions(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, refreshKey]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-neutral-900">
          Riwayat Hari Ini
        </h2>
        <p className="text-sm text-neutral-500">
          Daftar transaksi yang dibuat hari ini.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
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
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-center text-neutral-500">
            Belum ada transaksi.
          </p>
        ) : (
          <div className="space-y-2">
            {transactions.map((trx) => (
              <button
                key={trx.id}
                type="button"
                onClick={() => onSelectTransaction(trx.id)}
                className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 text-left transition-all hover:border-mahakan-green-700 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="rounded-full bg-neutral-100 px-3 py-1 font-mono text-xs font-bold text-neutral-700">
                    P{trx.pagerNumber}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-neutral-900 truncate">
                      {trx.transactionNumber}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatIndonesianTime(trx.createdAt)} ·{" "}
                      {trx.items.length} item ·{" "}
                      {trx.paymentMethod === "cash"
                        ? "Tunai"
                        : trx.paymentMethod === "qris"
                          ? "QRIS"
                          : "Kartu"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={cn(
                      "font-mono text-sm font-medium",
                      trx.status === "voided"
                        ? "text-neutral-400 line-through"
                        : trx.status === "refunded"
                          ? "text-warning-500"
                          : "text-neutral-900",
                    )}
                  >
                    {formatRupiah(trx.total)}
                  </span>
                  <StatusBadge status={trx.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TransactionStatus }) {
  if (status === "paid") return <Badge variant="paid">Lunas</Badge>;
  if (status === "voided") return <Badge variant="voided">Void</Badge>;
  return <Badge variant="refunded">Refund</Badge>;
}
