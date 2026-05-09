"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  AlertTriangle,
  ArchiveX,
  Pencil,
  Plus,
  PackagePlus,
  Sliders,
  Tags,
  Trash2,
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
  deleteIngredient,
  isOk,
  listAtomicIngredients,
  listLowStockIngredients,
  type Ingredient,
  type IngredientSection,
  type SectionFilter,
} from "@/features/inventory";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { formatStockQty } from "@/lib/stock-decimal";
import { cn } from "@/lib/utils";
import { IngredientFormModal } from "./IngredientFormModal";
import { StockReceiveModal } from "./StockReceiveModal";
import { StockAdjustModal } from "./StockAdjustModal";
import { StockWasteModal } from "./StockWasteModal";
import { SectionAssignModal } from "./SectionAssignModal";

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
  const [lowOnly, setLowOnly] = useState(false);

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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Bahan Baku ({ingredients.length})
            {canSeeCost && totalStockValue > 0 ? (
              <span className="ml-2 text-sm font-normal text-neutral-500">
                · nilai stok{" "}
                <span className="font-mono font-medium text-neutral-700">
                  {formatRupiah(totalStockValue)}
                </span>
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-neutral-500">
            Bahan atomik (raw ingredient). Untuk bahan turunan seperti
            Prep-Espresso, Prep-Sambal-Matah, lihat tab Preparations. Stok
            terupdate via Terima / Adjust / Waste dan otomatis terkurang saat
            transaksi POS.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Tambah Bahan
          </Button>
        ) : null}
      </header>

      {lowStock.length > 0 ? (
        <Card className="border-warning-500/40 bg-warning-100/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-warning-500">
              <AlertTriangle className="size-4" aria-hidden /> Stok rendah ({lowStock.length})
            </h3>
            <Button
              variant={lowOnly ? "primary" : "outline"}
              size="sm"
              onClick={() => setLowOnly((v) => !v)}
            >
              {lowOnly ? "Tampilkan semua" : "Filter list"}
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-wrap gap-2 text-xs">
              {lowStock.map((i) => (
                <li
                  key={i.id}
                  className="rounded-md bg-white px-2 py-1 ring-1 ring-warning-500/30"
                >
                  <span className="font-medium text-neutral-900">{i.name}</span>{" "}
                  <span className="text-neutral-500">
                    sisa{" "}
                    {formatStockQty(
                      i.currentStock,
                      i.currentStockDecimal ?? null,
                    )}{" "}
                    {i.unit} / threshold {i.reorderThreshold}
                  </span>
                </li>
              ))}
            </ul>
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
                    {canSeeCost ? (
                      <SortableHeader
                        columnKey="costPerUnit"
                        label="Cost / Unit"
                        sort={sort}
                        align="right"
                      />
                    ) : null}
                    <SortableHeader
                      columnKey="reorderThreshold"
                      label="Threshold"
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
                          {formatStockQty(
                            i.currentStock,
                            i.currentStockDecimal ?? null,
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-700">{i.unit}</td>
                        {canSeeCost ? (
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {formatRupiah(i.costPerUnit)}
                          </td>
                        ) : null}
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
