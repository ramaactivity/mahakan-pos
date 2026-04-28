"use client";

import { useEffect, useState } from "react";
import { Filter, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Combobox,
  DatePicker,
  Select,
  Skeleton,
  type ComboboxGroup,
} from "@/components/ui";
import {
  isOk,
  listIngredients,
  listMovements,
  type Ingredient,
  type MovementKind,
  type MovementWithIngredient,
} from "@/features/inventory";
import { hasPermission } from "@/lib/auth/rbac";
import { useSession } from "@/features/auth/SessionProvider";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";

const KIND_LABELS: Record<MovementKind, string> = {
  initial: "Stok awal",
  purchase: "Terima",
  sale_deduct: "Penjualan",
  adjust: "Adjust",
  waste: "Waste",
  refund_restore: "Refund (kembali)",
  void_restore: "Void (kembali)",
};

const KIND_TONES: Record<
  MovementKind,
  "success" | "info" | "neutral" | "warning" | "danger"
> = {
  initial: "neutral",
  purchase: "success",
  sale_deduct: "info",
  adjust: "warning",
  waste: "danger",
  refund_restore: "info",
  void_restore: "info",
};

const KIND_OPTIONS: Array<{ value: MovementKind | "all"; label: string }> = [
  { value: "all", label: "Semua tipe" },
  { value: "purchase", label: "Terima stok" },
  { value: "sale_deduct", label: "Penjualan" },
  { value: "adjust", label: "Adjust" },
  { value: "waste", label: "Waste" },
  { value: "initial", label: "Stok awal" },
  { value: "refund_restore", label: "Refund kembali" },
  { value: "void_restore", label: "Void kembali" },
];

const PAGE_SIZE = 50;

export function MovementsList() {
  const { session } = useSession();
  const role = session?.user.role;
  const canSeeCost = role ? hasPermission(role, "inventory.cost.view") : false;

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [movements, setMovements] = useState<MovementWithIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [ingredientFilter, setIngredientFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<MovementKind | "all">("all");
  const [refreshKey, setRefreshKey] = useState(0);

  // Load ingredients once for filter dropdown
  useEffect(() => {
    let cancelled = false;
    listIngredients({ activeOnly: false }).then((res) => {
      if (cancelled) return;
      if (isOk(res)) setIngredients(res.data.items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload movements on filter change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setOffset(0);
      const res = await listMovements({
        ingredientId:
          ingredientFilter === "all" ? undefined : ingredientFilter,
        kind: kindFilter === "all" ? undefined : kindFilter,
        dateFrom: from ? new Date(`${from}T00:00:00+07:00`) : undefined,
        dateTo: to ? new Date(`${to}T23:59:59+07:00`) : undefined,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (cancelled) return;
      if (isOk(res)) {
        setMovements(res.data.items);
        setHasMore(Boolean(res.data.hasMore));
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, from, to, ingredientFilter, kindFilter]);

  async function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    const res = await listMovements({
      ingredientId: ingredientFilter === "all" ? undefined : ingredientFilter,
      kind: kindFilter === "all" ? undefined : kindFilter,
      dateFrom: from ? new Date(`${from}T00:00:00+07:00`) : undefined,
      dateTo: to ? new Date(`${to}T23:59:59+07:00`) : undefined,
      limit: PAGE_SIZE,
      offset: nextOffset,
    });
    if (isOk(res)) {
      setMovements((prev) => [...prev, ...res.data.items]);
      setHasMore(Boolean(res.data.hasMore));
      setOffset(nextOffset);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Pergerakan Stok ({movements.length}
            {hasMore ? "+" : ""})
          </h2>
          <p className="text-xs text-neutral-500">
            Histori naik-turun stok per bahan: pembelian, penjualan, adjust,
            waste, refund. Append-only — tidak bisa edit/hapus.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 pb-1 text-sm font-medium text-neutral-700">
            <Filter className="size-4" aria-hidden /> Filter
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <DatePicker
              label="Dari Tanggal"
              value={from}
              maxDate={to}
              onChange={(v) => setFrom(v ?? "")}
              clearable={false}
            />
            <DatePicker
              label="Sampai Tanggal"
              value={to}
              minDate={from}
              onChange={(v) => setTo(v ?? "")}
              clearable={false}
            />
            <Combobox
              label="Bahan"
              placeholder="Semua bahan"
              searchPlaceholder="Cari bahan…"
              clearable
              groups={[
                {
                  label: "",
                  options: ingredients.map((i) => ({
                    value: i.id,
                    label: i.name,
                    hint: i.unit,
                    keywords: [i.unit],
                  })),
                } satisfies ComboboxGroup,
              ]}
              value={ingredientFilter === "all" ? null : ingredientFilter}
              onChange={(v) => setIngredientFilter(v ?? "all")}
            />
            <Select
              label="Tipe"
              options={KIND_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              value={kindFilter}
              onValueChange={(v) => setKindFilter(v as MovementKind | "all")}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada pergerakan stok di range/filter ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tanggal</th>
                    <th className="px-4 py-2 text-left font-medium">Bahan</th>
                    <th className="px-4 py-2 text-left font-medium">Tipe</th>
                    <th className="px-4 py-2 text-right font-medium">Delta</th>
                    {canSeeCost ? (
                      <th className="px-4 py-2 text-right font-medium">
                        Nilai
                      </th>
                    ) : null}
                    <th className="px-4 py-2 text-left font-medium">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {movements.map((m) => {
                    const positive = m.qtyDelta >= 0;
                    const value =
                      m.unitCostAtMovement !== null
                        ? Math.abs(m.qtyDelta) * m.unitCostAtMovement
                        : null;
                    return (
                      <tr key={m.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                          {formatIndonesianDateTime(m.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-neutral-900">
                            {m.ingredient.name}
                          </span>
                          <span className="ml-1 text-xs text-neutral-500">
                            ({m.ingredient.unit})
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={KIND_TONES[m.kind]}>
                            {KIND_LABELS[m.kind]}
                          </Badge>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono ${
                            positive ? "text-success-500" : "text-danger-500"
                          }`}
                        >
                          {positive ? "+" : ""}
                          {m.qtyDelta.toLocaleString("id-ID")}
                        </td>
                        {canSeeCost ? (
                          <td className="px-4 py-3 text-right font-mono text-xs text-neutral-700">
                            {value !== null ? formatRupiah(value) : "—"}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          {m.reason ?? (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {hasMore && !loading ? (
            <div className="border-t border-neutral-100 p-3 text-center">
              <Button variant="outline" size="sm" onClick={loadMore}>
                Muat lebih banyak
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
