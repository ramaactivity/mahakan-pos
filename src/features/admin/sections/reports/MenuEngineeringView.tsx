"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DateRangePicker,
  Skeleton,
} from "@/components/ui";
import {
  getMenuEngineeringMatrix,
  isOk,
  type MenuEngineeringResult,
  type MenuEngineeringRow,
  type MenuQuadrant,
} from "@/features/reports";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";
import {
  buildRowsCsv,
  buildSummaryCsv,
  downloadCsv,
} from "./menu-engineering-csv";

const QUADRANT_META: Record<
  MenuQuadrant,
  { label: string; action: string; cardClass: string; chipClass: string; iconClass: string }
> = {
  star: {
    label: "Star",
    action: "Pertahankan & promosi — bintang Anda",
    cardClass: "border-success-500/40 bg-success-100/40",
    chipClass: "bg-success-100 text-success-500",
    iconClass: "text-success-500",
  },
  puzzle: {
    label: "Puzzle",
    action: "Tingkatkan exposure — margin tinggi tapi jarang dijual",
    cardClass: "border-info-500/40 bg-info-100/40",
    chipClass: "bg-info-100 text-info-500",
    iconClass: "text-info-500",
  },
  plowhorse: {
    label: "Plowhorse",
    action: "Re-engineer cost atau naikkan harga",
    cardClass: "border-warning-500/40 bg-warning-100/40",
    chipClass: "bg-warning-100 text-warning-500",
    iconClass: "text-warning-500",
  },
  dog: {
    label: "Dog",
    action: "Pertimbangkan untuk dihapus / diganti",
    cardClass: "border-danger-500/40 bg-danger-100/40",
    chipClass: "bg-danger-100 text-danger-500",
    iconClass: "text-danger-500",
  },
  unclassified: {
    label: "Belum diklasifikasi",
    action: "Belum cukup data (qty=0 atau tanpa resep/HPP)",
    cardClass: "border-neutral-200 bg-neutral-50",
    chipClass: "bg-neutral-200 text-neutral-700",
    iconClass: "text-neutral-500",
  },
};

const QUADRANT_ORDER: MenuQuadrant[] = ["puzzle", "star", "dog", "plowhorse"];

export function MenuEngineeringView() {
  const today = todayJakarta();
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<MenuEngineeringResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await getMenuEngineeringMatrix(from, to);
      if (cancelled) return;
      if (isOk(res)) {
        setData(res.data);
      } else {
        setError(res.error.message);
        setData(null);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const quadrantBuckets = useMemo(() => {
    const buckets: Record<MenuQuadrant, MenuEngineeringRow[]> = {
      star: [],
      plowhorse: [],
      puzzle: [],
      dog: [],
      unclassified: [],
    };
    if (!data) return buckets;
    for (const row of data.rows) buckets[row.quadrant].push(row);
    // Sort each bucket by contribMargin DESC, fallback qty DESC.
    for (const q of QUADRANT_ORDER) {
      buckets[q].sort((a, b) => {
        const ma = a.contribMarginRp ?? -Infinity;
        const mb = b.contribMarginRp ?? -Infinity;
        if (mb !== ma) return mb - ma;
        return b.quantity - a.quantity;
      });
    }
    buckets.unclassified.sort((a, b) => b.quantity - a.quantity);
    return buckets;
  }, [data]);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-900">Menu Engineering Matrix</h2>
        <p className="text-xs text-neutral-500">
          Klasifikasi menu berdasarkan popularitas (qty) × kontribusi margin Rp (Kasavana-Smith).
          Median otomatis dari data periode ini.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <DateRangePicker
                label="Periode"
                value={{ from, to }}
                onChange={(v) => {
                  setFrom(v.from ?? monthStart);
                  setTo(v.to ?? today);
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={loading || !data || data.rows.length === 0}
              onClick={() => {
                if (!data) return;
                downloadCsv(`menu-matrix-summary-${from}-${to}.csv`, buildSummaryCsv(data));
                downloadCsv(`menu-matrix-rows-${from}-${to}.csv`, buildRowsCsv(data));
              }}
              aria-label="Export CSV"
            >
              <Download className="size-4" aria-hidden />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid gap-3 md:grid-cols-2" role="status" aria-label="Memuat matriks menu">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-danger-500">{error}</p>
          ) : !data || data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada penjualan di range ini.
            </p>
          ) : (
            <>
              <SummaryHeader data={data} />
              {!data.classified && (
                <div className="mt-4 rounded border border-warning-500/40 bg-warning-100/40 p-3 text-xs text-warning-500">
                  Belum cukup data untuk klasifikasi (butuh ≥4 item dengan penjualan + HPP). Tambahkan
                  resep ke menu yang belum punya, atau pilih range tanggal yang lebih panjang.
                </div>
              )}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {QUADRANT_ORDER.map((q) => (
                  <QuadrantCard
                    key={q}
                    quadrant={q}
                    items={quadrantBuckets[q]}
                  />
                ))}
              </div>
              {quadrantBuckets.unclassified.length > 0 && (
                <UnclassifiedSection items={quadrantBuckets.unclassified} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryHeader({ data }: { data: MenuEngineeringResult }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryStat label="Revenue total" value={formatRupiah(data.totals.revenue)} />
      <SummaryStat
        label="HPP total"
        value={data.totals.cogs > 0 ? formatRupiah(data.totals.cogs) : "—"}
      />
      <SummaryStat
        label="Contrib. margin total"
        value={formatRupiah(data.totals.contribMargin)}
      />
      <SummaryStat
        label="Median split"
        value={
          data.medianQty !== null && data.medianContribMargin !== null
            ? `${Math.round(data.medianQty)}× / ${formatRupiah(Math.round(data.medianContribMargin))}`
            : "—"
        }
      />
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-medium text-neutral-900">{value}</div>
    </div>
  );
}

function QuadrantCard({
  quadrant,
  items,
}: {
  quadrant: MenuQuadrant;
  items: MenuEngineeringRow[];
}) {
  const meta = QUADRANT_META[quadrant];
  return (
    <div
      className={cn(
        "rounded border p-3",
        meta.cardClass,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", meta.chipClass)}>
          {meta.label}
        </span>
        <span className="text-xs font-mono text-neutral-700">{items.length} item</span>
      </div>
      <p className="mt-1 text-xs text-neutral-700">{meta.action}</p>
      {items.length === 0 ? (
        <p className="mt-3 py-2 text-center text-xs text-neutral-500">— kosong —</p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-200/70 rounded bg-white">
          {items.map((row) => (
            <li
              key={row.menuItemId}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900">{row.name}</div>
                <div className="text-xs text-neutral-500">{row.categoryName}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-xs text-neutral-700">
                  {row.quantity}× · {formatRupiah(row.revenue)}
                </div>
                <div className="font-mono text-xs font-semibold text-neutral-900">
                  {row.contribMarginRp !== null ? formatRupiah(row.contribMarginRp) : "—"}
                  {row.marginPct !== null && (
                    <span className="ml-1 text-neutral-500">({row.marginPct}%)</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UnclassifiedSection({ items }: { items: MenuEngineeringRow[] }) {
  return (
    <details className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3">
      <summary className="cursor-pointer text-xs font-medium text-neutral-700">
        Belum diklasifikasi ({items.length}) — qty=0 atau tanpa HPP/resep
      </summary>
      <ul className="mt-2 divide-y divide-neutral-200 rounded bg-white">
        {items.map((row) => (
          <li
            key={row.menuItemId}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate text-neutral-900">{row.name}</div>
              <div className="text-xs text-neutral-500">{row.categoryName}</div>
            </div>
            <div className="shrink-0 font-mono text-xs text-neutral-500">
              {row.quantity}× · {row.cogs === null ? "no HPP" : formatRupiah(row.revenue)}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
