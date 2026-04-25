"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  Input,
  Skeleton,
} from "@/components/ui";
import { isOk, reportService } from "@/mocks/services";
import type { ItemPerformanceRow } from "@/mocks/services/reportService";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "qty" | "revenue" | "avg";

export function ItemPerformanceView() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [sort, setSort] = useState<SortKey>("qty");
  const [rows, setRows] = useState<ItemPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await reportService.getItemPerformance(from, to, sort, 200);
      if (cancelled) return;
      if (isOk(res)) setRows(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to, sort]);

  const totalRevenue = useMemo(
    () => rows.reduce((s, r) => s + r.revenue, 0),
    [rows],
  );
  const totalQty = useMemo(
    () => rows.reduce((s, r) => s + r.quantity, 0),
    [rows],
  );

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-900">
          Performa Item
        </h2>
        <p className="text-xs text-neutral-500">
          {rows.length} item · {totalQty} unit · {formatRupiah(totalRevenue)}{" "}
          revenue total
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="grid gap-2 md:grid-cols-3">
            <Input
              label="Dari"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="Sampai"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat performa item">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada penjualan di range ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Item</th>
                    <th className="px-4 py-2 text-left font-medium">Kategori</th>
                    <SortableHeader
                      label="Qty"
                      thisKey="qty"
                      activeKey={sort}
                      onClick={() => setSort("qty")}
                    />
                    <SortableHeader
                      label="Revenue"
                      thisKey="revenue"
                      activeKey={sort}
                      onClick={() => setSort("revenue")}
                    />
                    <SortableHeader
                      label="Avg/Unit"
                      thisKey="avg"
                      activeKey={sort}
                      onClick={() => setSort("avg")}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((row, idx) => (
                    <tr key={row.menuItemId} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-6 shrink-0 font-mono text-xs text-neutral-500">
                            {idx + 1}.
                          </span>
                          <span className="truncate font-medium text-neutral-900">
                            {row.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {row.categoryName}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {row.quantity}×
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatRupiah(row.revenue)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-neutral-500">
                        {formatRupiah(row.averageOrderValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableHeader({
  label,
  thisKey,
  activeKey,
  onClick,
}: {
  label: string;
  thisKey: SortKey;
  activeKey: SortKey;
  onClick: () => void;
}) {
  const active = thisKey === activeKey;
  return (
    <th className="px-4 py-2 text-right font-medium">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-neutral-900",
          active ? "text-mahakan-green-900" : "text-neutral-500",
        )}
      >
        {label}
        {active ? (
          <ArrowDown className="size-3" aria-hidden />
        ) : (
          <ArrowUp className="size-3 opacity-30" aria-hidden />
        )}
      </button>
    </th>
  );
}
