"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArchiveX,
  Pencil,
  Plus,
  PackagePlus,
  Sliders,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  deleteIngredient,
  isOk,
  listIngredients,
  listLowStockIngredients,
  type Ingredient,
} from "@/features/inventory";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { IngredientFormModal } from "./IngredientFormModal";
import { StockReceiveModal } from "./StockReceiveModal";
import { StockAdjustModal } from "./StockAdjustModal";
import { StockWasteModal } from "./StockWasteModal";

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

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [lowStock, setLowStock] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<ActionTarget>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [listRes, lowRes] = await Promise.all([
        listIngredients({ activeOnly: !showInactive, search: search || undefined }),
        listLowStockIngredients(),
      ]);
      if (cancelled) return;
      if (isOk(listRes)) setIngredients(listRes.data.items);
      if (isOk(lowRes)) setLowStock(lowRes.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, search, showInactive]);

  const lowStockIds = useMemo(
    () => new Set(lowStock.map((i) => i.id)),
    [lowStock],
  );

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

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
            Bahan ({ingredients.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Stok terupdate via Terima / Adjust / Waste; juga otomatis terkurang
            saat transaksi POS (Phase 2 M22.5).
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
          <CardHeader className="pb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-warning-500">
              <AlertTriangle className="size-4" aria-hidden /> Stok rendah ({lowStock.length})
            </h3>
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
                    sisa {i.currentStock} {i.unit} / threshold {i.reorderThreshold}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
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
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat bahan">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : ingredients.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Belum ada bahan. Klik &ldquo;Tambah Bahan&rdquo; untuk mulai.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nama</th>
                    <th className="px-4 py-2 text-right font-medium">Stok</th>
                    <th className="px-4 py-2 text-left font-medium">Unit</th>
                    {canSeeCost ? (
                      <th className="px-4 py-2 text-right font-medium">Cost / Unit</th>
                    ) : null}
                    <th className="px-4 py-2 text-right font-medium">Threshold</th>
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {ingredients.map((i) => {
                    const isLow = lowStockIds.has(i.id);
                    return (
                      <tr key={i.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-neutral-900">
                              {i.name}
                            </span>
                            {!i.isActive ? (
                              <Badge variant="neutral">Non-aktif</Badge>
                            ) : null}
                            {isLow ? (
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
                        <td className="px-4 py-3 text-right font-mono">
                          {i.currentStock.toLocaleString("id-ID")}
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

      <Modal
        open={target?.kind === "delete"}
        onClose={() => setTarget(null)}
        title="Hapus bahan?"
        description={
          target?.kind === "delete"
            ? `${target.ingredient.name} (sisa ${target.ingredient.currentStock} ${target.ingredient.unit})`
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
