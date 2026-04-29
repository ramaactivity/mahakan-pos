"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import Papa from "papaparse";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DateRangePicker,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  getItemPerformance,
  isOk,
  type ItemPerformanceRow,
} from "@/features/reports";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./menu-engineering-csv";

type SortKey = "qty" | "revenue" | "avg";

const ALL_CATEGORIES = "__all__";

export function ItemPerformanceView() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [sort, setSort] = useState<SortKey>("qty");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);
  const [rows, setRows] = useState<ItemPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getItemPerformance(from, to, sort, 200);
      if (cancelled) return;
      if (isOk(res)) setRows(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to, sort]);

  const filteredRows = useMemo(() => {
    if (categoryFilter === ALL_CATEGORIES) return rows;
    return rows.filter((r) => r.categoryName === categoryFilter);
  }, [rows, categoryFilter]);

  const categoryOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const r of rows) unique.add(r.categoryName);
    const sorted = Array.from(unique).sort((a, b) => a.localeCompare(b));
    return [
      { value: ALL_CATEGORIES, label: "Semua kategori" },
      ...sorted.map((c) => ({ value: c, label: c })),
    ];
  }, [rows]);

  const totalRevenue = useMemo(
    () => filteredRows.reduce((s, r) => s + r.revenue, 0),
    [filteredRows],
  );
  const totalQty = useMemo(
    () => filteredRows.reduce((s, r) => s + r.quantity, 0),
    [filteredRows],
  );

  function onExportCsv() {
    if (filteredRows.length === 0) return;
    const data = filteredRows.map((r, idx) => ({
      Rank: idx + 1,
      Item: r.name,
      Kategori: r.categoryName,
      Qty: r.quantity,
      "Revenue (Rp)": r.revenue,
      "Avg/Unit (Rp)": r.averageOrderValue,
      "HPP (Rp)": r.cogs ?? "",
      "Margin %": r.marginPct ?? "",
    }));
    const csv = Papa.unparse(data, { newline: "\n" });
    const tag =
      categoryFilter === ALL_CATEGORIES
        ? "all"
        : categoryFilter.toLowerCase().replace(/\s+/g, "-");
    downloadCsv(`performa-item-${from}-${to}-${tag}.csv`, csv);
  }

  /**
   * Quartile thresholds for Best/Slow badges. Computed off the *current sort
   * result* — quartile is over qty, regardless of which column the user sorted
   * by. We need ≥4 distinct items with non-zero qty for this to be meaningful;
   * otherwise no badges are emitted (avoids labelling 2-item lists).
   */
  const quartiles = useMemo(() => {
    const qtys = filteredRows
      .map((r) => r.quantity)
      .filter((q) => q > 0)
      .sort((a, b) => a - b);
    if (qtys.length < 4) return null;
    // Linear-interpolation quartile (Excel-style)
    const q = (p: number) => {
      const pos = (qtys.length - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      if (lo === hi) return qtys[lo];
      return qtys[lo] + (qtys[hi] - qtys[lo]) * (pos - lo);
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    if (q3 - q1 < 1) return null; // no meaningful spread
    return { q1, q3 };
  }, [filteredRows]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Performa Item
          </h2>
          <p className="text-xs text-neutral-500">
            {filteredRows.length} item · {totalQty} unit ·{" "}
            {formatRupiah(totalRevenue)} revenue total
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onExportCsv}
          disabled={filteredRows.length === 0 || loading}
        >
          <Download className="size-4" /> CSV
        </Button>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem]">
              <DateRangePicker
                label="Periode"
                value={{ from, to }}
                onChange={(v) => {
                  setFrom(v.from ?? monthStart);
                  setTo(v.to ?? today);
                }}
              />
            </div>
            <div className="w-52">
              <Select
                label="Kategori"
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                options={categoryOptions}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat performa item">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              {rows.length === 0
                ? "Tidak ada penjualan di range ini."
                : "Tidak ada item di kategori ini untuk range ini."}
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
                    <th className="px-4 py-2 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredRows.map((row, idx) => {
                    const badge = quartiles
                      ? row.quantity >= quartiles.q3
                        ? "best"
                        : row.quantity > 0 && row.quantity <= quartiles.q1
                          ? "slow"
                          : null
                      : null;
                    return (
                      <tr key={row.menuItemId} className="hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="w-6 shrink-0 font-mono text-xs text-neutral-500">
                              {idx + 1}.
                            </span>
                            <span className="truncate font-medium text-neutral-900">
                              {row.name}
                            </span>
                            {badge === "best" && (
                              <Badge variant="success">Best Seller</Badge>
                            )}
                            {badge === "slow" && (
                              <Badge variant="warning">Slow Mover</Badge>
                            )}
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
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {row.marginPct === null ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            <span
                              className={cn(
                                row.marginPct >= 50
                                  ? "text-success-500"
                                  : row.marginPct >= 30
                                    ? "text-mahakan-green-900"
                                    : row.marginPct >= 0
                                      ? "text-warning-500"
                                      : "text-danger-500",
                              )}
                            >
                              {row.marginPct}%
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
