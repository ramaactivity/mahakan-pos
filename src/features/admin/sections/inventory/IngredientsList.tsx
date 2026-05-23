"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  AlertTriangle,
  ArchiveX,
  CalendarDays,
  Download,
  Eye,
  LayoutGrid,
  Pencil,
  Plus,
  PackagePlus,
  Sliders,
  Tags,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  compareBy,
  Input,
  Modal,
  Skeleton,
  SortableHeader,
  toast,
  useColumnSort,
} from "@/components/ui";
import {
  computeFlowTotals,
  deleteIngredient,
  getIngredientMonthlyFlow,
  isOk,
  listAtomicIngredients,
  listLowStockIngredients,
  type Ingredient,
  type IngredientSection,
  type SectionFilter,
} from "@/features/inventory";
import type { HppReportRow } from "@/features/reports";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { currentJakartaMonth } from "@/lib/date";
import { formatRupiah } from "@/lib/format";
import { formatStockQty } from "@/lib/stock-decimal";
import {
  cogsToBelanja,
  cogsToTracking,
  effectiveTrackingUnit,
  type IngredientUnitTiers,
} from "@/lib/unit-conversion";
import { cn } from "@/lib/utils";
import { downloadCsv } from "../reports/menu-engineering-csv";
import { exportIngredientsCsv } from "@/features/inventory/csv-actions";
import { BulkCsvImportModal } from "./BulkCsvImportModal";
import { IngredientFormModal } from "./IngredientFormModal";
import { IngredientMovementsModal } from "./IngredientMovementsModal";
import { StockReceiveModal } from "./StockReceiveModal";
import { StockAdjustModal } from "./StockAdjustModal";
import { StockWasteModal } from "./StockWasteModal";
import { SectionAssignModal } from "./SectionAssignModal";
import { buildCogsCsv } from "./inventory-cogs-csv";

const SECTION_FILTERS: Array<{ value: SectionFilter; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "supporting", label: "Supporting" },
  { value: "cleaning", label: "Cleaning" },
  { value: "unassigned", label: "Belum diset" },
];

const SECTION_BADGE: Record<
  IngredientSection,
  {
    variant: "success" | "info" | "warning" | "neutral";
    label: string;
  }
> = {
  kitchen: { variant: "success", label: "Kitchen" },
  bar: { variant: "info", label: "Bar" },
  supporting: { variant: "warning", label: "Supporting" },
  cleaning: { variant: "neutral", label: "Cleaning" },
};

type ActionTarget =
  | { kind: "edit"; ingredient: Ingredient }
  | { kind: "receive"; ingredient: Ingredient }
  | { kind: "adjust"; ingredient: Ingredient }
  | { kind: "waste"; ingredient: Ingredient }
  | { kind: "delete"; ingredient: Ingredient }
  | null;

export function IngredientsList() {
  const { session } = useSession();
  const role = session?.user.role;
  const canSeeCost = role ? hasPermission(role, "inventory.cost.view") : false;
  const canDelete = role
    ? hasPermission(role, "inventory.ingredient.delete")
    : false;
  const canAdjust = role ? hasPermission(role, "inventory.adjust") : false;
  const canReceive = role ? hasPermission(role, "inventory.receive") : false;
  const canWaste = role ? hasPermission(role, "inventory.waste") : false;
  const canCreate = role
    ? hasPermission(role, "inventory.ingredient.create")
    : false;
  const canBulkAssign = role
    ? hasPermission(role, "inventory.section.bulk_assign")
    : false;

  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [showInactive, setShowInactive] = useState(false);
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<ActionTarget>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);

  /* Sesi AE-58 — view mode toggle: snapshot (default) vs pergerakan bulanan
   * (Stok Awal + Pembelian + Stok Akhir + HPP per bahan). Source data dari
   * fetchHppReport yang sudah ready, dipakai juga di tab Reports → HPP. */
  const [viewMode, setViewMode] = useState<"snapshot" | "monthly">("snapshot");
  const [monthYmd, setMonthYmd] = useState<string>(currentJakartaMonth());
  const [movementsTarget, setMovementsTarget] = useState<Ingredient | null>(
    null,
  );

  const {
    data: ingredientsData,
    isLoading: ingredientsLoading,
  } = useQuery({
    queryKey: [
      "admin",
      "inventory",
      "ingredients",
      { showInactive, search: debouncedSearch, sectionFilter },
    ],
    queryFn: async () => {
      const res = await listAtomicIngredients({
        activeOnly: !showInactive,
        search: debouncedSearch || undefined,
        section: sectionFilter,
      });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data.items;
    },
  });

  const { data: lowStockData } = useQuery({
    queryKey: ["admin", "inventory", "low-stock"],
    queryFn: async () => {
      const res = await listLowStockIngredients();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  /* Sesi AE-58 — fetch monthly flow hanya kalau viewMode aktif, hemat
   * round-trip saat snapshot mode. Stale 30s biar refresh enak. */
  const { data: monthlyFlow, isLoading: monthlyLoading } = useQuery({
    queryKey: ["admin", "inventory", "monthly-flow", monthYmd],
    queryFn: async () => {
      const res = await getIngredientMonthlyFlow(monthYmd);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    enabled: viewMode === "monthly",
    staleTime: 30 * 1000,
  });
  const monthlyByIng = useMemo(() => {
    const m = new Map<string, HppReportRow>();
    if (monthlyFlow) for (const r of monthlyFlow) m.set(r.ingredientId, r);
    return m;
  }, [monthlyFlow]);
  const monthlyTotals = useMemo(
    () => (monthlyFlow ? computeFlowTotals(monthlyFlow) : null),
    [monthlyFlow],
  );

  // useMemo to keep stable reference across renders — TanStack Query
  // returns a new array reference each time the query refetches, even if
  // data is identical. Stabilizing here prevents downstream useMemos from
  // re-running unnecessarily.
  const ingredients: Ingredient[] = useMemo(
    () => ingredientsData ?? [],
    [ingredientsData],
  );
  const lowStock: Ingredient[] = useMemo(
    () => lowStockData ?? [],
    [lowStockData],
  );
  const loading = ingredientsLoading;

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["admin", "inventory"],
    });
  };

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const lowStockIds = useMemo(
    () => new Set(lowStock.map((i) => i.id)),
    [lowStock],
  );

  /* Sesi AE-52 — bahan dengan stok negatif (lebih kritis dari low-stock).
   * Counts ingredients yang currentStock < 0 — biasanya akibat sales
   * deduct tapi belum di-restock, atau opname adjustment. */
  const negativeStock = useMemo(
    () => ingredients.filter((i) => i.currentStock < 0),
    [ingredients],
  );

  /* Sesi AE-52 — Stok rendah collapsible. Default show top 12 paling
   * kritikal (sorted by deficit), klik "Lihat semua" untuk full list.
   * Reduce overwhelming wall of 140 chip pills jadi compact table actionable. */
  const [showAllLowStock, setShowAllLowStock] = useState(false);
  const sortedLowStock = useMemo(() => {
    // Sort by deficit (threshold - stock) descending — paling parah di atas
    return [...lowStock].sort((a, b) => {
      const deficitA = (a.reorderThreshold ?? 0) - (a.currentStock ?? 0);
      const deficitB = (b.reorderThreshold ?? 0) - (b.currentStock ?? 0);
      return deficitB - deficitA;
    });
  }, [lowStock]);
  const visibleLowStock = showAllLowStock
    ? sortedLowStock
    : sortedLowStock.slice(0, 12);

  const filtered = useMemo(
    () => (lowOnly ? ingredients.filter((i) => lowStockIds.has(i.id)) : ingredients),
    [ingredients, lowStockIds, lowOnly],
  );

  const sort = useColumnSort("inventory.ingredients", "name", "asc");
  const visible = useMemo(() => {
    const getValue = (i: Ingredient) => {
      switch (sort.key) {
        case "name":
          return i.name;
        case "section":
          return i.section ? (SECTION_BADGE[i.section]?.label ?? "") : "";
        case "currentStock":
          return i.currentStock ?? 0;
        case "unit":
          return i.unit ?? "";
        case "costPerUnit":
          return i.costPerUnit ?? 0;
        case "reorderThreshold":
          return i.reorderThreshold ?? 0;
        default:
          return i.name;
      }
    };
    return [...filtered].sort(compareBy(sort.dir, getValue));
  }, [filtered, sort.key, sort.dir]);

  const totalStockValue = useMemo(
    () =>
      ingredients.reduce(
        (sum, i) => sum + (i.currentStock ?? 0) * (i.costPerUnit ?? 0),
        0,
      ),
    [ingredients],
  );

  async function handleConfirmDelete() {
    if (target?.kind !== "delete") return;
    const res = await deleteIngredient(target.ingredient.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Bahan ${target.ingredient.name} dihapus`);
    setTarget(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      {/* Sesi AE-52 — header redesign: title compact + Tambah Bahan
       * right-aligned, paragraph description di-collapse jadi 1-line ringkas. */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-neutral-900">
            Bahan Baku
          </h2>
          <p className="text-xs text-neutral-500">
            Raw ingredient (atomik). Preparation di tab Preparations. Stok
            update via Terima / Adjust / Waste, otomatis terkurang dari sales.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Sesi AE-58 — view mode toggle Snapshot ↔ Pergerakan Bulan */}
          <div
            role="tablist"
            aria-label="Tampilan tabel"
            className="inline-flex rounded-md border border-neutral-200 bg-white p-0.5 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "snapshot"}
              onClick={() => setViewMode("snapshot")}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                viewMode === "snapshot"
                  ? "bg-mahakan-green-700 text-white"
                  : "text-neutral-600 hover:bg-neutral-100",
              )}
            >
              <LayoutGrid className="mr-1 inline size-3" />
              Snapshot
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "monthly"}
              onClick={() => setViewMode("monthly")}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                viewMode === "monthly"
                  ? "bg-mahakan-green-700 text-white"
                  : "text-neutral-600 hover:bg-neutral-100",
              )}
            >
              <TrendingUp className="mr-1 inline size-3" />
              Pergerakan Bulan
            </button>
          </div>
          {viewMode === "monthly" ? (
            <>
              <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs">
                <CalendarDays className="size-3 text-neutral-500" />
                <input
                  type="month"
                  value={monthYmd}
                  onChange={(e) =>
                    setMonthYmd(e.target.value || currentJakartaMonth())
                  }
                  className="bg-transparent outline-none"
                />
              </div>
              {monthlyFlow && monthlyFlow.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const csv = buildCogsCsv(monthlyFlow, monthYmd);
                    downloadCsv(`cogs-${monthYmd}.csv`, csv);
                    toast.success(`Export COGS ${monthYmd}`);
                  }}
                >
                  <Download className="size-3.5" /> CSV
                </Button>
              ) : null}
            </>
          ) : null}
          {canCreate ? (
            <>
              <Button
                variant="outline"
                onClick={async () => {
                  setExportingCsv(true);
                  try {
                    const res = await exportIngredientsCsv();
                    if (!isOk(res)) {
                      toast.error(res.error.message);
                      return;
                    }
                    downloadCsv(res.data.filename, res.data.csv);
                    toast.success(
                      `Download CSV: ${res.data.rowCount} bahan`,
                    );
                  } finally {
                    setExportingCsv(false);
                  }
                }}
                disabled={exportingCsv}
                title="Download semua bahan sebagai CSV (untuk bulk edit di Sheets)"
              >
                <Download className="size-4" aria-hidden /> Download CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => setCsvImportOpen(true)}
                title="Upload CSV hasil edit (bulk update)"
              >
                <PackagePlus className="size-4" aria-hidden /> Upload CSV
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden /> Tambah Bahan
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {/* Sesi AE-58 — partial baseline banner (monthly mode) */}
      {viewMode === "monthly" && monthlyTotals && monthlyTotals.partialCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-100/30 p-3 text-sm text-warning-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">
              {monthlyTotals.partialCount} dari {monthlyTotals.rowCount} bahan
              belum punya opname awal bulan
            </p>
            <p className="text-xs">
              Pergerakan jadi perkiraan — Stok Akhir pakai stok saat ini
              (bukan opname). Buat opname akhir bulan ini agar angka HPP akurat.
            </p>
          </div>
        </div>
      ) : null}

      {/* Sesi AE-52 — dashboard cards 4-metric overview supaya owner
       * langsung scan kondisi stok tanpa scroll. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <InventoryStat
          label="Total Bahan"
          value={String(ingredients.length)}
          tone="neutral"
        />
        {canSeeCost ? (
          <InventoryStat
            label="Nilai Stok"
            value={formatRupiah(totalStockValue)}
            tone="neutral"
          />
        ) : null}
        <InventoryStat
          label="Stok Rendah"
          value={String(lowStock.length)}
          tone={lowStock.length > 0 ? "warning" : "neutral"}
          onClick={
            lowStock.length > 0 ? () => setLowOnly((v) => !v) : undefined
          }
          active={lowOnly}
        />
        <InventoryStat
          label="Stok Negatif"
          value={String(negativeStock.length)}
          tone={negativeStock.length > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Sesi AE-130 (Anisa polish) — Card stok rendah redesign:
       *  - Title lebih tegas + count langsung di badge
       *  - Kolom "Stok Min" diganti dengan defisit yang lebih visual
       *    (sisa / min dalam 1 cell pakai "/" — hemat horizontal space
       *    + clear visual hierarchy)
       *  - Aksi default mobile-friendly: tombol "Terima" pakai full label,
       *    bukan icon kecil. Tap target lebih besar.
       *  - Toggle filter dipindah ke bawah supaya CTA utama (Terima) lebih
       *    prominent. Title bar lebih ringkas. */}
      {lowStock.length > 0 ? (
        <Card className="border-warning-500/40 bg-warning-100/30">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-warning-500">
              <AlertTriangle className="size-4" aria-hidden />
              Perlu Re-Order
              <Badge variant="warning" className="ml-1">
                {lowStock.length}
              </Badge>
            </h3>
            <Button
              variant={lowOnly ? "primary" : "ghost"}
              size="sm"
              onClick={() => setLowOnly((v) => !v)}
            >
              {lowOnly ? "Lihat semua bahan" : "Filter ke tabel bawah"}
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto rounded-md border border-warning-500/20 bg-white">
              <table className="w-full text-xs">
                <thead className="border-b border-warning-500/20 bg-warning-100/40 text-[10px] uppercase tracking-wider text-warning-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">
                      Bahan
                    </th>
                    <th
                      className="px-3 py-1.5 text-right font-medium"
                      title="Sisa stok saat ini dibanding stok minimum"
                    >
                      Sisa / Min
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      Kurang
                    </th>
                    {canReceive ? (
                      <th className="px-3 py-1.5 text-right font-medium">
                        Aksi
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-warning-500/10">
                  {visibleLowStock.map((i) => {
                    const sisa = formatStockQty(
                      i.currentStock,
                      i.currentStockDecimal ?? null,
                    );
                    const deficit =
                      (i.reorderThreshold ?? 0) - (i.currentStock ?? 0);
                    const isNegative = i.currentStock < 0;
                    return (
                      <tr key={i.id} className="hover:bg-warning-100/30">
                        <td className="px-3 py-2">
                          <span className="font-medium text-neutral-900">
                            {i.name}
                          </span>
                          {isNegative ? (
                            <Badge variant="danger" className="ml-1.5">
                              minus
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              isNegative
                                ? "text-danger-500 font-semibold"
                                : "text-neutral-900",
                            )}
                          >
                            {sisa}
                          </span>
                          <span className="font-mono tabular-nums text-neutral-400">
                            {" / "}
                            {i.reorderThreshold}
                          </span>{" "}
                          <span className="text-neutral-500">{i.unit}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-warning-500">
                          +{deficit} {i.unit}
                        </td>
                        {canReceive ? (
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setTarget({ kind: "receive", ingredient: i })
                              }
                              aria-label={`Terima stok ${i.name}`}
                            >
                              <PackagePlus
                                className="size-3.5"
                                aria-hidden
                              />{" "}
                              Terima
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {lowStock.length > 12 ? (
              <div className="mt-2 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllLowStock((v) => !v)}
                >
                  {showAllLowStock
                    ? `Sembunyikan ${lowStock.length - 12} lainnya`
                    : `Lihat ${lowStock.length - 12} bahan lainnya`}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Input
                label="Cari nama bahan"
                placeholder="mis. susu, espresso, cup"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              Tampilkan non-aktif
            </label>
          </div>
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Filter section"
          >
            {SECTION_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setSectionFilter(f.value)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  sectionFilter === f.value
                    ? "bg-mahakan-green-700 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat bahan">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center">
              {lowOnly ? (
                <>
                  <p className="text-sm text-neutral-500">
                    Tidak ada bahan stok-rendah dari hasil filter saat ini.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setLowOnly(false)}
                  >
                    Tampilkan semua
                  </Button>
                </>
              ) : ingredients.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Belum ada bahan. Klik &ldquo;Tambah Bahan&rdquo; untuk mulai.
                </p>
              ) : (
                <p className="text-sm text-neutral-500">
                  Tidak ada bahan yang cocok dengan filter saat ini.
                </p>
              )}
            </div>
          ) : viewMode === "monthly" ? (
            <MonthlyFlowTable
              visible={visible}
              monthlyByIng={monthlyByIng}
              monthlyLoading={monthlyLoading}
              monthlyTotals={monthlyTotals}
              onDrillDown={(ing) => setMovementsTarget(ing)}
              canReceive={canReceive}
              canAdjust={canAdjust}
              canWaste={canWaste}
              canDelete={canDelete}
              setTarget={setTarget}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    {canBulkAssign ? (
                      <th className="px-2 py-2 text-left font-medium w-8">
                        <input
                          type="checkbox"
                          aria-label="Pilih semua"
                          checked={
                            visible.length > 0 &&
                            visible.every((i) => selectedIds.has(i.id))
                          }
                          onChange={(e) =>
                            e.target.checked
                              ? setSelectedIds(new Set(visible.map((i) => i.id)))
                              : clearSelection()
                          }
                          className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
                        />
                      </th>
                    ) : null}
                    <SortableHeader columnKey="name" label="Nama" sort={sort} />
                    <SortableHeader
                      columnKey="section"
                      label="Section"
                      sort={sort}
                    />
                    <SortableHeader
                      columnKey="currentStock"
                      label="Stok"
                      sort={sort}
                      align="right"
                    />
                    <SortableHeader
                      columnKey="unit"
                      label="Unit"
                      sort={sort}
                    />
                    {/* Sesi AE-130 — Cost/Unit dihilangkan dari tab Bahan
                     * (Anisa feedback): di tab ini staff fokus ke sisa
                     * persediaan, bukan harga. Info Cost/Unit tetap tersedia
                     * di tab COGS & Variance. */}
                    <SortableHeader
                      columnKey="reorderThreshold"
                      label="Stok Minimum"
                      sort={sort}
                      align="right"
                    />
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {visible.map((i) => {
                    const isLow = lowStockIds.has(i.id);
                    const sectionInfo = i.section
                      ? SECTION_BADGE[i.section]
                      : null;
                    return (
                      <tr key={i.id} className="hover:bg-neutral-50">
                        {canBulkAssign ? (
                          <td className="px-2 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Pilih ${i.name}`}
                              checked={selectedIds.has(i.id)}
                              onChange={() => toggleSelected(i.id)}
                              className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-neutral-900">
                              {i.name}
                            </span>
                            {!i.isActive ? (
                              <Badge variant="neutral">Non-aktif</Badge>
                            ) : null}
                            {i.currentStock < 0 ? (
                              <Badge variant="danger">
                                <AlertTriangle className="size-3" aria-hidden />{" "}
                                Stok minus
                              </Badge>
                            ) : isLow ? (
                              <Badge variant="warning">
                                <AlertTriangle className="size-3" aria-hidden />{" "}
                                Stok rendah
                              </Badge>
                            ) : null}
                          </div>
                          {i.notes ? (
                            <p className="mt-0.5 text-xs text-neutral-500">
                              {i.notes}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {sectionInfo ? (
                            <Badge variant={sectionInfo.variant}>
                              {sectionInfo.label}
                            </Badge>
                          ) : (
                            <span className="text-xs italic text-neutral-400">
                              belum diset
                            </span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right font-mono",
                            i.currentStock < 0 ? "text-danger-700" : "",
                          )}
                        >
                          {/* Sesi AE-130 — display dalam tracking unit
                              kalau set (Anisa: "untuk sisa pakai satuan
                              terbesar"). COGS breakdown subtle di bawah
                              supaya tidak hilang info presisi. */}
                          <StockDisplay ingredient={i} />
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {/* Sesi AE-136 — prefer Purchase Unit (unitBelanja)
                           * sebagai display unit. Fallback ke unitTracking
                           * (legacy data sebelum konvensi 2-unit), lalu unit
                           * recipe sebagai default. */}
                          {i.unitBelanja?.trim() ||
                            i.unitTracking?.trim() ||
                            i.unit}
                        </td>
                        {/* Sesi AE-130 — Cost/Unit per-row dihilangkan (lihat
                         * header comment). Tab Bahan = fokus stok, bukan harga. */}
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {i.reorderThreshold !== null ? (
                            i.reorderThreshold.toLocaleString("id-ID")
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canReceive && i.isActive ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Terima stok"
                                title="Terima stok"
                                onClick={() =>
                                  setTarget({ kind: "receive", ingredient: i })
                                }
                              >
                                <PackagePlus className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                            {canAdjust && i.isActive ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Adjust stok"
                                title="Adjust stok"
                                onClick={() =>
                                  setTarget({ kind: "adjust", ingredient: i })
                                }
                              >
                                <Sliders className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                            {canWaste && i.isActive ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Catat waste"
                                title="Catat waste"
                                onClick={() =>
                                  setTarget({ kind: "waste", ingredient: i })
                                }
                              >
                                <ArchiveX className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Edit bahan"
                              title="Edit"
                              onClick={() =>
                                setTarget({ kind: "edit", ingredient: i })
                              }
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            {canDelete && i.isActive ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Hapus bahan"
                                title="Hapus"
                                onClick={() =>
                                  setTarget({ kind: "delete", ingredient: i })
                                }
                                className="text-danger-500 hover:bg-danger-100"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            ) : null}
                          </div>
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

      <IngredientFormModal
        open={createOpen || target?.kind === "edit"}
        edit={target?.kind === "edit" ? target.ingredient : null}
        onClose={() => {
          setCreateOpen(false);
          setTarget(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setTarget(null);
          refresh();
        }}
      />

      <StockReceiveModal
        open={target?.kind === "receive"}
        ingredient={target?.kind === "receive" ? target.ingredient : null}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          refresh();
        }}
      />

      <StockAdjustModal
        open={target?.kind === "adjust"}
        ingredient={target?.kind === "adjust" ? target.ingredient : null}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          refresh();
        }}
      />

      <StockWasteModal
        open={target?.kind === "waste"}
        ingredient={target?.kind === "waste" ? target.ingredient : null}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          refresh();
        }}
      />

      <SectionAssignModal
        open={bulkOpen}
        ingredientIds={Array.from(selectedIds)}
        onClose={() => setBulkOpen(false)}
        onSaved={() => {
          setBulkOpen(false);
          clearSelection();
          refresh();
        }}
      />

      <BulkCsvImportModal
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onApplied={() => {
          refresh();
        }}
      />

      {/* Sesi AE-58 — drill-down modal pergerakan stok per bahan per bulan */}
      <IngredientMovementsModal
        ingredient={movementsTarget}
        monthYmd={monthYmd}
        flowRow={
          movementsTarget ? (monthlyByIng.get(movementsTarget.id) ?? null) : null
        }
        onClose={() => setMovementsTarget(null)}
      />

      {canBulkAssign && selectedIds.size > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-mahakan-green-900 px-4 py-2 text-sm text-white shadow-lg">
          <span className="font-medium">
            {selectedIds.size} bahan dipilih
          </span>
          <Button
            size="sm"
            onClick={() => setBulkOpen(true)}
            className="bg-white text-mahakan-green-900 hover:bg-neutral-100"
          >
            <Tags className="size-4" aria-hidden /> Set Section
          </Button>
          <button
            type="button"
            onClick={clearSelection}
            aria-label="Batal pilih"
            className="rounded-full p-1 hover:bg-mahakan-green-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <Modal
        open={target?.kind === "delete"}
        onClose={() => setTarget(null)}
        title="Hapus bahan?"
        description={
          target?.kind === "delete"
            ? `${target.ingredient.name} (sisa ${formatStockQty(
                target.ingredient.currentStock,
                target.ingredient.currentStockDecimal ?? null,
              )} ${target.ingredient.unit})`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Soft-delete: bahan disembunyikan dari list aktif tapi histori
          pergerakan stok tetap dipertahankan. Resep yang masih merefer bahan
          ini akan tetap valid sampai resep diedit.
        </p>
      </Modal>
    </div>
  );
}

/**
 * Sesi AE-52 — dashboard stat card untuk Inventory overview. Tone color
 * + optional onClick (untuk Stok Rendah → toggle filter). Active state
 * visual kalau onClick + active prop set.
 */
function InventoryStat({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger";
  onClick?: () => void;
  active?: boolean;
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-neutral-200 bg-white text-neutral-900",
    warning:
      "border-warning-500/40 bg-warning-100/30 text-warning-500",
    danger:
      "border-danger-500/40 bg-danger-100/30 text-danger-500",
  };
  const activeRing = active ? "ring-2 ring-mahakan-green-700" : "";
  const interactive = onClick
    ? "cursor-pointer hover:shadow-sm transition-shadow"
    : "";
  const content = (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        toneClasses[tone],
        activeRing,
        interactive,
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
        {value}
      </div>
    </div>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="text-left">
        {content}
      </button>
    );
  }
  return content;
}

/* ============================================================
 * Sesi AE-58 — Monthly Flow Table
 *
 * Kolom: Bahan | Stok Awal (qty/Rp) | Pembelian (qty/Rp) | Stok Akhir (qty/Rp)
 *      | Pemakaian (HPP qty) | Nilai HPP (Rp) | Status | Aksi
 *
 * Source: monthlyByIng (HppReportRow per ingredientId). Bahan tanpa data
 * di map fallback ke placeholder zero row.
 * ============================================================ */
function MonthlyFlowTable({
  visible,
  monthlyByIng,
  monthlyLoading,
  monthlyTotals,
  onDrillDown,
  canReceive,
  canAdjust,
  canWaste,
  canDelete,
  setTarget,
}: {
  visible: Ingredient[];
  monthlyByIng: Map<string, HppReportRow>;
  monthlyLoading: boolean;
  monthlyTotals: ReturnType<typeof computeFlowTotals> | null;
  onDrillDown: (ing: Ingredient) => void;
  canReceive: boolean;
  canAdjust: boolean;
  canWaste: boolean;
  canDelete: boolean;
  setTarget: (t: ActionTarget) => void;
}) {
  if (monthlyLoading) {
    return (
      <div className="space-y-2 p-4" role="status" aria-label="Memuat pergerakan">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left font-medium">
              Bahan
            </th>
            <th className="px-3 py-2 text-right font-medium">Stok Awal</th>
            <th className="px-3 py-2 text-right font-medium">Pembelian</th>
            <th className="px-3 py-2 text-right font-medium">Stok Akhir</th>
            <th className="px-3 py-2 text-right font-medium">Pemakaian</th>
            <th className="px-3 py-2 text-right font-medium">Nilai HPP</th>
            <th className="px-3 py-2 text-center font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {visible.map((ing) => {
            const row = monthlyByIng.get(ing.id);
            const status: "accurate" | "partial" | "no_baseline" = !row
              ? "no_baseline"
              : !row.partial
                ? "accurate"
                : row.stockAwalQty === 0 && row.pembelianQty === 0
                  ? "no_baseline"
                  : "partial";
            const statusBadge = {
              accurate: {
                cls: "bg-mahakan-green-50 text-mahakan-green-900",
                label: "Akurat",
              },
              partial: {
                cls: "bg-warning-50 text-warning-500",
                label: "Partial",
              },
              no_baseline: {
                cls: "bg-danger-100 text-danger-500",
                label: "No baseline",
              },
            }[status];
            const sectionInfo = ing.section ? SECTION_BADGE[ing.section] : null;
            return (
              <tr key={ing.id} className="hover:bg-neutral-50">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 hover:bg-neutral-50">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-neutral-900">
                      {ing.name}
                    </span>
                    {sectionInfo ? (
                      <Badge variant={sectionInfo.variant}>
                        {sectionInfo.label}
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <FlowQtyCell
                  qty={row?.stockAwalQty ?? 0}
                  cost={row?.stockAwalCost ?? 0}
                  unit={ing.unit}
                />
                <FlowQtyCell
                  qty={row?.pembelianQty ?? 0}
                  cost={row?.pembelianCost ?? 0}
                  unit={ing.unit}
                  emphasize={(row?.pembelianQty ?? 0) > 0}
                />
                <FlowQtyCell
                  qty={row?.stockAkhirQty ?? 0}
                  cost={row?.stockAkhirCost ?? 0}
                  unit={ing.unit}
                />
                <FlowQtyCell
                  qty={row?.hppQty ?? 0}
                  cost={row?.hppCost ?? 0}
                  unit={ing.unit}
                  emphasize={(row?.hppQty ?? 0) > 0}
                />
                <td className="px-3 py-2 text-right font-mono font-semibold text-neutral-900">
                  {formatRupiah(row?.hppCost ?? 0)}
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      statusBadge.cls,
                    )}
                  >
                    {statusBadge.label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Lihat pergerakan"
                      aria-label="Detail pergerakan"
                      onClick={() => onDrillDown(ing)}
                    >
                      <Eye className="size-3.5" />
                    </Button>
                    {canReceive && ing.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Terima stok"
                        onClick={() =>
                          setTarget({ kind: "receive", ingredient: ing })
                        }
                      >
                        <PackagePlus className="size-3.5" />
                      </Button>
                    ) : null}
                    {canAdjust && ing.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Adjust stok"
                        onClick={() =>
                          setTarget({ kind: "adjust", ingredient: ing })
                        }
                      >
                        <Sliders className="size-3.5" />
                      </Button>
                    ) : null}
                    {canWaste && ing.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Waste"
                        onClick={() =>
                          setTarget({ kind: "waste", ingredient: ing })
                        }
                      >
                        <ArchiveX className="size-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Edit"
                      onClick={() =>
                        setTarget({ kind: "edit", ingredient: ing })
                      }
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    {canDelete && ing.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Hapus"
                        onClick={() =>
                          setTarget({ kind: "delete", ingredient: ing })
                        }
                        className="text-danger-500 hover:bg-danger-100"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        {monthlyTotals && monthlyTotals.rowCount > 0 ? (
          <tfoot className="border-t border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-700">
            <tr>
              <td className="sticky left-0 z-10 bg-neutral-50 px-3 py-2">
                TOTAL ({monthlyTotals.rowCount} bahan)
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatRupiah(monthlyTotals.stockAwalCost)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatRupiah(monthlyTotals.pembelianCost)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatRupiah(monthlyTotals.stockAkhirCost)}
              </td>
              <td className="px-3 py-2 text-right text-neutral-500">—</td>
              <td className="px-3 py-2 text-right font-mono text-neutral-900">
                {formatRupiah(monthlyTotals.hppCost)}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function FlowQtyCell({
  qty,
  cost,
  unit,
  emphasize,
}: {
  qty: number;
  cost: number;
  unit: string;
  emphasize?: boolean;
}) {
  return (
    <td className="px-3 py-2 text-right">
      <div
        className={cn(
          "font-mono",
          qty === 0
            ? "text-neutral-400"
            : emphasize
              ? "text-mahakan-green-700 font-semibold"
              : "text-neutral-900",
        )}
      >
        {qty.toLocaleString("id-ID", { maximumFractionDigits: 2 })}{" "}
        <span className="text-[10px] text-neutral-500">{unit}</span>
      </div>
      <div className="text-[10px] text-neutral-500">{formatRupiah(cost)}</div>
    </td>
  );
}

/**
 * Sesi AE-130 — Stock display dengan multi-unit tier (Anisa feedback).
 * Kalau ingredient punya unit_tracking + per_cogs aktif, render dalam
 * tracking unit (mis. "2,5 Kotak") dengan COGS breakdown subtle di
 * bawah ("2.500 ml"). Tanpa tier → render apa adanya.
 */
function StockDisplay({
  ingredient,
}: {
  ingredient: {
    currentStock: number;
    currentStockDecimal: string | null;
    unit: string;
    unitTracking: string | null;
    unitTrackingPerCogs: string | null;
    unitBelanja: string | null;
    unitBelanjaPerCogs: string | null;
  };
}) {
  const qtyCogs =
    ingredient.currentStockDecimal !== null
      ? parseFloat(ingredient.currentStockDecimal)
      : ingredient.currentStock;

  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(n);

  /* Sesi AE-136 — prefer Purchase Unit (unitBelanja) untuk display.
   * Owner directive: "untuk current stok gunakan satuan purchase unit".
   * Fallback ke unitTracking (legacy, deprecated UI) lalu unit (recipe)
   * supaya data lama tidak rusak. */
  const belanjaLabel = ingredient.unitBelanja?.trim();
  const hasBelanjaTier =
    Boolean(belanjaLabel) &&
    Boolean(ingredient.unitBelanjaPerCogs) &&
    Number(ingredient.unitBelanjaPerCogs) > 0;

  if (hasBelanjaTier) {
    const tiers: IngredientUnitTiers = {
      cogsUnit: ingredient.unit,
      belanjaUnit: ingredient.unitBelanja,
      belanjaPerCogs: ingredient.unitBelanjaPerCogs,
    };
    const purchase = cogsToBelanja(qtyCogs, tiers);
    return (
      <div className="flex flex-col items-end leading-tight">
        <span>{fmt(purchase)}</span>
        <span className="text-[10px] text-neutral-500">
          {fmt(qtyCogs)} {ingredient.unit}
        </span>
      </div>
    );
  }

  /* Backward-compat fallback: legacy data dengan unitTracking saja
   * (sebelum konvensi 2-unit). Drop ke tracking display kalau set. */
  const trackingLabel = ingredient.unitTracking?.trim();
  const hasTrackingTier =
    Boolean(trackingLabel) &&
    Boolean(ingredient.unitTrackingPerCogs) &&
    Number(ingredient.unitTrackingPerCogs) > 0;
  if (hasTrackingTier) {
    const tiers: IngredientUnitTiers = {
      cogsUnit: ingredient.unit,
      trackingUnit: ingredient.unitTracking,
      trackingPerCogs: ingredient.unitTrackingPerCogs,
    };
    const tracking = cogsToTracking(qtyCogs, tiers);
    return (
      <div className="flex flex-col items-end leading-tight">
        <span>{fmt(tracking)}</span>
        <span className="text-[10px] text-neutral-500">
          {fmt(qtyCogs)} {ingredient.unit}
        </span>
      </div>
    );
  }

  return (
    <>
      {formatStockQty(
        ingredient.currentStock,
        ingredient.currentStockDecimal ?? null,
      )}
    </>
  );
}

/** Sesi AE-130 — expose effective unit (tracking kalau aktif, COGS fallback)
 *  untuk consumer di file ini. Re-export untuk konsistensi pakai helper. */
export function ingredientEffectiveUnit(ingredient: {
  unit: string;
  unitTracking: string | null;
  unitTrackingPerCogs: string | null;
}): string {
  return effectiveTrackingUnit({
    cogsUnit: ingredient.unit,
    trackingUnit: ingredient.unitTracking,
    trackingPerCogs: ingredient.unitTrackingPerCogs,
  });
}
