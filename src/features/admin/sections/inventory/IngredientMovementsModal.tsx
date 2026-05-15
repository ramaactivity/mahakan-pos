"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Trash2,
  Package,
  ShoppingCart,
  Sliders,
} from "lucide-react";
import { Badge, Modal, Skeleton } from "@/components/ui";
import {
  getIngredientMovementsInMonth,
  type Ingredient,
  type MovementKind,
  type MovementWithIngredient,
  isOk,
} from "@/features/inventory";
import { formatRupiah } from "@/lib/format";
import { resolveStockDecimal, formatStockQty } from "@/lib/stock-decimal";
import { cn } from "@/lib/utils";
import type { HppReportRow } from "@/features/reports";

interface Props {
  ingredient: Ingredient | null;
  monthYmd: string;
  flowRow: HppReportRow | null;
  onClose: () => void;
}

const KIND_LABEL: Record<MovementKind, string> = {
  initial: "Initial",
  purchase: "Pembelian",
  sale_deduct: "Penjualan",
  adjust: "Adjust",
  waste: "Waste",
  refund_restore: "Refund Restore",
  void_restore: "Void Restore",
  edit_restore: "Edit Restore",
};

const KIND_TONE: Record<
  MovementKind,
  "info" | "success" | "warning" | "danger" | "neutral"
> = {
  initial: "neutral",
  purchase: "success",
  sale_deduct: "info",
  adjust: "warning",
  waste: "danger",
  refund_restore: "success",
  void_restore: "success",
  edit_restore: "warning",
};

const KIND_ICON: Record<MovementKind, typeof Activity> = {
  initial: Package,
  purchase: ShoppingCart,
  sale_deduct: ArrowDownLeft,
  adjust: Sliders,
  waste: Trash2,
  refund_restore: ArrowUpRight,
  void_restore: ArrowUpRight,
  edit_restore: Sliders,
};

export function IngredientMovementsModal({
  ingredient,
  monthYmd,
  flowRow,
  onClose,
}: Props) {
  const [data, setData] = useState<MovementWithIngredient[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ingredient) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setData(null);
    setError(null);
    void (async () => {
      const res = await getIngredientMovementsInMonth(ingredient.id, monthYmd);
      if (cancelled) return;
      if (isOk(res)) setData(res.data.items);
      else setError(res.error.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ingredient, monthYmd]);

  /* Subtotal per kind untuk footer summary. */
  const byKind = useMemo(() => {
    if (!data) return null;
    const m = new Map<MovementKind, { count: number; qtyDelta: number }>();
    for (const mv of data) {
      const k = mv.kind as MovementKind;
      const entry = m.get(k) ?? { count: 0, qtyDelta: 0 };
      const qty = resolveStockDecimal(mv.qtyDelta, mv.qtyDeltaDecimal);
      entry.count++;
      entry.qtyDelta += qty;
      m.set(k, entry);
    }
    return m;
  }, [data]);

  if (!ingredient) return null;

  const unit = ingredient.unit;
  const monthLabel = new Date(`${monthYmd}-01T00:00:00Z`).toLocaleDateString(
    "id-ID",
    { month: "long", year: "numeric" },
  );

  return (
    <Modal
      open={ingredient !== null}
      onClose={onClose}
      title={`Pergerakan: ${ingredient.name}`}
      description={`Periode ${monthLabel}`}
      size="2xl"
    >
      <div className="space-y-4">
        {/* Flow summary cards (Stok Awal / Pembelian / Pemakaian / Stok Akhir) */}
        {flowRow ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <FlowStatCard
              label="Stok Awal"
              qty={flowRow.stockAwalQty}
              cost={flowRow.stockAwalCost}
              unit={unit}
              tone="neutral"
            />
            <FlowStatCard
              label="Pembelian"
              qty={flowRow.pembelianQty}
              cost={flowRow.pembelianCost}
              unit={unit}
              tone="success"
            />
            <FlowStatCard
              label="Pemakaian (HPP)"
              qty={flowRow.hppQty}
              cost={flowRow.hppCost}
              unit={unit}
              tone="info"
            />
            <FlowStatCard
              label="Stok Akhir"
              qty={flowRow.stockAkhirQty}
              cost={flowRow.stockAkhirCost}
              unit={unit}
              tone="neutral"
            />
          </div>
        ) : null}

        {flowRow?.partial ? (
          <div className="rounded-md border border-warning-500/40 bg-warning-100/30 p-2 text-xs text-warning-500">
            Data partial — Stok Akhir pakai stok saat ini (bukan opname). Buat
            opname akhir bulan untuk angka final.
          </div>
        ) : null}

        {/* Movements detail table */}
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            <Activity className="size-3.5" />
            Detail Pergerakan
          </h3>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-danger-500">{error}</p>
          ) : !data || data.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Belum ada pergerakan stok di bulan ini.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Waktu</th>
                    <th className="px-2 py-1.5 text-left font-medium">Jenis</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      Unit Cost
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Alasan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((mv) => {
                    const k = mv.kind as MovementKind;
                    const Icon = KIND_ICON[k];
                    const qty = resolveStockDecimal(
                      mv.qtyDelta,
                      mv.qtyDeltaDecimal,
                    );
                    return (
                      <tr
                        key={mv.id}
                        className="border-t border-neutral-100"
                      >
                        <td className="px-2 py-1.5 text-neutral-700">
                          {mv.createdAt.toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant={KIND_TONE[k]}>
                            <Icon className="size-3" /> {KIND_LABEL[k]}
                          </Badge>
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right font-mono",
                            qty > 0
                              ? "text-mahakan-green-700"
                              : qty < 0
                                ? "text-danger-500"
                                : "text-neutral-700",
                          )}
                        >
                          {qty > 0 ? "+" : ""}
                          {formatStockQty(
                            Math.abs(mv.qtyDelta),
                            mv.qtyDeltaDecimal,
                          )}{" "}
                          {unit}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {mv.unitCostAtMovement != null
                            ? formatRupiah(mv.unitCostAtMovement)
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-neutral-700">
                          {mv.reason ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {byKind ? (
                  <tfoot className="bg-neutral-50 text-[11px] font-semibold text-neutral-700">
                    {Array.from(byKind.entries()).map(([k, agg]) => (
                      <tr key={k} className="border-t border-neutral-200">
                        <td className="px-2 py-1" colSpan={2}>
                          Total {KIND_LABEL[k]} ({agg.count})
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1 text-right font-mono",
                            agg.qtyDelta > 0
                              ? "text-mahakan-green-700"
                              : agg.qtyDelta < 0
                                ? "text-danger-500"
                                : "",
                          )}
                          colSpan={3}
                        >
                          {agg.qtyDelta > 0 ? "+" : ""}
                          {agg.qtyDelta.toLocaleString("id-ID", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          {unit}
                        </td>
                      </tr>
                    ))}
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FlowStatCard({
  label,
  qty,
  cost,
  unit,
  tone,
}: {
  label: string;
  qty: number;
  cost: number;
  unit: string;
  tone: "neutral" | "success" | "info" | "warning";
}) {
  const toneColor = {
    neutral: "text-neutral-900",
    success: "text-mahakan-green-700",
    info: "text-info-500",
    warning: "text-warning-500",
  }[tone];
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className={cn("mt-0.5 font-mono text-sm font-bold", toneColor)}>
        {qty.toLocaleString("id-ID", { maximumFractionDigits: 2 })} {unit}
      </p>
      <p className="text-[10px] text-neutral-500">{formatRupiah(cost)}</p>
    </div>
  );
}
