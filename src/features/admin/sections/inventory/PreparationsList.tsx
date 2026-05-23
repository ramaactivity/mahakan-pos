"use client";

import { useEffect, useState } from "react";
import { Beaker, Pencil, Plus, Trash2 } from "lucide-react";
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
  listPreparations,
  type Ingredient,
} from "@/features/inventory";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { PreparationFormModal } from "./PreparationFormModal";

type ActionTarget =
  | { kind: "edit"; preparation: Ingredient }
  | { kind: "delete"; preparation: Ingredient }
  | null;

export function PreparationsList() {
  const { session } = useSession();
  const role = session?.user.role;
  const canSeeCost = role ? hasPermission(role, "inventory.cost.view") : false;
  const canCreate = role
    ? hasPermission(role, "inventory.preparation.create")
    : false;
  const canUpdate = role
    ? hasPermission(role, "inventory.preparation.update")
    : false;
  const canDelete = role
    ? hasPermission(role, "inventory.preparation.delete")
    : false;

  const [preparations, setPreparations] = useState<Ingredient[]>([]);
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
      const res = await listPreparations({
        activeOnly: !showInactive,
        search: search || undefined,
      });
      if (cancelled) return;
      if (isOk(res)) setPreparations(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, search, showInactive]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function handleConfirmDelete() {
    if (target?.kind !== "delete") return;
    const res = await deleteIngredient(target.preparation.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Preparation ${target.preparation.name} dihapus`);
    setTarget(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Preparations ({preparations.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Sub-resep: bahan turunan yang punya cost auto-computed dari
            recipe-nya (mis. Prep-Espresso-HB, Prep-Sambal-Matah). Cost
            ter-update otomatis kalau bahan baku-nya berubah harga (cascade).
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Tambah Preparation
          </Button>
        ) : null}
      </header>

      {/* Sesi AE-138 — clarify no-stock-tracking model. Owner sempat
       * bingung "stok prep di mana" — sebenarnya prep tidak ditrack,
       * sale-time auto-expand ke bahan baku underlying. */}
      <div className="rounded-md border border-info-300 bg-info-50 px-3 py-2.5 text-xs text-info-700">
        💡 <strong>Stok preparation tidak ditrack.</strong> Saat menu yang
        pakai prep terjual, sistem auto-deduct bahan baku underlying-nya
        (sesuai resep × qty menu, lalu dibagi yield + Q Factor). Prep cuma
        definisi cost + bulk recipe untuk efisiensi — bukan inventory
        physical.
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Input
                label="Cari preparation"
                placeholder="mis. espresso, sambal, kuah"
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
            <div
              className="space-y-2 p-4"
              role="status"
              aria-label="Memuat preparations"
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : preparations.length === 0 ? (
            <div className="space-y-2 py-8 text-center">
              <Beaker
                className="mx-auto size-10 text-neutral-300"
                aria-hidden
              />
              <p className="text-sm text-neutral-500">
                Belum ada preparation. Klik &ldquo;Tambah Preparation&rdquo;
                untuk bikin sub-recipe pertama.
              </p>
              <p className="text-xs text-neutral-400">
                Contoh: Prep-Espresso-HB, Prep-Simple-Syrup, Prep-Sambal-Matah.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nama</th>
                    <th className="px-4 py-2 text-right font-medium">Yield</th>
                    <th className="px-4 py-2 text-left font-medium">Unit</th>
                    {canSeeCost ? (
                      <th className="px-4 py-2 text-right font-medium">
                        Cost / Unit
                      </th>
                    ) : null}
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preparations.map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Beaker
                            className="size-4 text-mahakan-green-700"
                            aria-hidden
                          />
                          <span className="font-medium text-neutral-900">
                            {p.name}
                          </span>
                          {!p.isActive ? (
                            <Badge variant="neutral">Non-aktif</Badge>
                          ) : null}
                          {p.costPerUnit === 0 ? (
                            <Badge variant="warning">Belum ada resep</Badge>
                          ) : null}
                        </div>
                        {p.notes ? (
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {p.notes}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {p.preparationYield !== null
                          ? p.preparationYield.toLocaleString("id-ID")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{p.unit}</td>
                      {canSeeCost ? (
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {formatRupiah(p.costPerUnit)}
                          <span className="text-neutral-400">/{p.unit}</span>
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canUpdate ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Edit preparation"
                              title="Edit"
                              onClick={() =>
                                setTarget({ kind: "edit", preparation: p })
                              }
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                          {canDelete && p.isActive ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Hapus preparation"
                              title="Hapus"
                              onClick={() =>
                                setTarget({ kind: "delete", preparation: p })
                              }
                              className="text-danger-500 hover:bg-danger-100"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PreparationFormModal
        open={createOpen || target?.kind === "edit"}
        edit={target?.kind === "edit" ? target.preparation : null}
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

      <Modal
        open={target?.kind === "delete"}
        onClose={() => setTarget(null)}
        title="Hapus preparation?"
        description={
          target?.kind === "delete"
            ? `${target.preparation.name} (yield ${target.preparation.preparationYield ?? "?"} ${target.preparation.unit})`
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
          Soft-delete: preparation disembunyikan dari list aktif. Akan ditolak
          kalau masih ada resep menu yang merefer preparation ini — hapus dulu
          resep yang merefer baru hapus preparation-nya.
        </p>
      </Modal>
    </div>
  );
}
